// Facturación electrónica: arma el comprobante desde una o varias OT, pide el CAE
// a ARCA con numeración correlativa protegida y actualiza OTs y saldos.
import { Invoice, Payment, IssueLock, CBTE_TYPES } from '../models/billing.js';
import { WorkOrder } from '../models/sales.js';
import { Client, IVA_CONDITIONS } from '../models/parties.js';
import { getSettings } from '../models/catalogs.js';
import AppError from '../utils/AppError.js';
import { round2, sum } from '../utils/money.js';
import { addDays, daysBetween, fromArcaDate, todayAR, toArcaDate, toYMD } from '../utils/dates.js';
import { arcaMode, credentials, isSimulated } from '../integrations/arca/config.js';
import * as wsfe from '../integrations/arca/wsfe.js';
import { withTransaction } from './tx.js';
import { audit } from './auditService.js';

const DOC_TYPES = { CUIT: 80, DNI: 96, SIN: 99 };
const CREDIT_OF = { FA: 'NCA', FB: 'NCB', FC: 'NCC' };

// Letra del comprobante según condición de IVA de emisor y receptor.
export function resolveLetter(issuerIva, receiverIva, preferred) {
    if (issuerIva !== 'RI') return 'C';
    if (receiverIva === 'RI') return 'A';
    if (receiverIva === 'MT') return preferred === 'B' ? 'B' : 'A';
    return 'B'; // consumidor final, exento, no categorizado
}

// Total facturado + reservado en comprobantes pendientes para cada OT
async function reservedByWorkOrder(ids) {
    const pending = await Invoice.find({ status: { $in: ['Pendiente', 'Error'] }, workOrders: { $in: ids } }).lean();
    const map = new Map();
    for (const inv of pending) {
        const sign = CBTE_TYPES[inv.kind].credit ? -1 : 1;
        for (const wa of inv.workOrderAmounts) map.set(String(wa.workOrder), round2((map.get(String(wa.workOrder)) || 0) + sign * wa.amount));
    }
    return map;
}

export function splitVat(total, letter, vatRate) {
    if (letter === 'C' || !vatRate) return { net: round2(total), vat: 0 };
    const net = round2(total / (1 + vatRate / 100));
    return { net, vat: round2(total - net) };
}

function checkDates(concept, date) {
    const window = concept === 1 ? 5 : 10;
    const diff = daysBetween(todayAR(), date);
    if (Math.abs(diff) > window) throw AppError.badRequest(`La fecha del comprobante debe estar dentro de ±${window} días de hoy.`);
}

// Crea el comprobante en estado Pendiente (todavía sin CAE).
export async function draftInvoice(data, req) {
    const settings = await getSettings();
    const ids = data.workOrders.map(w => w.id);
    if (new Set(ids).size !== ids.length) throw AppError.badRequest('Hay OTs repetidas.');
    const wos = await WorkOrder.find({ _id: { $in: ids } });
    if (wos.length !== ids.length) throw AppError.badRequest('Alguna OT no existe.');
    const clientIds = new Set(wos.map(w => String(w.client)));
    if (clientIds.size > 1) throw AppError.badRequest('Todas las OT tienen que ser del mismo cliente.');
    if (wos.some(w => w.status === 'Baja')) throw AppError.badRequest('No se facturan OT dadas de baja.');
    const rates = new Set(wos.map(w => w.vatRate));
    if (rates.size > 1) throw AppError.badRequest('Las OT tienen alícuotas de IVA distintas: facturalas por separado.');

    const client = await Client.findById([...clientIds][0]);
    const letter = resolveLetter(settings.ivaCondition, client.ivaCondition, wos[0].invoiceType);
    if (letter === 'A' && client.docType !== 'CUIT') throw AppError.badRequest('Para Factura A el cliente necesita CUIT.');
    const vatRate = letter === 'C' ? 0 : wos[0].vatRate;

    const reserved = await reservedByWorkOrder(ids);
    const workOrderAmounts = [];
    const items = [];
    for (const line of data.workOrders) {
        const wo = wos.find(w => String(w._id) === line.id);
        const remaining = round2(wo.total - wo.billing.invoiced - (reserved.get(String(wo._id)) || 0));
        const amount = round2(line.amount ?? remaining);
        if (amount <= 0) throw AppError.badRequest(`${wo.number} no tiene saldo para facturar.`);
        if (amount > remaining + 0.01) throw AppError.badRequest(`${wo.number}: el importe supera el saldo a facturar (${remaining}).`);
        workOrderAmounts.push({ workOrder: wo._id, amount });
        const full = Math.abs(amount - wo.total) < 0.01 && wo.billing.invoiced < 0.01;
        if (full) {
            for (const it of wo.items) items.push({ description: `${it.description} (${wo.number})`, quantity: it.quantity, unitPrice: it.unitPrice, subtotal: it.subtotal });
        } else {
            const { net } = splitVat(amount, letter, vatRate);
            items.push({ description: `${wo.number} ${wo.title || 'Trabajo'} - facturación parcial`, quantity: 1, unitPrice: net, subtotal: net });
        }
    }

    const total = sum(workOrderAmounts, w => w.amount);
    const net = sum(workOrderAmounts, w => splitVat(w.amount, letter, vatRate).net);
    const vat = round2(total - net);
    const date = data.date || new Date();
    checkDates(data.concept, date);
    const termDays = client.paymentTermDays ?? settings.defaultPaymentTermDays;
    const dueDate = data.dueDate || addDays(date, termDays);
    if (toYMD(dueDate) < toYMD(date)) throw AppError.badRequest('El vencimiento no puede ser anterior a la fecha.');
    const kind = `F${letter}`;

    return Invoice.create({
        kind, cbteType: CBTE_TYPES[kind].code, pointOfSale: settings.pointOfSale, date, concept: data.concept,
        serviceFrom: data.serviceFrom || date, serviceTo: data.serviceTo || date, dueDate,
        client: client._id, clientSnapshot: snapshot(client),
        workOrders: ids, workOrderAmounts, items, vatRate, net, vat, total,
        environment: arcaMode(), notes: data.notes, createdBy: req.user._id,
    });
}

