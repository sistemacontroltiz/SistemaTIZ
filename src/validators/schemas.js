// Esquemas de validación de TODO lo que entra por la API.
// Solo pasan los campos declarados acá; el resto se descarta.
import { z } from 'zod';
import { ALL_PERMISSIONS } from '../config/permissions.js';
import { isValidCuit, normalizeCuit } from '../utils/cuit.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Identificador inválido');
const optId = objectId.nullable().optional().or(z.literal('').transform(() => null));
const text = (max = 200) => z.string().trim().max(max);
const optText = (max = 200) => text(max).optional().default('');
const money = z.coerce.number().min(0, 'No puede ser negativo').max(1e12);
const qty = z.coerce.number().positive('Debe ser mayor a 0').max(1e9);
const date = z.coerce.date({ error: 'Fecha inválida' });
const optDate = z.union([date, z.literal('').transform(() => null), z.null()]).optional();
const email = z.string().trim().toLowerCase().max(160).pipe(z.email('Email inválido'));
const optEmail = z.union([email, z.literal('')]).optional().default('');

export const idParam = z.object({ id: objectId });
export const pagination = z.object({
    q: text(100).optional(),
    status: text(40).optional(),
    from: optDate, to: optDate,
    client: objectId.optional(),
    limit: z.coerce.number().int().min(1).max(2000).default(100),
    page: z.coerce.number().int().min(1).default(1),
}).passthrough();

// ---------- Auth / usuarios / roles ----------
export const passwordRule = z.string()
    .min(10, 'Mínimo 10 caracteres')
    .max(128)
    .regex(/[a-z]/, 'Debe tener una minúscula')
    .regex(/[A-Z]/, 'Debe tener una mayúscula')
    .regex(/\d/, 'Debe tener un número');

export const login = z.object({ email, password: z.string().min(1).max(128) });
export const changePassword = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordRule });

export const userCreate = z.object({
    name: text(120).min(2), email, password: passwordRule, role: objectId, sector: optId,
    active: z.boolean().optional().default(true),
});
export const userUpdate = z.object({
    name: text(120).min(2).optional(), email: email.optional(), password: passwordRule.optional(),
    role: objectId.optional(), sector: optId, active: z.boolean().optional(),
});
export const roleSchema = z.object({
    key: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,30}$/, 'Solo minúsculas, números, - y _'),
    label: text(60).min(2),
    permissions: z.array(z.enum(ALL_PERMISSIONS)).max(ALL_PERMISSIONS.length),
});

// ---------- Configuración ----------
export const settingsSchema = z.object({
    businessName: optText(200), tradeName: optText(200),
    cuit: z.string().transform(normalizeCuit).refine(v => v === '' || isValidCuit(v), 'CUIT inválido').optional(),
    ivaCondition: z.enum(['RI', 'MT', 'EX']).optional(),
    address: optText(300), iibb: optText(40), activityStart: optDate, phone: optText(60), email: optEmail,
    pointOfSale: z.coerce.number().int().min(1).max(99998).optional(),
    quoteValidityDays: z.coerce.number().int().min(1).max(365).optional(),
    defaultPaymentTermDays: z.coerce.number().int().min(0).max(365).optional(),
    quoteTerms: optText(3000),
});
export const sectorSchema = z.object({ name: text(80).min(2), description: optText(300), active: z.boolean().optional() });
export const laborRateSchema = z.object({
    name: text(120).min(2), unit: optText(30), cost: money, sector: optId, active: z.boolean().optional(),
});
export const qualityTemplateSchema = z.object({
    name: text(120).min(2), description: optText(500),
    items: z.array(text(300).min(1)).min(1, 'Agregá al menos un punto de control').max(100),
    active: z.boolean().optional(),
});

