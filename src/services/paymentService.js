// Cobranzas: cobros con retenciones (IVA, IIBB, Ganancias, SUSS), anticipos antes
// de facturar, cobros parciales, cuenta corriente, saldos y vista semanal.
import { Payment, Invoice, CBTE_TYPES } from '../models/billing.js';
import { WorkOrder } from '../models/sales.js';
import { Client } from '../models/parties.js';
import { nextNumber, getSettings } from '../models/catalogs.js';
import AppError from '../utils/AppError.js';
import { round2, sum } from '../utils/money.js';
import { daysBetween, isoWeek, todayAR, toYMD, weekStart, addDays } from '../utils/dates.js';
import { withTransaction } from './tx.js';
import { fullNumber } from './invoiceService.js';

const withholdingTotal = (w) => round2((w?.iva || 0) + (w?.iibb || 0) + (w?.ganancias || 0) + (w?.suss || 0));
const balanceOf = (inv) => round2(inv.total - inv.paid - inv.credited);

function validatePaymentDate(date) {
    if (!date || Number.isNaN(new Date(date).getTime())) throw AppError.badRequest('Ingresá una fecha de pago válida.');
    if (toYMD(date) > todayAR()) throw AppError.badRequest('La fecha de un pago recibido no puede ser futura.');
}

// Reparte un importe aplicado a una factura entre sus OT, en proporción.
async function distributeToWorkOrders(inv, amount, session, sign = 1) {
    for (const wa of inv.workOrderAmounts) {
        const share = round2(amount * wa.amount / inv.total);
        await WorkOrder.updateOne({ _id: wa.workOrder }, { $inc: { collected: sign * share } }, { session });
    }
}

export async function createPayment(data, req) {
    validatePaymentDate(data.date);
    if (['Cheque', 'eCheq'].includes(data.method) && !data.reference) throw AppError.badRequest('Para cheques indicá el número.');
    const totalApplied = round2(data.amount + withholdingTotal(data.withholdings));
    if (totalApplied <= 0) throw AppError.badRequest('El importe total (cobro + retenciones) debe ser mayor a 0.');

    return withTransaction(async (session) => {
        const client = await Client.findById(data.client).session(session);
        if (!client) throw AppError.badRequest('El cliente no existe.');
        const base = { ...data, totalApplied, clientName: client.name, createdBy: req.user._id, number: await nextNumber('payment', 'REC-') };

        if (data.kind === 'anticipo') {
            if (!data.workOrder) throw AppError.badRequest('El anticipo tiene que estar asociado a una OT.');
            const wo = await WorkOrder.findById(data.workOrder).session(session);
            if (!wo || String(wo.client) !== String(client._id)) throw AppError.badRequest('La OT no corresponde a ese cliente.');
            if (wo.status === 'Baja') throw AppError.badRequest('La OT está dada de baja.');
            const pending = round2(wo.total - wo.collected - wo.advances);
            if (totalApplied > pending + 0.01) throw AppError.badRequest(`El anticipo supera el saldo de la OT (${pending}).`);
            const [p] = await Payment.create([{ ...base, invoice: null }], { session });
            wo.advances = round2(wo.advances + totalApplied);
            wo.history.push({ action: `Anticipo ${p.number} por ${totalApplied}`, user: req.user._id, userName: req.user.name });
            await wo.save({ session });
            return p;
        }

        if (!data.invoice) throw AppError.badRequest('Elegí la factura que se cobra.');
        const inv = await Invoice.findById(data.invoice).session(session);
        if (!inv || inv.status !== 'Autorizada' || CBTE_TYPES[inv.kind].credit) throw AppError.badRequest('La factura no existe o no está autorizada.');
        if (String(inv.client) !== String(client._id)) throw AppError.badRequest('La factura no es de ese cliente.');
        const balance = balanceOf(inv);
        if (totalApplied > balance + 0.01) throw AppError.badRequest(`El cobro supera el saldo de la factura (${balance}).`);
        const [p] = await Payment.create([{ ...base, workOrder: inv.workOrders.length === 1 ? inv.workOrders[0] : null }], { session });
        inv.paid = round2(inv.paid + totalApplied);
        await inv.save({ session });
        await distributeToWorkOrders(inv, totalApplied, session);
        return p;
    });
}

