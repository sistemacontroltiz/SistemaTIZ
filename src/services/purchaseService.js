// Compras: ingreso de stock, actualización de costos del catálogo,
// imputación de costos a OTs y lectura opcional de facturas con IA.
import { Purchase, Product, StockMovement } from '../models/inventory.js';
import { Supplier } from '../models/parties.js';
import { WorkOrder } from '../models/sales.js';
import { nextNumber } from '../models/catalogs.js';
import AppError from '../utils/AppError.js';
import { round2, sum } from '../utils/money.js';
import { todayAR, toYMD } from '../utils/dates.js';
import { normalizeCuit } from '../utils/cuit.js';
import { withTransaction } from './tx.js';
import env from '../config/env.js';

export async function listPurchases({ q, from, to, supplier, limit = 300 }) {
    const filter = {};
    if (supplier) filter.supplier = supplier;
    if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ number: rx }, { supplierName: rx }, { invoiceNumber: rx }, { 'items.description': rx }];
    }
    return Purchase.find(filter).sort({ date: -1 }).limit(limit).populate('createdBy', 'name').lean();
}

export async function getPurchase(id) {
    const p = await Purchase.findById(id).populate('supplier').populate('items.product', 'name unit')
        .populate('items.allocations.workOrder', 'number clientName');
    if (!p) throw AppError.notFound('Compra');
    return p;
}

export async function createPurchase(data, req) {
    if (toYMD(data.date) > todayAR()) throw AppError.badRequest('La fecha de la compra no puede ser futura.');
    return withTransaction(async (session) => {
        const supplier = await Supplier.findById(data.supplier).session(session);
        if (!supplier) throw AppError.badRequest('El proveedor no existe.');

        const items = data.items.map(i => ({ ...i, total: round2(i.quantity * i.unitCost) }));
        for (const item of items) {
            const allocated = sum(item.allocations, a => a.amount);
            if (allocated > item.total + 0.01) throw AppError.badRequest(`"${item.description}": lo imputado a OTs supera el total del ítem.`);
        }
        const woIds = [...new Set(items.flatMap(i => i.allocations.map(a => String(a.workOrder))))];
        if (woIds.length) {
            const wos = await WorkOrder.find({ _id: { $in: woIds } }).session(session).lean();
            if (wos.length !== woIds.length) throw AppError.badRequest('Alguna OT imputada no existe.');
            const closed = wos.find(w => w.status === 'Baja');
            if (closed) throw AppError.badRequest(`La OT ${closed.number} está dada de baja.`);
        }
        const net = sum(items, i => i.total);
        const [purchase] = await Purchase.create([{
            ...data, items, net, total: round2(net + data.vat + data.otherTaxes),
            number: await nextNumber('purchase', 'COM-'),
            supplierName: supplier.name, createdBy: req.user._id,
        }], { session });

        // Stock y costos
        for (const item of purchase.items) {
            if (!item.product) continue;
            const p = await Product.findById(item.product).session(session);
            if (!p) throw AppError.badRequest(`Insumo inexistente en "${item.description}".`);
            const stockQty = round2(item.quantity * item.factor);
            const unitCost = round2(item.unitCost / item.factor);
            if (!p.isService) {
                p.stock = round2(p.stock + stockQty);
                await StockMovement.create([{
                    product: p._id, type: 'ingreso', quantity: stockQty, unitCost, purchase: purchase._id,
                    note: `${purchase.number} ${supplier.name}`, user: req.user._id, date: data.date,
                }], { session });
            }
            if (data.updateCosts && unitCost > 0) {
                p.cost = unitCost;
                p.costUpdatedAt = new Date();
                p.costHistory.push({ cost: unitCost, date: data.date, source: purchase.number, ref: purchase._id });
                if (p.costHistory.length > 50) p.costHistory.splice(0, p.costHistory.length - 50);
            }
            if (!p.suppliers.some(s => String(s) === String(supplier._id))) p.suppliers.push(supplier._id);
            await p.save({ session });
        }
        return purchase;
    });
}