// ---------- Clientes / proveedores ----------
const contact = z.object({
    _id: objectId.optional(), name: text(120).min(1), position: optText(80), email: optEmail, phone: optText(60),
    receivesInvoices: z.boolean().optional().default(false),
});
const party = {
    name: text(200).min(2, 'La razón social es obligatoria'), tradeName: optText(200),
    docType: z.enum(['CUIT', 'DNI', 'SIN']).default('CUIT'),
    cuit: z.string().transform(normalizeCuit).optional().default(''),
    ivaCondition: z.enum(['RI', 'MT', 'EX', 'CF', 'NR']).default('RI'),
    address: optText(300), city: optText(100), province: optText(100), phone: optText(60), email: optEmail,
    contacts: z.array(contact).max(50).optional().default([]), notes: optText(2000), active: z.boolean().optional(),
};
const cuitCheck = (o) => o.docType !== 'CUIT' || isValidCuit(o.cuit);
export const clientSchema = z.object({ ...party, paymentTermDays: z.coerce.number().int().min(0).max(365).nullable().optional() })
    .refine(cuitCheck, { message: 'CUIT inválido (revisá el dígito verificador)', path: ['cuit'] });
export const supplierSchema = z.object({ ...party, category: optText(80) })
    .refine(cuitCheck, { message: 'CUIT inválido (revisá el dígito verificador)', path: ['cuit'] });
export const cuitParam = z.object({ cuit: z.string().transform(normalizeCuit).refine(isValidCuit, 'CUIT inválido') });

// ---------- Catálogo / stock ----------
export const productSchema = z.object({
    name: text(200).min(2), sku: optText(60), category: optText(80), unit: text(30).min(1),
    equivalences: z.array(z.object({ unit: text(30).min(1), factor: qty })).max(20).optional().default([]),
    cost: money.optional(), minStock: money.optional(), isService: z.boolean().optional(),
    suppliers: z.array(objectId).max(30).optional(), active: z.boolean().optional(),
});
export const stockAdjust = z.object({
    quantity: z.coerce.number().refine(v => v !== 0, 'La cantidad no puede ser 0').refine(Number.isFinite),
    note: text(300).min(3, 'Indicá el motivo del ajuste'),
});
export const consumeSchema = z.object({
    lines: z.array(z.object({ product: objectId, quantity: qty, note: optText(200) })).min(1).max(100),
});

// ---------- Presupuestos ----------
const materialLine = z.object({
    product: optId, name: text(200).min(1), unit: optText(30), quantity: z.coerce.number().min(0), unitCost: money,
});
const laborLine = z.object({
    laborRate: optId, name: text(200).min(1), sector: optId, quantity: z.coerce.number().min(0), unitCost: money,
    parallel: z.boolean().optional().default(false),
});
const quoteItem = z.object({
    description: text(500).min(1, 'Cada ítem necesita descripción'), detail: optText(2000), quantity: qty,
    materials: z.array(materialLine).max(200).optional().default([]),
    labor: z.array(laborLine).max(100).optional().default([]),
    marginPct: z.coerce.number().min(0).max(1000).default(0),
    priceOverride: z.boolean().optional().default(false),
    unitPrice: money.optional(),
});
export const quoteSchema = z.object({
    client: objectId, contact: optText(120), title: optText(200),
    invoiceType: z.enum(['A', 'B', 'C']).default('A'),
    vatRate: z.coerce.number().refine(v => [0, 10.5, 21, 27].includes(v), 'Alícuota inválida').default(21),
    marginPct: z.coerce.number().min(0).max(99.9).default(40),
    items: z.array(quoteItem).min(1, 'Agregá al menos un ítem').max(200),
    validUntil: optDate, deliveryDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
    paymentTerms: optText(300), notes: optText(3000),
});
export const opportunitySchema = z.object({
    client: objectId,
    title: optText(200),
    requestDetails: text(2000).min(1, 'Contá qué pide el cliente'),
    contact: optText(120),
});
export const quoteStatus = z.object({
    status: z.enum(['Enviado', 'Rechazado', 'Baja', 'Borrador']),
    reason: optText(500),
});
export const quoteApprove = z.object({
    dueDate: date, needsDesign: z.boolean().optional().default(false),
    needsInstallation: z.boolean().optional().default(false), installationAddress: optText(300),
    priority: z.enum(['Normal', 'Alta', 'Urgente']).optional().default('Normal'),
    acceptWarnings: z.boolean().optional().default(false),
    preProduction: z.boolean().optional().default(false),
});
export const quoteExtend = z.object({ validUntil: date });

