// Presupuestos: cálculo de costos y precios en el servidor, vigencia comercial,
// estados y aprobación con validación de insumos (genera la OT y sus tareas).
import { Quote, WorkOrder, Task } from '../models/sales.js';
import { Client } from '../models/parties.js';
import { Product } from '../models/inventory.js';
import { LaborRate, getSettings, nextNumber } from '../models/catalogs.js';
import AppError from '../utils/AppError.js';
import { round2, sum } from '../utils/money.js';
import { addDays, todayAR, toYMD } from '../utils/dates.js';
import { withTransaction } from './tx.js';
import { historyEntry } from './auditService.js';

export const COST_DRIFT_PCT = 5; // aviso si el costo de catálogo subió más de 5%

// Calcula costos, precio unitario, subtotales y totales. Ignora cualquier total
// que haya mandado el navegador.
export function computeQuote(input) {
    // Margen sobre la venta, uno para todo el presupuesto: precio = costo / (1 - margen).
    const marginPct = Math.min(Math.max(Number(input.marginPct) || 0, 0), 99.9);
    const factor = 1 - marginPct / 100;
    const items = input.items.map((it) => {
        const materials = (it.materials || []).map(m => ({ ...m, totalCost: round2(m.quantity * m.unitCost) }));
        const labor = (it.labor || []).map(l => ({ ...l, totalCost: round2(l.quantity * l.unitCost) }));
        const costMaterials = sum(materials, m => m.totalCost);
        const costLabor = sum(labor, l => l.totalCost);
        const unitCost = round2(costMaterials + costLabor);
        const unitPrice = it.priceOverride && it.unitPrice !== undefined
            ? round2(it.unitPrice)
            : round2(factor > 0 ? unitCost / factor : unitCost);
        return {
            ...it, materials, labor, costMaterials, costLabor, unitCost, unitPrice,
            subtotal: round2(unitPrice * it.quantity),
        };
    });
    const net = sum(items, i => i.subtotal);
    const vatRate = input.invoiceType === 'C' ? 0 : input.vatRate;
    const vat = round2(net * vatRate / 100);
    return {
        items, marginPct, vatRate, net, vat, total: round2(net + vat),
        totalCost: sum(items, i => i.unitCost * i.quantity),
    };
}

// Completa nombre/unidad desde el catálogo y valida que los vínculos existan.
async function hydrateLines(items) {
    const productIds = items.flatMap(i => i.materials.map(m => m.product)).filter(Boolean);
    const laborIds = items.flatMap(i => i.labor.map(l => l.laborRate)).filter(Boolean);
    const [products, rates] = await Promise.all([
        Product.find({ _id: { $in: productIds } }).lean(),
        LaborRate.find({ _id: { $in: laborIds } }).lean(),
    ]);
    const pMap = new Map(products.map(p => [String(p._id), p]));
    const rMap = new Map(rates.map(r => [String(r._id), r]));
    for (const item of items) {
        for (const m of item.materials) {
            if (!m.product) continue;
            const p = pMap.get(String(m.product));
            if (!p) throw AppError.badRequest(`El insumo "${m.name}" ya no existe en el catálogo.`);
            m.unit = m.unit || p.unit;
        }
        for (const l of item.labor) {
            if (!l.laborRate) continue;
            const r = rMap.get(String(l.laborRate));
            if (!r) throw AppError.badRequest(`La mano de obra "${l.name}" ya no existe.`);
            if (!l.sector && r.sector) l.sector = r.sector;
        }
    }
    return items;
}

async function expireOverdue() {
    // Los presupuestos sin aprobar cuya vigencia venció pasan a "Vencido".
    const today = new Date(`${todayAR()}T00:00:00-03:00`);
    await Quote.updateMany(
        { status: { $in: ['Borrador', 'Enviado'] }, validUntil: { $lt: today } },
        { $set: { status: 'Vencido' }, $push: { history: { action: 'Vencido por fin de vigencia', userName: 'sistema', date: new Date() } } },
    );
}

export async function listQuotes({ q, status, client, from, to, limit = 200 }) {
    await expireOverdue();
    const filter = {};
    if (status) filter.status = status;
    if (client) filter.client = client;
    if (from || to) filter.issueDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ number: rx }, { clientName: rx }, { title: rx }];
    }
    return Quote.find(filter).select('-items.materials -items.labor -history')
        .populate('workOrder', 'number status').populate('createdBy', 'name')
        .sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getQuote(id) {
    await expireOverdue();
    const quote = await Quote.findById(id).populate('client').populate('createdBy', 'name')
        .populate('workOrder', 'number status').populate('approval.approvedBy', 'name');
    if (!quote) throw AppError.notFound('Presupuesto');
    return quote;
}

