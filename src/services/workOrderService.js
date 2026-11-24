// Órdenes de trabajo: estados con reglas de proceso, semáforo de vencimiento,
// reprogramaciones con historia, baja controlada y consumo de materiales.
import { WorkOrder, Task, Quote } from '../models/sales.js';
import { QualityCheck, Installation } from '../models/operations.js';
import { Product, StockMovement, Purchase } from '../models/inventory.js';
import { Invoice, Payment } from '../models/billing.js';
import AppError from '../utils/AppError.js';
import { daysBetween, todayAR, toYMD } from '../utils/dates.js';
import { round2, sum } from '../utils/money.js';
import { withTransaction } from './tx.js';
import { historyEntry } from './auditService.js';

// Semáforo: en término / próxima (≤3 días) / vencida / cumplida / cumplida tarde / baja
export function trafficLight(wo, today = todayAR()) {
    if (wo.status === 'Baja') return 'baja';
    if (wo.status === 'Entregada') {
        return wo.deliveredAt && toYMD(wo.deliveredAt) <= toYMD(wo.dueDate) ? 'cumplida' : 'cumplida-tarde';
    }
    const days = daysBetween(today, wo.dueDate);
    if (days < 0) return 'vencida';
    if (days <= 3) return 'proxima';
    return 'en-termino';
}

const enrich = (wo) => ({ ...wo, light: trafficLight(wo), daysLeft: daysBetween(todayAR(), wo.dueDate) });

export async function listWorkOrders({ q, status, client, light, limit = 300 }) {
    const filter = {};
    if (status === 'activas') filter.status = { $nin: ['Entregada', 'Baja'] };
    else if (status === 'con_saldo') {
        // OT con deuda pendiente: cualquier estado salvo Baja, mientras total − cobrado − anticipos > 0.
        // Incluye las Entregadas sin saldar, para poder seguir cobrando hasta cancelar la deuda.
        filter.status = { $ne: 'Baja' };
        filter.$expr = { $gt: [{ $subtract: ['$total', { $add: ['$collected', '$advances'] }] }, 0.01] };
    } else if (status) filter.status = status;
    if (client) filter.client = client;
    if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ number: rx }, { clientName: rx }, { title: rx }, { quoteNumber: rx }];
    }
    let list = (await WorkOrder.find(filter).select('-history -items').sort({ dueDate: 1 }).limit(limit).lean()).map(enrich);
    if (light) list = list.filter(w => w.light === light);
    // Ordena por vencimiento más próximo a hoy; las cerradas (entregadas/baja) al final.
    const closed = (w) => (['Entregada', 'Baja'].includes(w.status) ? 1 : 0);
    list.sort((a, b) => closed(a) - closed(b) || new Date(a.dueDate) - new Date(b.dueDate));
    return list;
}

export async function getWorkOrder(id) {
    const wo = await WorkOrder.findById(id).populate('client', 'name cuit phone email address contacts').lean();
    if (!wo) throw AppError.notFound('Orden de trabajo');
    const [tasks, quality, installations, invoices, payments, movements, purchases] = await Promise.all([
        Task.find({ workOrder: id }).populate('sector', 'name').populate('assignedUser', 'name').sort({ createdAt: 1 }).lean(),
        QualityCheck.find({ workOrder: id }).sort({ date: -1 }).lean(),
        Installation.find({ workOrder: id }).populate('team', 'name').sort({ date: -1 }).lean(),
        Invoice.find({ workOrders: id }).select('kind pointOfSale number date total status cae paid credited workOrderAmounts').sort({ date: 1 }).lean({ virtuals: true }),
        Payment.find({ workOrder: id, status: 'Vigente' }).sort({ date: 1 }).lean(),
        StockMovement.find({ workOrder: id }).populate('product', 'name unit').sort({ date: 1 }).lean(),
        Purchase.find({ 'items.allocations.workOrder': id, status: 'Registrada' }).select('number supplierName date items').lean(),
    ]);
    const costs = await realCosts(id, { movements, purchases });
    const plannedMaterials = await plannedMaterialsFor(wo.quote);
    return { ...enrich(wo), tasks, quality, installations, invoices, payments, movements, costs, plannedMaterials };
}

// Insumos previstos: se arman desde el presupuesto que generó la OT.
// La cantidad total = cantidad del material (por unidad del ítem) × cantidad del ítem.
// Se agrupan por insumo para no repetir si aparece en varios ítems.
export async function plannedMaterialsFor(quoteId) {
    if (!quoteId) return [];
    const quote = await Quote.findById(quoteId).select('items').lean();
    if (!quote) return [];
    const byKey = new Map();
    for (const item of quote.items || []) {
        for (const m of item.materials || []) {
            const key = m.product ? String(m.product) : `name:${m.name}`;
            const qty = round2((m.quantity || 0) * (item.quantity || 0));
            const prev = byKey.get(key);
            if (prev) { prev.quantity = round2(prev.quantity + qty); }
            else byKey.set(key, { product: m.product || null, name: m.name, unit: m.unit || '', quantity: qty, unitCost: m.unitCost || 0 });
        }
    }
    return [...byKey.values()].map(m => ({ ...m, total: round2(m.quantity * m.unitCost) }));
}