function snapshot(client) {
    const docType = DOC_TYPES[client.docType] ?? 99;
    return {
        name: client.name, docType, docNumber: docType === 99 ? '0' : client.cuit,
        ivaCondition: client.ivaCondition, ivaConditionId: IVA_CONDITIONS[client.ivaCondition].arcaId,
        address: [client.address, client.city, client.province].filter(Boolean).join(', '),
    };
}

// ---- Exclusión mutua para numerar comprobantes ----
async function acquireLock(key) {
    const until = new Date(Date.now() + 2 * 60 * 1000);
    try {
        await IssueLock.create({ _id: key, until });
        return;
    } catch (e) {
        if (e.code !== 11000) throw e;
    }
    const taken = await IssueLock.findOneAndUpdate({ _id: key, until: { $lt: new Date() } }, { until });
    if (!taken) throw AppError.conflict('Se está emitiendo otro comprobante del mismo tipo. Reintentá en unos segundos.');
}
const releaseLock = (key) => IssueLock.deleteOne({ _id: key });

// Pide el CAE para un comprobante Pendiente o con Error.
export async function authorize(id, req) {
    const inv = await Invoice.findById(id);
    if (!inv) throw AppError.notFound('Comprobante');
    if (inv.status === 'Autorizada') throw AppError.badRequest('El comprobante ya está autorizado.');
    if (inv.status === 'Rechazada') throw AppError.badRequest('El comprobante fue rechazado. Corregí los datos y generá uno nuevo.');
    if (inv.environment !== arcaMode()) throw AppError.badRequest(`Este comprobante se generó en modo ${inv.environment} y el sistema está en ${arcaMode()}.`);
    const settings = await getSettings();
    const issuerCuit = isSimulated() ? (settings.cuit || '20000000001') : credentials().cuit;
    if (!isSimulated() && settings.cuit && settings.cuit !== issuerCuit) {
        throw AppError.badRequest('El CUIT de Configuración no coincide con el CUIT del certificado de ARCA.');
    }

    const lockKey = `${inv.environment}:${inv.pointOfSale}:${inv.cbteType}`;
    await acquireLock(lockKey);
    try {
        // Reintento seguro: si el intento anterior llegó a ARCA, se recupera ese CAE.
        if (inv.status === 'Error' && inv.number) {
            const existing = await wsfe.getVoucher(inv.pointOfSale, inv.cbteType, inv.number);
            if (existing && Math.abs(Number(existing.ImpTotal) - inv.total) < 0.01 && String(existing.DocNro) === String(inv.clientSnapshot.docNumber)) {
                return finalize(inv, { approved: true, cae: String(existing.CodAutorizacion), caeDue: existing.FchVto, observations: ['Recuperado de ARCA tras un error de conexión.'], errors: [] }, req);
            }
        }
        await assertBillable(inv);
        const last = await wsfe.lastAuthorized(inv.pointOfSale, inv.cbteType);
        inv.number = last + 1;
        inv.status = 'Error'; // si se corta acá, queda para reintentar con verificación
        await inv.save();

        let associated = null;
        if (inv.associated) {
            const orig = await Invoice.findById(inv.associated).lean();
            associated = { type: orig.cbteType, pointOfSale: orig.pointOfSale, number: orig.number, cuit: issuerCuit, date: toArcaDate(orig.date) };
        }
        const result = await wsfe.requestCAE({
            pointOfSale: inv.pointOfSale, cbteType: inv.cbteType, number: inv.number, letter: CBTE_TYPES[inv.kind].letter,
            concept: inv.concept, docType: inv.clientSnapshot.docType, docNumber: inv.clientSnapshot.docNumber,
            date: toArcaDate(inv.date), serviceFrom: toArcaDate(inv.serviceFrom), serviceTo: toArcaDate(inv.serviceTo),
            dueDate: toArcaDate(inv.dueDate), net: inv.net, vat: inv.vat, exempt: inv.exempt, total: inv.total,
            vatRate: inv.vatRate, receiverIvaId: inv.clientSnapshot.ivaConditionId, associated,
        });
        return await finalize(inv, result, req);
    } catch (e) {
        if (inv.status === 'Error') {
            inv.arcaErrors = [e.message];
            await inv.save();
        }
        throw e;
    } finally {
        await releaseLock(lockKey);
    }
}

