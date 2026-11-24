// Tareas de producción por sector: tomar, finalizar, revertir y asignar.
import { Task, WorkOrder } from '../models/sales.js';
import AppError from '../utils/AppError.js';
import { can } from '../middleware/auth.js';
import { withTransaction } from './tx.js';
import { historyEntry } from './auditService.js';
import { recomputeProgress } from './workOrderService.js';

export async function listTasks({ status, sector, workOrder, mine }, req) {
    const filter = {};
    if (status) filter.status = status;
    if (workOrder) filter.workOrder = workOrder;
    if (sector) filter.sector = sector;
    // Quien no asigna tareas solo ve las de su sector (o las suyas).
    if (!can(req, 'production:assign')) {
        filter.$or = [{ sector: req.user.sector?._id ?? null }, { assignedUser: req.user._id }];
    }
    if (mine === 'true') filter.assignedUser = req.user._id;
    const tasks = await Task.find(filter).populate('sector', 'name').populate('assignedUser', 'name')
        .sort({ status: 1, createdAt: 1 }).limit(1000).lean();
    // Se ocultan las tareas de OTs dadas de baja o entregadas
    const woIds = [...new Set(tasks.map(t => String(t.workOrder)))];
    const open = new Map((await WorkOrder.find({ _id: { $in: woIds } }).select('status dueDate priority').lean()).map(w => [String(w._id), w]));
    return tasks.filter(t => !['Baja'].includes(open.get(String(t.workOrder))?.status))
        // Las preprod tienen su propio vencimiento; las de producción toman el de la OT.
        .map(t => ({ ...t, dueDate: t.kind === 'preprod' ? t.dueDate : open.get(String(t.workOrder))?.dueDate, priority: open.get(String(t.workOrder))?.priority }));
}

async function loadTask(id, session) {
    const task = await Task.findById(id).session(session);
    if (!task) throw AppError.notFound('Tarea');
    const wo = await WorkOrder.findById(task.workOrder).session(session);
    if (!wo || ['Baja', 'Entregada'].includes(wo.status)) throw AppError.badRequest('La OT de esta tarea está cerrada.');
    return { task, wo };
}

function assertSector(task, req) {
    if (can(req, 'production:assign')) return;
    const userSector = req.user.sector?._id ?? req.user.sector;
    if (!userSector || String(userSector) !== String(task.sector)) {
        throw AppError.forbidden('Esta tarea no corresponde a tu sector.');
    }
}

export async function takeTask(id, req) {
    return withTransaction(async (session) => {
        const { task, wo } = await loadTask(id, session);
        // No se puede empezar producción mientras la OT está en pre-producción.
        if (task.kind !== 'preprod' && wo.status === 'Pre-producción') {
            throw AppError.badRequest('La OT está en pre-producción; todavía no se puede empezar la producción.');
        }
        if (task.kind === 'preprod') {
            if (!can(req, 'production:work') && !can(req, 'production:assign')) throw AppError.forbidden('No tenés permiso para tareas de pre-producción.');
        } else {
            assertSector(task, req);
        }
        // Candado de predecesora: no se toma hasta que la anterior esté terminada.
        if (task.predecessor) {
            const prev = await Task.findById(task.predecessor).select('status description').session(session);
            if (prev && prev.status !== 'Completada') throw AppError.badRequest(`Primero hay que terminar "${prev.description}".`);
        }
        if (task.status !== 'Pendiente') throw AppError.badRequest(`La tarea ya está "${task.status}".`);
        task.status = 'En progreso';
        task.assignedUser = req.user._id;
        task.startedAt = new Date();
        task.history.push(historyEntry(req, 'Tomada'));
        await task.save({ session });
        // Solo las tareas de producción adelantan la OT a Producción.
        if (task.kind !== 'preprod' && ['Pendiente', 'Diseño'].includes(wo.status)) {
            wo.history.push(historyEntry(req, `Estado: ${wo.status} → Producción (inicio de tarea)`));
            wo.status = 'Producción';
            await wo.save({ session });
        }
        return task;
    });
}

export async function finishTask(id, { notes }, req) {
    return withTransaction(async (session) => {
        const { task, wo } = await loadTask(id, session);
        if (task.status !== 'En progreso') throw AppError.badRequest('Solo se finaliza una tarea en progreso.');
        if (String(task.assignedUser) !== String(req.user._id) && !can(req, 'production:assign')) {
            throw AppError.forbidden('La tarea la tomó otra persona.');
        }
        task.status = 'Completada';
        task.finishedAt = new Date();
        if (notes) task.notes = notes;
        task.history.push(historyEntry(req, 'Finalizada'));
        await task.save({ session });
        // Cuando se completan las 4 tareas de pre-producción, la OT avanza sola.
        let advanced = null;
        if (task.kind === 'preprod' && wo.status === 'Pre-producción') {
            const pendingPre = await Task.countDocuments({ workOrder: wo._id, kind: 'preprod', status: { $ne: 'Completada' } }).session(session);
            if (pendingPre === 0) {
                advanced = wo.needsDesign ? 'Diseño' : 'Pendiente';
                wo.status = advanced;
                wo.history.push(historyEntry(req, `Pre-producción completa → ${advanced}`));
                await wo.save({ session });
            }
        }
        const progress = await recomputeProgress(task.workOrder, session);
        return { task, progress, advanced };
    });
}

export async function revertTask(id, req) {
    return withTransaction(async (session) => {
        const { task } = await loadTask(id, session);
        if (task.status === 'Pendiente') throw AppError.badRequest('La tarea ya está pendiente.');
        task.history.push(historyEntry(req, `Revertida desde "${task.status}"`));
        task.status = 'Pendiente';
        task.assignedUser = null; task.startedAt = null; task.finishedAt = null;
        await task.save({ session });
        await recomputeProgress(task.workOrder, session);
        return task;
    });
}

export async function assignTask(id, { sector, assignedUser }, req) {
    const task = await Task.findById(id);
    if (!task) throw AppError.notFound('Tarea');
    if (sector !== undefined) task.sector = sector;
    if (assignedUser !== undefined) task.assignedUser = assignedUser;
    task.history.push(historyEntry(req, 'Reasignada'));
    await task.save();
    return task;
}
