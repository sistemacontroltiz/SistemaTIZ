// Control de calidad y colocaciones.
import fs from 'node:fs';
import { QualityCheck, QualityTemplate, Installation } from '../models/operations.js';
import { WorkOrder, Task } from '../models/sales.js';
import AppError from '../utils/AppError.js';
import { can } from '../middleware/auth.js';
import { photoPath } from '../middleware/upload.js';
import { todayAR, toYMD } from '../utils/dates.js';
import { withTransaction } from './tx.js';
import { historyEntry } from './auditService.js';
import { changeStatus } from './workOrderService.js';

// ---------- Calidad ----------
export async function listQualityChecks({ workOrder, result, limit = 300 }) {
    const filter = {};
    if (workOrder) filter.workOrder = workOrder;
    if (result) filter.result = result;
    return QualityCheck.find(filter).sort({ date: -1 }).limit(limit).lean();
}

export async function pendingQuality() {
    return WorkOrder.find({ status: 'Calidad' }).select('number clientName title dueDate priority').sort({ dueDate: 1 }).lean();
}

// Tablero de calidad para el dueño: cuánto se rechaza, quién rechaza y qué OT reprocesa más.
export async function qualityStats({ from, to } = {}) {
    const filter = {};
    if (from || to) { filter.date = {}; if (from) filter.date.$gte = new Date(from); if (to) filter.date.$lte = new Date(to); }
    const checks = await QualityCheck.find(filter).select('result inspectorName workOrder workOrderNumber materialReusable date').lean();
    const total = checks.length;
    const rejected = checks.filter(c => c.result === 'Rechazado');
    const rejectionPct = total ? Math.round(rejected.length / total * 100) : 0;

    const byInsp = new Map();
    for (const c of checks) {
        const k = c.inspectorName || '—';
        const e = byInsp.get(k) || { inspector: k, total: 0, rejected: 0 };
        e.total += 1; if (c.result === 'Rechazado') e.rejected += 1;
        byInsp.set(k, e);
    }
    const inspectors = [...byInsp.values()]
        .map(e => ({ ...e, pct: e.total ? Math.round(e.rejected / e.total * 100) : 0 }))
        .sort((a, b) => b.rejected - a.rejected || b.total - a.total);

    const byWo = new Map();
    for (const c of rejected) {
        const k = c.workOrderNumber || String(c.workOrder);
        const e = byWo.get(k) || { workOrder: c.workOrder, woNumber: k, rejects: 0, lossRejects: 0 };
        e.rejects += 1; if (c.materialReusable === 'no') e.lossRejects += 1;
        byWo.set(k, e);
    }
    const topReprocess = [...byWo.values()].sort((a, b) => b.rejects - a.rejects).slice(0, 10);
    const reworkLoss = rejected.filter(c => c.materialReusable === 'no').length; // rechazos con pérdida de material

    return { total, approved: total - rejected.length, rejected: rejected.length, rejectionPct, reworkLoss, inspectors, topReprocess };
}