export async function createQuote(data, req) {
    const client = await Client.findById(data.client);
    if (!client || !client.active) throw AppError.badRequest('El cliente no existe o está inactivo.');
    const settings = await getSettings();
    const items = await hydrateLines(data.items);
    const calc = computeQuote({ ...data, items });
    const validUntil = data.validUntil || addDays(new Date(), settings.quoteValidityDays);
    if (toYMD(validUntil) < todayAR()) throw AppError.badRequest('La vigencia no puede ser anterior a hoy.');
    return Quote.create({
        ...data, ...calc, validUntil,
        number: await nextNumber('quote', 'PRE-'),
        clientName: client.name,
        status: 'Borrador',
        createdBy: req.user._id,
        history: [historyEntry(req, 'Presupuesto creado')],
    });
}

// Alta de presupuesto: el vendedor carga la oportunidad (sin ítems todavía).
export async function createOpportunity(data, req) {
    const client = await Client.findById(data.client);
    if (!client || !client.active) throw AppError.badRequest('El cliente no existe o está inactivo.');
    const settings = await getSettings();
    return Quote.create({
        number: await nextNumber('quote', 'PRE-'),
        client: data.client, clientName: client.name, title: data.title || '', contact: data.contact || '',
        requestDetails: data.requestDetails,
        items: [], net: 0, vat: 0, total: 0, totalCost: 0,
        invoiceType: client.ivaCondition === 'RI' ? 'A' : 'C', vatRate: 21,
        validUntil: addDays(new Date(), settings.quoteValidityDays),
        status: 'Oportunidad',
        createdBy: req.user._id,
        history: [historyEntry(req, 'Oportunidad cargada (alta de presupuesto)')],
    });
}

// El vendedor corrige los datos de la oportunidad mientras sigue sin tomarse.
export async function updateOpportunity(id, data, req) {
    const quote = await Quote.findById(id);
    if (!quote) throw AppError.notFound('Presupuesto');
    if (quote.status !== 'Oportunidad') throw AppError.badRequest('Solo se puede editar mientras es una oportunidad sin tomar.');
    const client = await Client.findById(data.client);
    if (!client) throw AppError.badRequest('El cliente no existe.');
    quote.set({ client: data.client, clientName: client.name, title: data.title || '', contact: data.contact || '', requestDetails: data.requestDetails });
    quote.history.push(historyEntry(req, 'Oportunidad editada'));
    await quote.save();
    return quote;
}

// El CPO toma la oportunidad: pasa a Borrador para armar ítems y mano de obra.
export async function takeOpportunity(id, req) {
    const quote = await Quote.findById(id);
    if (!quote) throw AppError.notFound('Presupuesto');
    if (quote.status !== 'Oportunidad') throw AppError.badRequest(`Esta oportunidad ya fue tomada (estado "${quote.status}").`);
    quote.status = 'Borrador';
    quote.assignedTo = req.user._id;
    quote.history.push(historyEntry(req, `Tomada por ${req.user.name} para armar el presupuesto`));
    await quote.save();
    return quote;
}

export async function updateQuote(id, data, req) {
    const quote = await Quote.findById(id);
    if (!quote) throw AppError.notFound('Presupuesto');
    if (!['Borrador', 'Enviado', 'Rechazado'].includes(quote.status)) {
        throw AppError.badRequest(`Un presupuesto en estado "${quote.status}" no se puede editar.${quote.status === 'Vencido' ? ' Extendé la vigencia primero.' : ''}`);
    }
    const client = await Client.findById(data.client);
    if (!client) throw AppError.badRequest('El cliente no existe.');
    const items = await hydrateLines(data.items);
    const calc = computeQuote({ ...data, items });
    quote.set({ ...data, ...calc, clientName: client.name, validUntil: data.validUntil || quote.validUntil });
    if (toYMD(quote.validUntil) < todayAR()) throw AppError.badRequest('La vigencia no puede ser anterior a hoy.');
    if (quote.status === 'Rechazado') quote.status = 'Borrador';
    quote.history.push(historyEntry(req, `Presupuesto editado (total ${calc.total})`));
    await quote.save();
    return quote;
}

const TRANSITIONS = {
    Oportunidad: ['Baja'],
    Borrador: ['Enviado', 'Baja'],
    Enviado: ['Borrador', 'Rechazado', 'Baja'],
    Rechazado: ['Borrador', 'Baja'],
    Vencido: ['Baja'],
    Aprobado: [],
    Baja: [],
};