// Costo real = materiales consumidos de stock + compras imputadas a la OT.
export async function realCosts(id, pre) {
    const movements = pre?.movements ?? await StockMovement.find({ workOrder: id }).lean();
    const purchases = pre?.purchases ?? await Purchase.find({ 'items.allocations.workOrder': id, status: 'Registrada' }).lean();
    const materials = round2(-sum(movements.filter(m => m.type === 'consumo' || m.type === 'devolucion'), m => m.quantity * m.unitCost));
    const allocated = sum(purchases.flatMap(p => p.items.flatMap(i => i.allocations.filter(a => String(a.workOrder) === String(id)))), a => a.amount);
    return { materials, purchases: allocated, total: round2(materials + allocated) };
}

// Antes de salir de Producción, la OT tiene que haber cargado el material real:
// consumo de stock o compra imputada. Si el presupuesto no llevaba insumos de
// catálogo con stock (todo servicios/tercerizado), no se exige nada acá.
async function requireMaterialsLoaded(wo) {
    const planned = await plannedMaterialsFor(wo.quote);
    const productIds = planned.map(m => m.product).filter(Boolean);
    if (!productIds.length) return;
    const hasStockItem = await Product.exists({ _id: { $in: productIds }, isService: { $ne: true } });
    if (!hasStockItem) return; // todo tercerizado: se imputa por Compras, no por consumo
    const consumo = await StockMovement.exists({ workOrder: wo._id, type: 'consumo' });
    const compra = await Purchase.exists({ 'items.allocations.workOrder': wo._id, status: 'Registrada' });
    if (!consumo && !compra) {
        throw AppError.badRequest('Antes de pasar a Calidad cargá el consumo de materiales: la OT todavía no descontó stock. Usá "Cargar todos al consumo" en Materiales y costos. Si fue material comprado para esta OT, imputá la compra.');
    }
}

// Reglas de proceso para avanzar de estado.
async function checkTransition(wo, to) {
    const order = ['Pendiente', 'Pre-producción', 'Diseño', 'Producción', 'Calidad', 'Colocación', 'Lista para entrega', 'Entregada'];
    if (wo.status === 'Baja') throw AppError.badRequest('La OT está dada de baja.');
    if (wo.status === 'Entregada') throw AppError.badRequest('La OT ya fue entregada.');
    if (to === wo.status) throw AppError.badRequest('La OT ya está en ese estado.');
    if (to === 'Colocación' && !wo.needsInstallation) throw AppError.badRequest('Esta OT no lleva colocación.');

    // No se sale de pre-producción hasta terminar las 4 tareas (incluido el control de presupuesto).
    if (wo.status === 'Pre-producción') {
        const pendingPre = await Task.countDocuments({ workOrder: wo._id, kind: 'preprod', status: { $ne: 'Completada' } });
        if (pendingPre) throw AppError.badRequest(`Pre-producción: faltan ${pendingPre} tarea(s) (relevamiento, planos, pedidos o control de presupuesto).`);
    }

    const idx = order.indexOf(to);
    if (idx >= order.indexOf('Calidad')) {
        const pending = await Task.countDocuments({ workOrder: wo._id, kind: { $ne: 'preprod' }, status: { $ne: 'Completada' } });
        if (pending) throw AppError.badRequest(`Hay ${pending} tarea(s) de producción sin terminar.`);
        await requireMaterialsLoaded(wo);
    }
    if (idx > order.indexOf('Calidad')) {
        const last = await QualityCheck.findOne({ workOrder: wo._id }).sort({ date: -1 });
        if (!last || last.result !== 'Aprobado') throw AppError.badRequest('Falta un control de calidad aprobado.');
    }
    if (to === 'Entregada' && wo.needsInstallation) {
        const done = await Installation.exists({ workOrder: wo._id, status: 'Realizada' });
        if (!done) throw AppError.badRequest('La colocación todavía no está marcada como realizada.');
    }
}

export async function changeStatus(id, { status, note }, req, { session } = {}) {
    const wo = await WorkOrder.findById(id).session(session ?? null);
    if (!wo) throw AppError.notFound('Orden de trabajo');
    await checkTransition(wo, status);
    const from = wo.status;
    wo.status = status;
    if (status === 'Producción' && !wo.productionStartedAt) wo.productionStartedAt = new Date();
    if (from === 'Producción' && status !== 'Producción') wo.productionEndedAt = new Date();
    if (status === 'Entregada') { wo.deliveredAt = new Date(); wo.progress = 100; }
    wo.history.push(historyEntry(req, `Estado: ${from} → ${status}${note ? ` (${note})` : ''}`));
    await wo.save({ session });
    return wo;
}