export async function cancelPurchase(id, { reason }, req) {
    return withTransaction(async (session) => {
        const purchase = await Purchase.findById(id).session(session);
        if (!purchase) throw AppError.notFound('Compra');
        if (purchase.status === 'Anulada') throw AppError.badRequest('La compra ya está anulada.');
        const movements = await StockMovement.find({ purchase: purchase._id, type: 'ingreso' }).session(session);
        for (const m of movements) {
            await Product.updateOne({ _id: m.product }, { $inc: { stock: -m.quantity } }, { session });
            await StockMovement.create([{
                product: m.product, type: 'ajuste', quantity: -m.quantity, unitCost: m.unitCost, purchase: purchase._id,
                note: `Anulación ${purchase.number}: ${reason}`, user: req.user._id,
            }], { session });
        }
        purchase.status = 'Anulada';
        purchase.notes = `${purchase.notes}\nANULADA: ${reason}`.trim();
        await purchase.save({ session });
        return purchase;
    });
}

// ---------- Lectura de factura con IA (opcional) ----------
const AI_PROMPT = `Sos un asistente de carga de compras de una empresa argentina.
Leé la factura adjunta y devolvé SOLO un JSON válido, sin texto adicional, con esta forma:
{"supplierName":"","supplierCuit":"","date":"AAAA-MM-DD","invoiceType":"A|B|C","invoiceNumber":"0001-00001234",
"items":[{"description":"","quantity":0,"unit":"","unitCost":0}],"net":0,"vat":0,"otherTaxes":0,"total":0}
Los importes unitarios van SIN IVA. "otherTaxes" suma percepciones e impuestos internos. Si un dato no está, dejalo vacío o en 0.`;

export async function extractInvoiceWithAI(file) {
    if (!env.ANTHROPIC_API_KEY) throw new AppError('La lectura con IA no está configurada (falta ANTHROPIC_API_KEY).', 501);
    const isPdf = file.mimetype === 'application/pdf';
    const block = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') } };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env.AI_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: [block, { type: 'text', text: AI_PROMPT }] }] }),
        signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new AppError(`El servicio de IA respondió con error (${res.status}).`, 502);
    const body = await res.json();
    const textOut = body.content?.find(c => c.type === 'text')?.text || '';
    const match = textOut.match(/\{[\s\S]*\}/);
    let draft;
    try { draft = JSON.parse(match?.[0] ?? ''); } catch { throw new AppError('La IA no devolvió datos legibles. Cargá la compra a mano.', 502); }
    return matchDraft(draft);
}

// Vincula proveedor por CUIT e ítems con el catálogo por nombre.
export async function matchDraft(draft) {
    const cuit = normalizeCuit(draft.supplierCuit);
    const supplier = cuit ? await Supplier.findOne({ cuit }).select('name cuit').lean() : null;
    const products = await Product.find({ active: true }).select('name unit cost').lean();
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
    const items = (draft.items || []).slice(0, 300).map(i => {
        const d = norm(i.description);
        const product = products.find(p => norm(p.name) === d) || products.find(p => d.includes(norm(p.name)) && norm(p.name).length > 3);
        return {
            description: String(i.description || '').slice(0, 300), quantity: Number(i.quantity) || 1, unit: String(i.unit || '').slice(0, 30),
            unitCost: Number(i.unitCost) || 0, product: product?._id ?? null, productName: product?.name ?? null,
        };
    });
    return {
        supplier: supplier ?? null, supplierName: draft.supplierName || '', supplierCuit: cuit,
        date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : '',
        invoiceType: String(draft.invoiceType || '').slice(0, 2), invoiceNumber: String(draft.invoiceNumber || '').slice(0, 40),
        items, vat: Number(draft.vat) || 0, otherTaxes: Number(draft.otherTaxes) || 0, total: Number(draft.total) || 0,
    };
}

export async function stockMovements(productId, limit = 200) {
    return StockMovement.find({ product: productId }).populate('workOrder', 'number').populate('purchase', 'number')
        .populate('user', 'name').sort({ date: -1 }).limit(limit).lean();
}

export async function adjustStock(productId, { quantity, note }, req) {
    return withTransaction(async (session) => {
        const p = await Product.findById(productId).session(session);
        if (!p) throw AppError.notFound('Insumo');
        if (p.isService) throw AppError.badRequest('Los servicios no llevan stock.');
        p.stock = round2(p.stock + quantity);
        await p.save({ session });
        await StockMovement.create([{ product: p._id, type: 'ajuste', quantity, unitCost: p.cost, note, user: req.user._id }], { session });
        return p;
    });
}