export async function applyAdvance(id, { invoice }, req) {
    return withTransaction(async (session) => {
        const p = await Payment.findById(id).session(session);
        if (!p || p.status !== 'Vigente' || p.kind !== 'anticipo') throw AppError.badRequest('El anticipo no existe o está anulado.');
        if (p.invoice) throw AppError.badRequest('El anticipo ya fue aplicado.');
        const inv = await Invoice.findById(invoice).session(session);
        if (!inv || inv.status !== 'Autorizada' || CBTE_TYPES[inv.kind].credit) throw AppError.badRequest('Factura inválida.');
        if (!inv.workOrders.some(w => String(w) === String(p.workOrder))) throw AppError.badRequest('La factura no incluye la OT del anticipo.');
        const balance = balanceOf(inv);
        if (balance <= 0.009) throw AppError.badRequest('La factura no tiene saldo.');
        if (p.totalApplied > balance + 0.01) {
            // Se aplica solo lo que entra: el resto queda como un anticipo nuevo sin aplicar.
            const ratio = balance / p.totalApplied;
            const part = (v) => round2(v * ratio);
            const rest = {
                amount: round2(p.amount - part(p.amount)),
                withholdings: Object.fromEntries(['iva', 'iibb', 'ganancias', 'suss'].map(k => [k, round2((p.withholdings[k] || 0) - part(p.withholdings[k] || 0))])),
            };
            await Payment.create([{
                ...p.toObject(), _id: undefined, number: await nextNumber('payment', 'REC-'), invoice: null,
                amount: rest.amount, withholdings: rest.withholdings, totalApplied: round2(p.totalApplied - balance),
                notes: `Saldo del anticipo ${p.number}`, createdAt: undefined, updatedAt: undefined,
            }], { session });
            p.amount = round2(p.amount - rest.amount);
            for (const k of ['iva', 'iibb', 'ganancias', 'suss']) p.withholdings[k] = round2((p.withholdings[k] || 0) - rest.withholdings[k]);
            p.totalApplied = balance;
            p.notes = `${p.notes}\nAplicado en parte; saldo pasado a otro recibo.`.trim();
        }
        p.invoice = inv._id;
        await p.save({ session });
        inv.paid = round2(inv.paid + p.totalApplied);
        await inv.save({ session });
        await WorkOrder.updateOne({ _id: p.workOrder }, { $inc: { advances: -p.totalApplied, collected: p.totalApplied } }, { session });
        return p;
    });
}

export async function cancelPayment(id, { reason }, req) {
    return withTransaction(async (session) => {
        const p = await Payment.findById(id).session(session);
        if (!p) throw AppError.notFound('Cobro');
        if (p.status === 'Anulado') throw AppError.badRequest('El cobro ya está anulado.');
        if (p.invoice) {
            const inv = await Invoice.findById(p.invoice).session(session);
            inv.paid = round2(inv.paid - p.totalApplied);
            await inv.save({ session });
            if (p.kind === 'anticipo') await WorkOrder.updateOne({ _id: p.workOrder }, { $inc: { collected: -p.totalApplied } }, { session });
            else await distributeToWorkOrders(inv, p.totalApplied, session, -1);
        } else if (p.kind === 'anticipo') {
            await WorkOrder.updateOne({ _id: p.workOrder }, { $inc: { advances: -p.totalApplied } }, { session });
        }
        p.status = 'Anulado';
        p.notes = `${p.notes}\nANULADO por ${req.user.name}: ${reason}`.trim();
        await p.save({ session });
        return p;
    });
}

// Tablero de seguimiento de cobranzas: una fila por obra (no baja) con total,
// facturado, cobrado, faltante y estado de cobro. Ordenado por saldo (lo que más debe primero).
export async function collectionsBoard() {
    const wos = await WorkOrder.find({ status: { $ne: 'Baja' } })
        .select('number quoteNumber clientName status total collected advances billing dueDate deliveredAt')
        .lean();
    const today = todayAR();
    const rows = wos.map(w => {
        const cobrado = round2((w.collected || 0) + (w.advances || 0));
        const saldo = round2((w.total || 0) - cobrado);
        const pct = w.total > 0 ? Math.min(100, Math.round((cobrado / w.total) * 100)) : 0;
        const vencido = saldo > 0.01 && toYMD(w.dueDate) < today;
        let cobro = 'Sin cobrar';
        if (saldo <= 0.01) cobro = 'Cobrado';
        else if (cobrado > 0.01) cobro = 'Parcial';
        if (vencido) cobro = 'Vencido';
        return {
            workOrder: w._id, number: w.number, quoteNumber: w.quoteNumber, clientName: w.clientName,
            status: w.status, total: round2(w.total || 0), invoiced: round2(w.billing?.invoiced || 0),
            cobrado, saldo, pct, dueDate: w.dueDate, vencido, cobro,
        };
    }).sort((a, b) => b.saldo - a.saldo);
    const totals = {
        total: round2(sum(rows, r => r.total)),
        invoiced: round2(sum(rows, r => r.invoiced)),
        cobrado: round2(sum(rows, r => r.cobrado)),
        saldo: round2(sum(rows, r => r.saldo)),
        overdue: round2(sum(rows.filter(r => r.vencido), r => r.saldo)),
        withBalance: rows.filter(r => r.saldo > 0.01).length,
        count: rows.length,
    };
    return { rows, totals };
}

export async function getPayment(id) {
    const p = await Payment.findById(id).populate('workOrder', 'number').populate('invoice', 'kind pointOfSale number').lean();
    if (!p) throw AppError.notFound('Recibo');
    return p;
}