export async function createQualityCheck(data, req) {
    return withTransaction(async (session) => {
        const wo = await WorkOrder.findById(data.workOrder).session(session);
        if (!wo) throw AppError.notFound('Orden de trabajo');
        if (['Baja', 'Entregada'].includes(wo.status)) throw AppError.badRequest('La OT está cerrada.');
        let templateName = 'Control libre';
        if (data.template) {
            const t = await QualityTemplate.findById(data.template).session(session);
            if (!t) throw AppError.badRequest('La plantilla no existe.');
            templateName = t.name;
        }
        const failed = data.results.filter(r => !r.ok);
        if (failed.some(r => !r.note)) throw AppError.badRequest('Cada punto rechazado necesita una observación.');
        const result = failed.length ? 'Rechazado' : 'Aprobado';
        if (result === 'Rechazado' && !['si', 'no'].includes(data.materialReusable)) {
            throw AppError.badRequest('Indicá si el material se puede reutilizar.');
        }
        const [check] = await QualityCheck.create([{
            ...data, workOrderNumber: wo.number, templateName, result,
            materialReusable: result === 'Rechazado' ? data.materialReusable : null,
            inspector: req.user._id, inspectorName: req.user.name,
        }], { session });

        wo.history.push(historyEntry(req, `Control de calidad ${result}${failed.length ? ` (${failed.length} punto(s) con falla)` : ''}`));
        // Avance automático del proceso.
        // Un rechazo SIEMPRE devuelve la OT a Producción para rehacer, esté en
        // Calidad, Colocación o Lista para entrega (así no queda en un limbo).
        const postQc = ['Calidad', 'Colocación', 'Lista para entrega'];
        if (result === 'Rechazado') {
            if (postQc.includes(wo.status)) {
                const from = wo.status;
                wo.status = 'Producción';
                wo.progress = 0;
                // Reabrir las tareas terminadas para que producción pueda tomarlas y rehacer.
                const reopened = await Task.updateMany(
                    { workOrder: wo._id, status: { $ne: 'Pendiente' } },
                    { $set: { status: 'Pendiente', assignedUser: null, startedAt: null, finishedAt: null }, $push: { history: historyEntry(req, 'Reabierta por rechazo de calidad') } },
                    { session },
                );
                wo.history.push(historyEntry(req, `Estado: ${from} → Producción (rechazo de calidad${reopened.modifiedCount ? `, ${reopened.modifiedCount} tarea(s) reabierta(s)` : ''})`));
            }
        } else if (wo.status === 'Calidad') {
            const next = wo.needsInstallation ? 'Colocación' : 'Lista para entrega';
            wo.history.push(historyEntry(req, `Estado: Calidad → ${next} (automático)`));
            wo.status = next;
        }
        await wo.save({ session });
        return check;
    });
}

// Fotos del control de calidad (mismo mecanismo que las de colocación).
export async function addQualityPhotos(id, files, req) {
    const check = await QualityCheck.findById(id);
    if (!check) {
        await Promise.all(files.map(f => fs.promises.rm(f.path, { force: true })));
        throw AppError.notFound('Control de calidad');
    }
    if (check.photos.length + files.length > 20) throw AppError.badRequest('Máximo 20 fotos por control.');
    for (const f of files) {
        check.photos.push({ file: f.filename, originalName: f.originalname.slice(0, 120), mime: f.mimetype, size: f.size, uploadedBy: req.user._id });
    }
    await check.save();
    return check.photos;
}

export async function getQualityPhoto(id, photoId) {
    const check = await QualityCheck.findById(id).lean();
    const photo = check?.photos.find(p => String(p._id) === photoId);
    if (!photo) throw AppError.notFound('Foto');
    return { path: photoPath(photo.file), mime: photo.mime };
}

export async function deleteQualityPhoto(id, photoId, req) {
    const check = await QualityCheck.findById(id);
    const photo = check?.photos.id(photoId);
    if (!photo) throw AppError.notFound('Foto');
    await fs.promises.rm(photoPath(photo.file), { force: true });
    photo.deleteOne();
    await check.save();
}

// ---------- Colocaciones ----------
function ownFilter(req) {
    return can(req, 'installations:read') ? {} : { team: req.user._id };
}

export async function listInstallations({ from, to, status }, req) {
    const filter = { ...ownFilter(req) };
    if (status) filter.status = status;
    if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    return Installation.find(filter).populate('team', 'name').sort({ date: 1 }).limit(1000).lean();
}

export async function getInstallation(id, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) }).populate('team', 'name').lean();
    if (!inst) throw AppError.notFound('Colocación');
    return inst;
}

export async function createInstallation(data, req) {
    return withTransaction(async (session) => {
        const wo = await WorkOrder.findById(data.workOrder).session(session);
        if (!wo) throw AppError.notFound('Orden de trabajo');
        if (['Baja', 'Entregada'].includes(wo.status)) throw AppError.badRequest('La OT está cerrada.');
        if (toYMD(data.date) < todayAR()) throw AppError.badRequest('La fecha de colocación no puede ser pasada.');
        if (!wo.needsInstallation) { wo.needsInstallation = true; }
        if (!wo.installationAddress) wo.installationAddress = data.address;
        wo.history.push(historyEntry(req, `Colocación programada para ${toYMD(data.date)}`));
        await wo.save({ session });
        const [inst] = await Installation.create([{
            ...data, workOrderNumber: wo.number, clientName: wo.clientName, createdBy: req.user._id,
            history: [{ action: 'Programada', userName: req.user.name }],
        }], { session });
        return inst;
    });
}