export async function reschedule(id, { dueDate, reason }, req) {
    const wo = await WorkOrder.findById(id);
    if (!wo) throw AppError.notFound('Orden de trabajo');
    if (['Entregada', 'Baja'].includes(wo.status)) throw AppError.badRequest('No se puede reprogramar una OT cerrada.');
    if (toYMD(dueDate) < todayAR()) throw AppError.badRequest('La nueva fecha no puede ser anterior a hoy.');
    wo.reschedules.push({ from: wo.dueDate, to: dueDate, reason, user: req.user._id, userName: req.user.name });
    wo.history.push(historyEntry(req, `Reprogramada ${toYMD(wo.dueDate)} → ${toYMD(dueDate)}: ${reason}`));
    wo.dueDate = dueDate;
    await wo.save();
    return wo;
}

export async function updateWorkOrder(id, data, req) {
    const wo = await WorkOrder.findById(id);
    if (!wo) throw AppError.notFound('Orden de trabajo');
    if (wo.status === 'Baja') throw AppError.badRequest('La OT está dada de baja.');
    wo.set(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
    wo.history.push(historyEntry(req, 'Datos de la OT actualizados'));
    await wo.save();
    return wo;
}

// Baja: no se permite si tiene facturación vigente o cobros (primero NC / anular cobros).
export async function cancelWorkOrder(id, { reason }, req) {
    return withTransaction(async (session) => {
        const wo = await WorkOrder.findById(id).session(session);
        if (!wo) throw AppError.notFound('Orden de trabajo');
        if (wo.status === 'Baja') throw AppError.badRequest('La OT ya está dada de baja.');
        if (wo.status === 'Entregada') throw AppError.badRequest('No se puede dar de baja una OT entregada.');
        if (wo.billing.invoiced > 0.009) throw AppError.badRequest('La OT tiene facturación. Emití una nota de crédito antes de darla de baja.');
        if (wo.advances > 0.009 || wo.collected > 0.009) throw AppError.badRequest('La OT tiene cobros o anticipos. Anulalos antes de darla de baja.');
        wo.status = 'Baja';
        wo.cancellation = { reason, user: req.user._id, userName: req.user.name, date: new Date() };
        wo.history.push(historyEntry(req, `Baja: ${reason}`));
        await wo.save({ session });
        await Task.updateMany({ workOrder: wo._id, status: { $ne: 'Completada' } }, { $set: { status: 'Completada', notes: 'Cerrada por baja de OT' } }, { session });
        await Installation.updateMany({ workOrder: wo._id, status: 'Programada' }, { $set: { status: 'Cancelada' } }, { session });
        await Quote.updateOne({ _id: wo.quote }, { $set: { status: 'Baja' }, $push: { history: historyEntry(req, `Baja por baja de ${wo.number}`) } }, { session });
        return wo;
    });
}

// Consumo de materiales del stock imputado a la OT.
export async function consumeMaterials(id, { lines }, req) {
    return withTransaction(async (session) => {
        const wo = await WorkOrder.findById(id).session(session);
        if (!wo) throw AppError.notFound('Orden de trabajo');
        if (['Baja', 'Entregada'].includes(wo.status)) throw AppError.badRequest('La OT está cerrada.');
        const warnings = [];
        for (const line of lines) {
            const p = await Product.findById(line.product).session(session);
            if (!p) throw AppError.badRequest('Insumo inexistente.');
            if (p.isService) throw AppError.badRequest(`"${p.name}" es un servicio: imputalo desde Compras.`);
            p.stock = round2(p.stock - line.quantity);
            if (p.stock < 0) warnings.push(`"${p.name}" quedó con stock negativo (${p.stock}).`);
            await p.save({ session });
            await StockMovement.create([{
                product: p._id, type: 'consumo', quantity: -line.quantity, unitCost: p.cost,
                workOrder: wo._id, note: line.note || `Consumo ${wo.number}`, user: req.user._id,
            }], { session });
        }
        wo.history.push(historyEntry(req, `Consumo de ${lines.length} insumo(s)`));
        await wo.save({ session });
        return { ok: true, warnings };
    });
}

export async function recomputeProgress(workOrderId, session) {
    // El avance de producción cuenta solo las tareas de producción, no las de pre-producción.
    const tasks = await Task.find({ workOrder: workOrderId, kind: { $ne: 'preprod' } }).session(session ?? null).lean();
    const done = tasks.filter(t => t.status === 'Completada').length;
    const progress = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    await WorkOrder.updateOne({ _id: workOrderId }, { $set: { progress } }, { session });
    return progress;
}