// ---------- OT / producción ----------
export const woStatus = z.object({
    status: z.enum(['Pendiente', 'Diseño', 'Producción', 'Calidad', 'Colocación', 'Lista para entrega', 'Entregada']),
    note: optText(500),
});
export const woReschedule = z.object({ dueDate: date, reason: text(500).min(5, 'Explicá el motivo de la reprogramación') });
export const woCancel = z.object({ reason: text(500).min(5, 'Indicá el motivo de la baja') });
export const woUpdate = z.object({
    priority: z.enum(['Normal', 'Alta', 'Urgente']).optional(), notes: optText(3000).optional(),
    needsDesign: z.boolean().optional(), needsInstallation: z.boolean().optional(), installationAddress: optText(300).optional(),
});
export const taskAssign = z.object({ sector: optId, assignedUser: optId });
export const taskNote = z.object({ notes: optText(1000) });

// ---------- Compras ----------
const purchaseItem = z.object({
    product: optId, description: text(300).min(1), quantity: qty, unit: optText(30),
    factor: z.coerce.number().positive().default(1), unitCost: money,
    allocations: z.array(z.object({ workOrder: objectId, amount: money })).max(50).optional().default([]),
});
export const purchaseSchema = z.object({
    supplier: objectId, date, invoiceType: optText(10), invoiceNumber: optText(40),
    items: z.array(purchaseItem).min(1).max(300),
    vat: money.optional().default(0), otherTaxes: money.optional().default(0), notes: optText(1000),
    updateCosts: z.boolean().optional().default(true),
});

// ---------- Calidad / colocaciones ----------
export const qualityCheckSchema = z.object({
    workOrder: objectId, template: optId,
    results: z.array(z.object({ item: text(300).min(1), ok: z.boolean(), note: optText(500) })).min(1).max(100),
    observations: optText(2000),
    materialReusable: z.enum(['si', 'no']).optional(),
});
export const installationSchema = z.object({
    workOrder: objectId, date, timeSlot: optText(40), address: text(300).min(3), contactName: optText(120),
    contactPhone: optText(60), team: z.array(objectId).max(20).optional().default([]), vehicle: optText(60),
    instructions: optText(2000),
});
export const installationUpdate = installationSchema.partial().omit({ workOrder: true });
export const installationClose = z.object({
    status: z.enum(['Realizada', 'Reprogramada', 'Cancelada']), result: optText(2000), newDate: optDate,
});

// ---------- Facturación ----------
export const invoiceSchema = z.object({
    workOrders: z.array(z.object({ id: objectId, amount: money.optional() })).min(1, 'Elegí al menos una OT').max(50),
    concept: z.coerce.number().refine(v => [1, 2, 3].includes(v)).default(3),
    date: optDate, dueDate: optDate, serviceFrom: optDate, serviceTo: optDate, notes: optText(1000),
});
export const creditNoteSchema = z.object({
    amount: money.refine(v => v > 0, 'El importe debe ser mayor a 0').optional(),
    reason: text(500).min(3, 'Indicá el motivo de la nota de crédito'),
});

// ---------- Cobranzas ----------
const withholdings = z.object({
    iva: money.default(0), iibb: money.default(0), ganancias: money.default(0), suss: money.default(0),
}).default({ iva: 0, iibb: 0, ganancias: 0, suss: 0 });
export const paymentSchema = z.object({
    kind: z.enum(['cobro', 'anticipo']),
    client: objectId, invoice: optId, workOrder: optId, date,
    method: z.enum(['Transferencia', 'Efectivo', 'Cheque', 'eCheq', 'Tarjeta', 'Otro']),
    reference: optText(100), chequeDueDate: optDate, amount: money, withholdings, notes: optText(500),
});
export const paymentApply = z.object({ invoice: objectId });
export const paymentCancel = z.object({ reason: text(300).min(3) });