export async function updateInstallation(id, data, req) {
    const inst = await Installation.findById(id);
    if (!inst) throw AppError.notFound('Colocación');
    if (inst.status !== 'Programada') throw AppError.badRequest('Solo se editan colocaciones programadas.');
    if (data.date && toYMD(data.date) < todayAR()) throw AppError.badRequest('La fecha no puede ser pasada.');
    inst.set(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    inst.history.push({ action: 'Datos editados', userName: req.user.name });
    await inst.save();
    return inst;
}

// El colocador toma la tarea: solo cuando la OT ya pasó producción y calidad (está en Colocación).
export async function startInstallation(id, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) });
    if (!inst) throw AppError.notFound('Colocación');
    if (inst.status !== 'Programada') throw AppError.badRequest(`La colocación ya está "${inst.status}".`);
    const wo = await WorkOrder.findById(inst.workOrder).select('status').lean();
    if (!wo || wo.status !== 'Colocación') {
        throw AppError.badRequest('Todavía no se puede tomar: la colocación se habilita cuando la OT está en Colocación (producción y calidad terminadas).');
    }
    inst.status = 'En proceso';
    inst.startedAt = new Date();
    inst.history.push({ action: 'Tomada por el colocador', userName: req.user.name });
    await inst.save();
    return inst;
}

export async function closeInstallation(id, { status, result, newDate }, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) });
    if (!inst) throw AppError.notFound('Colocación');
    if (!['Programada', 'En proceso'].includes(inst.status)) throw AppError.badRequest(`La colocación ya está "${inst.status}".`);
    if (status === 'Realizada' && inst.status !== 'En proceso') throw AppError.badRequest('Primero tomá la colocación (botón "Tomar") para registrar el inicio y poder cerrarla.');
    if (status === 'Reprogramada') {
        if (!newDate) throw AppError.badRequest('Indicá la nueva fecha.');
        if (toYMD(newDate) < todayAR()) throw AppError.badRequest('La nueva fecha no puede ser pasada.');
        inst.history.push({ action: `Reprogramada ${toYMD(inst.date)} → ${toYMD(newDate)}${result ? `: ${result}` : ''}`, userName: req.user.name });
        inst.date = newDate;
        await inst.save();
        return inst;
    }
    if (status === 'Realizada' && !inst.photos.length) throw AppError.badRequest('Subí al menos una foto de la colocación terminada.');
    inst.status = status;
    inst.result = result;
    if (status === 'Realizada') inst.completedAt = new Date();
    inst.history.push({ action: status, userName: req.user.name });
    await inst.save();

    if (status === 'Realizada') {
        const wo = await WorkOrder.findById(inst.workOrder);
        if (wo && wo.status === 'Colocación') {
            try { await changeStatus(wo._id, { status: 'Entregada', note: 'Colocación realizada' }, req); } catch (e) {
                // Si falta algo del proceso (ej. calidad), la OT queda en Colocación y se avisa.
                return { ...inst.toObject(), warning: `La OT no pasó a Entregada: ${e.message}` };
            }
        }
    }
    return inst;
}

export async function addPhotos(id, files, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) });
    if (!inst) {
        await Promise.all(files.map(f => fs.promises.rm(f.path, { force: true })));
        throw AppError.notFound('Colocación');
    }
    if (inst.photos.length + files.length > 40) throw AppError.badRequest('Máximo 40 fotos por colocación.');
    for (const f of files) {
        inst.photos.push({ file: f.filename, originalName: f.originalname.slice(0, 120), mime: f.mimetype, size: f.size, uploadedBy: req.user._id });
    }
    inst.history.push({ action: `${files.length} foto(s) subida(s)`, userName: req.user.name });
    await inst.save();
    return inst.photos;
}

export async function getPhoto(id, photoId, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) }).lean();
    const photo = inst?.photos.find(p => String(p._id) === photoId);
    if (!photo) throw AppError.notFound('Foto');
    return { path: photoPath(photo.file), mime: photo.mime };
}

export async function deletePhoto(id, photoId, req) {
    const inst = await Installation.findOne({ _id: id, ...ownFilter(req) });
    const photo = inst?.photos.id(photoId);
    if (!photo) throw AppError.notFound('Foto');
    if (inst.status === 'Realizada') throw AppError.badRequest('No se borran fotos de una colocación cerrada.');
    await fs.promises.rm(photoPath(photo.file), { force: true });
    photo.deleteOne();
    inst.history.push({ action: 'Foto eliminada', userName: req.user.name });
    await inst.save();
}