async function assertBillable(inv) {
    if (CBTE_TYPES[inv.kind].credit) return;
    const wos = await WorkOrder.find({ _id: { $in: inv.workOrders } }).lean();
    for (const wa of inv.workOrderAmounts) {
        const wo = wos.find(w => String(w._id) === String(wa.workOrder));
        if (!wo || wo.status === 'Baja') throw AppError.badRequest('Una de las OT fue dada de baja.');
        if (wa.amount > round2(wo.total - wo.billing.invoiced) + 0.01) throw AppError.badRequest(`${wo.number} ya fue facturada por otro comprobante.`);
    }
}

function billingStatus(wo) {
    if (wo.billing.invoiced <= 0.009) return 'Sin facturar';
    if (wo.billing.invoiced >= wo.total - 0.01) return 'Facturada';
    return 'Parcial';
}

async function finalize(inv, result, req) {
    if (!result.approved) {
        inv.status = 'Rechazada';
        inv.arcaErrors = result.errors;
        inv.arcaObservations = result.observations;
        await inv.save();
        await audit(req, 'invoice.rejected', 'Invoice', inv._id, [...result.errors, ...result.observations].join(' | '));
        return inv;
    }
    await withTransaction(async (session) => {
        inv.status = 'Autorizada';
        inv.cae = result.cae;
        inv.caeDue = fromArcaDate(result.caeDue);
        inv.arcaObservations = result.observations;
        inv.arcaErrors = [];
        await inv.save({ session });
        const credit = CBTE_TYPES[inv.kind].credit;
        for (const wa of inv.workOrderAmounts) {
            const wo = await WorkOrder.findById(wa.workOrder).session(session);
            wo.billing.invoiced = round2(wo.billing.invoiced + (credit ? -wa.amount : wa.amount));
            wo.billing.status = billingStatus(wo);
            wo.history.push({ action: `${CBTE_TYPES[inv.kind].label} ${fullNumber(inv)} por ${wa.amount}`, user: req.user._id, userName: req.user.name });
            await wo.save({ session });
        }
        if (credit && inv.associated) {
            await Invoice.updateOne({ _id: inv.associated }, { $inc: { credited: inv.total } }, { session });
        }
    });
    await audit(req, 'invoice.authorized', 'Invoice', inv._id, `${fullNumber(inv)} CAE ${inv.cae} total ${inv.total}`);
    if (!CBTE_TYPES[inv.kind].credit) await applyPendingAdvances(inv, req);
    return Invoice.findById(inv._id);
}