export async function changeQuoteStatus(id, { status, reason }, req) {
    const quote = await Quote.findById(id);
    if (!quote) throw AppError.notFound('Presupuesto');
    if (!TRANSITIONS[quote.status]?.includes(status)) {
        throw AppError.badRequest(`No se puede pasar de "${quote.status}" a "${status}".`);
    }
    if (['Rechazado', 'Baja'].includes(status) && !reason) throw AppError.badRequest('Indicá el motivo.');
    if (status === 'Enviado' && (!quote.items || quote.items.length === 0)) {
        throw AppError.badRequest('Agregá al menos un ítem antes de enviar el presupuesto al cliente.');
    }
    quote.status = status;
    if (status === 'Rechazado') quote.rejectionReason = reason;
    quote.history.push(historyEntry(req, `Estado: ${status}${reason ? ` (${reason})` : ''}`));
    await quote.save();
    return quote;
}

export async function extendValidity(id, { validUntil }, req) {
    const quote = await Quote.findById(id);
    if (!quote) throw AppError.notFound('Presupuesto');
    if (!['Borrador', 'Enviado', 'Vencido'].includes(quote.status)) throw AppError.badRequest('Solo se extiende la vigencia de presupuestos no aprobados.');
    if (toYMD(validUntil) < todayAR()) throw AppError.badRequest('La nueva vigencia tiene que ser hoy o posterior.');
    quote.validUntil = validUntil;
    if (quote.status === 'Vencido') quote.status = 'Enviado';
    quote.history.push(historyEntry(req, `Vigencia extendida al ${toYMD(validUntil)}`));
    await quote.save();
    return quote;
}

// Revisión previa a aprobar: errores bloquean, avisos requieren confirmación.
export async function reviewForApproval(quote) {
    const errors = [];
    const warnings = [];
    if (toYMD(quote.validUntil) < todayAR()) errors.push('La vigencia del presupuesto está vencida.');
    if (!quote.items.length) errors.push('El presupuesto no tiene ítems.');
    if (quote.total <= 0) errors.push('El total del presupuesto es 0.');

    const productIds = quote.items.flatMap(i => i.materials.map(m => m.product)).filter(Boolean);
    const products = new Map((await Product.find({ _id: { $in: productIds } }).lean()).map(p => [String(p._id), p]));
    for (const item of quote.items) {
        if (!item.materials.length && !item.labor.length && !item.priceOverride) {
            warnings.push(`"${item.description}": no tiene costos cargados.`);
        }
        if (item.unitPrice < item.unitCost) warnings.push(`"${item.description}": el precio está por debajo del costo.`);
        for (const m of item.materials) {
            if (m.unitCost <= 0) errors.push(`"${item.description}" → "${m.name}": costo en 0.`);
            if (!m.product) { warnings.push(`"${item.description}" → "${m.name}": no está vinculado al catálogo.`); continue; }
            const p = products.get(String(m.product));
            if (!p || !p.active) { errors.push(`"${m.name}": el insumo está inactivo o no existe.`); continue; }
            if (p.cost > m.unitCost * (1 + COST_DRIFT_PCT / 100)) {
                warnings.push(`"${m.name}": el costo actual (${p.cost}) es mayor al cotizado (${m.unitCost}).`);
            }
        }
    }
    return { errors, warnings };
}