export async function listPayments({ client, from, to, kind, limit = 500 }) {
    const filter = {};
    if (client) filter.client = client;
    if (kind) filter.kind = kind;
    if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    return Payment.find(filter).populate('invoice', 'kind pointOfSale number').populate('workOrder', 'number')
        .sort({ date: -1 }).limit(limit).lean();
}

// Facturas con saldo: vencimiento, días de atraso y agrupado por cliente.
export async function receivables() {
    const invoices = await Invoice.find({ status: 'Autorizada', kind: { $in: ['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'] } }).lean();
    const today = todayAR();
    const open = invoices.map(i => ({ ...i, balance: balanceOf(i) })).filter(i => i.balance > 0.009).map(i => ({
        _id: i._id, fullNumber: fullNumber(i), client: i.client, clientName: i.clientSnapshot.name, date: i.date, dueDate: i.dueDate,
        total: i.total, balance: i.balance, overdueDays: Math.max(0, daysBetween(i.dueDate, today)),
    }));
    const byClient = new Map();
    for (const i of open) {
        const c = byClient.get(String(i.client)) || { client: i.client, clientName: i.clientName, balance: 0, overdue: 0, invoices: 0 };
        c.balance = round2(c.balance + i.balance);
        if (i.overdueDays > 0) c.overdue = round2(c.overdue + i.balance);
        c.invoices += 1;
        byClient.set(String(i.client), c);
    }
    const advances = await Payment.find({ kind: 'anticipo', invoice: null, status: 'Vigente' }).populate('workOrder', 'number').lean();
    return {
        invoices: open.sort((a, b) => b.overdueDays - a.overdueDays),
        clients: [...byClient.values()].sort((a, b) => b.balance - a.balance),
        totals: { balance: sum(open, i => i.balance), overdue: sum(open.filter(i => i.overdueDays > 0), i => i.balance) },
        unappliedAdvances: advances,
    };
}

// Cuenta corriente del cliente con saldo acumulado.
export async function accountStatement(clientId) {
    const client = await Client.findById(clientId).lean();
    if (!client) throw AppError.notFound('Cliente');
    const [invoices, payments] = await Promise.all([
        Invoice.find({ client: clientId, status: 'Autorizada' }).lean(),
        Payment.find({ client: clientId, status: 'Vigente' }).populate('workOrder', 'number').lean(),
    ]);
    const rows = [
        ...invoices.map(i => {
            const credit = CBTE_TYPES[i.kind].credit;
            return { date: i.date, type: CBTE_TYPES[i.kind].label, reference: fullNumber(i), debit: credit ? 0 : i.total, credit: credit ? i.total : 0, id: i._id };
        }),
        ...payments.flatMap(p => {
            const wh = withholdingTotal(p.withholdings);
            const label = p.kind === 'anticipo' ? `Anticipo ${p.workOrder?.number ?? ''}` : 'Cobro';
            const out = [{ date: p.date, type: label, reference: `${p.number} ${p.method} ${p.reference}`.trim(), debit: 0, credit: p.amount, id: p._id }];
            if (wh > 0) out.push({ date: p.date, type: 'Retenciones', reference: `${p.number}`, debit: 0, credit: wh, id: p._id });
            return out;
        }),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));
    let running = 0;
    for (const r of rows) { running = round2(running + r.debit - r.credit); r.balance = running; }
    return { client: { _id: client._id, name: client.name, cuit: client.cuit }, rows, balance: running };
}

// Cobrado por semana y vencimientos por semana (para planificar la cobranza).
export async function weekly({ from, to }) {
    const start = from ? new Date(from) : addDays(new Date(), -56);
    const end = to ? new Date(to) : addDays(new Date(), 28);
    const [payments, rec] = await Promise.all([
        Payment.find({ status: 'Vigente', date: { $gte: start, $lte: end } }).lean(),
        receivables(),
    ]);
    const weeks = new Map();
    const bucket = (d) => {
        const key = isoWeek(d);
        if (!weeks.has(key)) weeks.set(key, { week: key, start: weekStart(d), collected: 0, withholdings: 0, advances: 0, dueAmount: 0, dueCount: 0 });
        return weeks.get(key);
    };
    for (const p of payments) {
        const w = bucket(p.date);
        w.collected = round2(w.collected + p.amount);
        w.withholdings = round2(w.withholdings + withholdingTotal(p.withholdings));
        if (p.kind === 'anticipo') w.advances = round2(w.advances + p.totalApplied);
    }
    for (const i of rec.invoices) {
        if (new Date(i.dueDate) < start || new Date(i.dueDate) > end) continue;
        const w = bucket(i.dueDate);
        w.dueAmount = round2(w.dueAmount + i.balance);
        w.dueCount += 1;
    }
    return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export async function paymentTermDefault() {
    return (await getSettings()).defaultPaymentTermDays;
}