// Aplica automáticamente los anticipos de esas OT a la factura nueva.
async function applyPendingAdvances(inv, req) {
    const advances = await Payment.find({ kind: 'anticipo', invoice: null, status: 'Vigente', workOrder: { $in: inv.workOrders } }).sort({ date: 1 });
    const { applyAdvance } = await import('./paymentService.js');
    for (const adv of advances) {
        const fresh = await Invoice.findById(inv._id).lean();
        if (fresh.total - fresh.paid - fresh.credited <= 0.009) break;
        try { await applyAdvance(adv._id, { invoice: inv._id }, req); } catch (e) { console.warn('[anticipo] no se aplicó', adv.number, e.message); }
    }
}

export async function createCreditNote(id, { amount, reason }, req) {
    const orig = await Invoice.findById(id);
    if (!orig) throw AppError.notFound('Comprobante');
    if (orig.status !== 'Autorizada' || !CREDIT_OF[orig.kind]) throw AppError.badRequest('Solo se emite nota de crédito sobre una factura autorizada.');
    const available = round2(orig.total - orig.credited - orig.paid);
    const total = round2(amount ?? available);
    if (available <= 0) throw AppError.badRequest('La factura no tiene saldo pendiente. Si hay que devolver dinero, anulá el cobro primero.');
    if (total > available + 0.01) throw AppError.badRequest(`El importe supera el saldo de la factura (${available}).`);
    const kind = CREDIT_OF[orig.kind];
    const ratio = total / orig.total;
    const net = round2(orig.net * ratio);
    const date = new Date();
    return Invoice.create({
        kind, cbteType: CBTE_TYPES[kind].code, pointOfSale: orig.pointOfSale, date, concept: orig.concept,
        serviceFrom: orig.serviceFrom, serviceTo: orig.serviceTo, dueDate: date,
        client: orig.client, clientSnapshot: orig.clientSnapshot, workOrders: orig.workOrders,
        workOrderAmounts: orig.workOrderAmounts.map(w => ({ workOrder: w.workOrder, amount: round2(w.amount * ratio) })),
        items: [{ description: `Nota de crédito s/ ${fullNumber(orig)}: ${reason}`, quantity: 1, unitPrice: net, subtotal: net }],
        vatRate: orig.vatRate, net, vat: round2(total - net), total, associated: orig._id,
        environment: orig.environment, notes: reason, createdBy: req.user._id,
    });
}

export function fullNumber(inv) {
    return `${CBTE_TYPES[inv.kind].label} ${String(inv.pointOfSale).padStart(5, '0')}-${String(inv.number ?? 0).padStart(8, '0')}`;
}

export async function listInvoices({ client, status, from, to, q, limit = 300 }) {
    const filter = {};
    if (client) filter.client = client;
    if (status === 'impagas') { filter.status = 'Autorizada'; filter.kind = { $in: ['FA', 'FB', 'FC', 'NDA', 'NDB', 'NDC'] }; } else if (status) filter.status = status;
    if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    if (q) filter['clientSnapshot.name'] = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    let list = await Invoice.find(filter).populate('workOrders', 'number').sort({ date: -1, number: -1 }).limit(limit).lean({ virtuals: true });
    list = list.map(i => ({ ...i, balance: CBTE_TYPES[i.kind].credit || i.status !== 'Autorizada' ? 0 : round2(i.total - i.paid - i.credited), fullNumber: fullNumber(i) }));
    if (status === 'impagas') list = list.filter(i => i.balance > 0.009);
    return list;
}

export async function getInvoice(id) {
    const inv = await Invoice.findById(id).populate('workOrders', 'number title').populate('associated');
    if (!inv) throw AppError.notFound('Comprobante');
    const payments = await Payment.find({ invoice: id }).sort({ date: 1 }).lean();
    const credits = await Invoice.find({ associated: id }).lean();
    return { ...inv.toObject(), fullNumber: fullNumber(inv), payments, credits: credits.map(c => ({ ...c, fullNumber: fullNumber(c) })) };
}

export async function discardDraft(id, req) {
    const inv = await Invoice.findById(id);
    if (!inv) throw AppError.notFound('Comprobante');
    if (inv.status === 'Autorizada') throw AppError.badRequest('Un comprobante autorizado no se borra: emití una nota de crédito.');
    if (inv.status === 'Error' && inv.number) {
        const existing = await wsfe.getVoucher(inv.pointOfSale, inv.cbteType, inv.number);
        if (existing) throw AppError.badRequest('Este comprobante llegó a ARCA. Usá "Reintentar" para recuperarlo.');
    }
    await inv.deleteOne();
    await audit(req, 'invoice.discard', 'Invoice', id, `Descartado borrador ${inv.kind}`);
}