export async function approveQuote(id, opts, req) {
    return withTransaction(async (session) => {
        const quote = await Quote.findById(id).session(session);
        if (!quote) throw AppError.notFound('Presupuesto');
        if (!['Borrador', 'Enviado'].includes(quote.status)) {
            throw AppError.badRequest(`No se puede aprobar un presupuesto en estado "${quote.status}".`);
        }
        if (quote.workOrder) throw AppError.conflict('Este presupuesto ya tiene una OT.');
        if (toYMD(opts.dueDate) < todayAR()) throw AppError.badRequest('La fecha de entrega no puede ser anterior a hoy.');

        // Se recalcula todo en el servidor antes de aprobar.
        Object.assign(quote, computeQuote(quote.toObject()));
        const { errors, warnings } = await reviewForApproval(quote);
        if (errors.length) throw new AppError('No se puede aprobar: hay errores en los costos.', 422, { errors, warnings });
        if (warnings.length && !opts.acceptWarnings) {
            throw new AppError('Revisá los avisos antes de aprobar.', 409, { errors, warnings, needsConfirmation: true });
        }

        const [wo] = await WorkOrder.create([{
            number: await nextNumber('workorder', 'OT-'),
            quote: quote._id, quoteNumber: quote.number,
            client: quote.client, clientName: quote.clientName, title: quote.title,
            items: quote.items.map(i => ({ description: i.description, detail: i.detail, quantity: i.quantity, unitPrice: i.unitPrice, subtotal: i.subtotal })),
            net: quote.net, vat: quote.vat, total: quote.total, plannedCost: quote.totalCost,
            invoiceType: quote.invoiceType, vatRate: quote.vatRate,
            status: opts.preProduction ? 'Pre-producción' : (opts.needsDesign ? 'Diseño' : 'Pendiente'),
            priority: opts.priority,
            dueDate: opts.dueDate, originalDueDate: opts.dueDate,
            needsDesign: opts.needsDesign, needsInstallation: opts.needsInstallation,
            installationAddress: opts.installationAddress,
            createdBy: req.user._id,
            history: [historyEntry(req, `OT creada desde ${quote.number}`)],
        }], { session });

        // Una tarea de producción por cada línea de mano de obra, en el orden en que se cargaron.
        const laborLines = quote.items.flatMap(item => item.labor.map(l => ({
            workOrder: wo._id, workOrderNumber: wo.number, clientName: wo.clientName,
            itemDescription: item.description, description: l.name, sector: l.sector,
            quantity: round2(l.quantity * item.quantity), parallel: !!l.parallel,
        })));
        let tasks = [];
        if (laborLines.length) {
            tasks = await Task.insertMany(laborLines.map((t, i) => ({ ...t, order: i + 1 })), { session, ordered: true });
            // Encadenar por orden de carga: cada tarea depende de la anterior.
            // Una tarea paralela no tiene predecesora y tampoco encadena a la siguiente.
            let lastSeqId = null;
            const chain = [];
            tasks.forEach((t, i) => {
                if (laborLines[i].parallel) return;
                if (lastSeqId) chain.push({ updateOne: { filter: { _id: t._id }, update: { $set: { predecessor: lastSeqId } } } });
                lastSeqId = t._id;
            });
            if (chain.length) await Task.bulkWrite(chain, { session });
        }

        // Pre-producción: 4 tareas previas a producir. b (planos) depende de a (relevamiento);
        // d (control de presupuesto) depende de c (pedidos de presupuestos).
        let preCreated = 0;
        if (opts.preProduction) {
            const base = { workOrder: wo._id, workOrderNumber: wo.number, clientName: wo.clientName, kind: 'preprod', sector: null };
            const now = new Date();
            const [relev, planos, pedidos, control] = await Task.create([
                { ...base, description: 'Relevamiento de medidas', order: 1, dueDate: addDays(now, 5), history: [historyEntry(req, 'Creada (pre-producción)')] },
                { ...base, description: 'Armado de planos y detalles', order: 2, dueDate: addDays(now, 2), history: [historyEntry(req, 'Creada (pre-producción)')] },
                { ...base, description: 'Pedidos de presupuestos (tercerizados)', order: 3, dueDate: addDays(now, 5), history: [historyEntry(req, 'Creada (pre-producción)')] },
                { ...base, description: 'Control de presupuesto (elegir con cuál avanzar)', order: 4, dueDate: addDays(now, 5), history: [historyEntry(req, 'Creada (pre-producción)')] },
            ], { session, ordered: true });
            planos.predecessor = relev._id;
            control.predecessor = pedidos._id;
            await planos.save({ session });
            await control.save({ session });
            preCreated = 4;
        }

        quote.status = 'Aprobado';
        quote.workOrder = wo._id;
        quote.approval = { approvedBy: req.user._id, approvedAt: new Date(), costSnapshot: quote.totalCost, warnings };
        quote.history.push(historyEntry(req, `Aprobado. Genera ${wo.number}${warnings.length ? ` con ${warnings.length} aviso(s) aceptado(s)` : ''}`));
        await quote.save({ session });
        return { quote, workOrder: wo, tasksCreated: tasks.length, preProductionTasks: preCreated };
    });
}

export async function duplicateQuote(id, req) {
    const src = await Quote.findById(id).lean();
    if (!src) throw AppError.notFound('Presupuesto');
    const clean = (arr) => arr.map(({ _id, ...rest }) => rest);
    return createQuote({
        client: src.client, contact: src.contact, title: src.title, invoiceType: src.invoiceType, vatRate: src.vatRate,
        deliveryDays: src.deliveryDays, paymentTerms: src.paymentTerms, notes: src.notes,
        items: src.items.map(({ _id, ...i }) => ({ ...i, materials: clean(i.materials), labor: clean(i.labor) })),
    }, req);
}
