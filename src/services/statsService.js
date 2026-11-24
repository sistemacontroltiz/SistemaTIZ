// Indicadores: comercial, producción, cumplimiento, facturación, cobranza y margen.
import { Quote, WorkOrder, Task } from '../models/sales.js';
import { Invoice, Payment, CBTE_TYPES } from '../models/billing.js';
import { Product, StockMovement, Purchase } from '../models/inventory.js';
import { Installation } from '../models/operations.js';
import { round2, sum } from '../utils/money.js';
import { addDays, todayAR, toYMD } from '../utils/dates.js';
import { trafficLight } from './workOrderService.js';
import { receivables } from './paymentService.js';

export async function summary({ from, to }) {
    const start = from ? new Date(from) : addDays(new Date(), -30);
    const end = to ? new Date(to) : new Date();
    const range = { $gte: start, $lte: end };

    const [quotes, wosActive, wosDelivered, invoices, payments, rec, lowStock, tasks, installs] = await Promise.all([
        Quote.find({ issueDate: range }).select('status total net clientName client').lean(),
        WorkOrder.find({ status: { $nin: ['Entregada', 'Baja'] } }).select('status dueDate total number clientName priority').lean(),
        WorkOrder.find({ status: 'Entregada', deliveredAt: range }).select('dueDate deliveredAt total net plannedCost number clientName').lean(),
        Invoice.find({ status: 'Autorizada', date: range }).lean(),
        Payment.find({ status: 'Vigente', date: range }).lean(),
        receivables(),
        Product.find({ active: true, isService: false, $expr: { $lt: ['$stock', '$minStock'] } }).select('name stock minStock unit').lean(),
        Task.aggregate([{ $match: { status: { $ne: 'Completada' } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Installation.countDocuments({ status: 'Programada', date: { $gte: new Date(`${todayAR()}T00:00:00-03:00`), $lte: addDays(new Date(), 7) } }),
    ]);

    // Comercial
    const decided = quotes.filter(q => ['Aprobado', 'Rechazado'].includes(q.status));
    const approved = quotes.filter(q => q.status === 'Aprobado');
    const commercial = {
        quotes: quotes.length,
        quotedAmount: sum(quotes, q => q.total),
        approved: approved.length,
        approvedAmount: sum(approved, q => q.total),
        conversionPct: decided.length ? Math.round(approved.length / decided.length * 100) : null,
        pending: quotes.filter(q => ['Borrador', 'Enviado'].includes(q.status)).length,
    };

    // Producción y cumplimiento
    const lights = wosActive.reduce((acc, w) => { const l = trafficLight(w); acc[l] = (acc[l] || 0) + 1; return acc; }, {});
    const onTime = wosDelivered.filter(w => toYMD(w.deliveredAt) <= toYMD(w.dueDate)).length;
    const operations = {
        active: wosActive.length,
        byStatus: wosActive.reduce((acc, w) => { acc[w.status] = (acc[w.status] || 0) + 1; return acc; }, {}),
        lights,
        overdue: wosActive.filter(w => trafficLight(w) === 'vencida').sort((a, b) => a.dueDate - b.dueDate).slice(0, 10),
        delivered: wosDelivered.length,
        onTimePct: wosDelivered.length ? Math.round(onTime / wosDelivered.length * 100) : null,
        openTasks: Object.fromEntries(tasks.map(t => [t._id, t.n])),
        installationsNext7Days: installs,
    };

    // Facturación y cobranza
    // Saldo de obra por cobrar: valor de la OT − cobrado − anticipos, sobre las OT no dadas de baja.
    // Es el saldo comercial de las obras (incluye lo todavía no facturado), distinto de las cuentas por cobrar.
    const obras = await WorkOrder.find({ status: { $ne: 'Baja' } }).select('total collected advances').lean();
    const workReceivable = round2(sum(obras, w => Math.max(0, (w.total || 0) - (w.collected || 0) - (w.advances || 0))));

    const signed = (i) => (CBTE_TYPES[i.kind].credit ? -1 : 1);
    const billing = {
        invoicedNet: round2(invoices.reduce((a, i) => a + signed(i) * i.net, 0)),
        invoicedTotal: round2(invoices.reduce((a, i) => a + signed(i) * i.total, 0)),
        invoices: invoices.filter(i => !CBTE_TYPES[i.kind].credit).length,
        collected: sum(payments, p => p.amount),
        withholdings: sum(payments, p => p.totalApplied - p.amount),
        receivable: rec.totals.balance,
        workReceivable,
        overdue: rec.totals.overdue,
        topDebtors: rec.clients.slice(0, 5),
    };

    // Margen: previsto (presupuesto) vs real (consumos + compras imputadas) en OTs entregadas
    const ids = wosDelivered.map(w => w._id);
    const [movs, purchases] = await Promise.all([
        StockMovement.find({ workOrder: { $in: ids } }).lean(),
        Purchase.find({ status: 'Registrada', 'items.allocations.workOrder': { $in: ids } }).lean(),
    ]);
    const margins = wosDelivered.map(w => {
        const id = String(w._id);
        const mat = -sum(movs.filter(m => String(m.workOrder) === id), m => m.quantity * m.unitCost);
        const pur = sum(purchases.flatMap(p => p.items.flatMap(i => i.allocations.filter(a => String(a.workOrder) === id))), a => a.amount);
        const realCost = round2(mat + pur);
        return {
            number: w.number, clientName: w.clientName, net: w.net, plannedCost: w.plannedCost, realCost,
            plannedMarginPct: w.net ? Math.round((w.net - w.plannedCost) / w.net * 1000) / 10 : null,
            realMarginPct: w.net && realCost ? Math.round((w.net - realCost) / w.net * 1000) / 10 : null,
        };
    });

    // Top clientes por monto aprobado
    const byClient = new Map();
    for (const q of approved) byClient.set(q.clientName, round2((byClient.get(q.clientName) || 0) + q.total));
    const topClients = [...byClient.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5);

    return { period: { from: toYMD(start), to: toYMD(end) }, commercial, operations, billing, margins, topClients, lowStock };
}
