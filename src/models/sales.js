// Presupuestos, órdenes de trabajo y tareas de producción.
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const HistorySchema = new mongoose.Schema({
    action: { type: String, required: true },
    user: { type: ObjectId, ref: 'User' },
    userName: String,
    date: { type: Date, default: Date.now },
}, { _id: false });

const MaterialLineSchema = new mongoose.Schema({
    product: { type: ObjectId, ref: 'Product', default: null },
    name: { type: String, required: true, trim: true },
    unit: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
}, { _id: true });

const LaborLineSchema = new mongoose.Schema({
    laborRate: { type: ObjectId, ref: 'LaborRate', default: null },
    name: { type: String, required: true, trim: true },
    sector: { type: ObjectId, ref: 'Sector', default: null },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    totalCost: { type: Number, required: true, min: 0 },
    parallel: { type: Boolean, default: false }, // tarea paralela: sin predecesora (no se encadena)
}, { _id: true });

const QuoteItemSchema = new mongoose.Schema({
    description: { type: String, required: true, trim: true, maxlength: 500 },
    detail: { type: String, trim: true, default: '', maxlength: 2000 },
    quantity: { type: Number, required: true, min: 0.0001 },
    materials: [MaterialLineSchema],
    labor: [LaborLineSchema],
    marginPct: { type: Number, min: 0, max: 1000, default: 0 },
    // Calculados en el servidor (nunca se confía en el valor del navegador)
    costMaterials: { type: Number, default: 0 }, // por unidad
    costLabor: { type: Number, default: 0 },     // por unidad
    unitCost: { type: Number, default: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    priceOverride: { type: Boolean, default: false }, // precio fijado a mano
    subtotal: { type: Number, required: true, min: 0 },
}, { _id: true });

export const QUOTE_STATUS = ['Oportunidad', 'Borrador', 'Enviado', 'Aprobado', 'Rechazado', 'Vencido', 'Baja'];

const QuoteSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    clientName: { type: String, required: true },
    contact: { type: String, trim: true, default: '' },
    title: { type: String, trim: true, default: '', maxlength: 200 },
    invoiceType: { type: String, enum: ['A', 'B', 'C'], default: 'A' },
    vatRate: { type: Number, enum: [0, 10.5, 21, 27], default: 21 },
    items: [QuoteItemSchema],
    marginPct: { type: Number, default: 40 }, // margen sobre la venta, uno para todo el presupuesto
    net: { type: Number, default: 0 },
    vat: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    status: { type: String, enum: QUOTE_STATUS, default: 'Borrador' },
    issueDate: { type: Date, default: Date.now },
    validUntil: { type: Date, required: true }, // vigencia comercial
    deliveryDays: { type: Number, min: 0, default: null },
    paymentTerms: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '', maxlength: 3000 },
    // Aprobación: foto de costos validada por el servidor
    approval: {
        approvedBy: { type: ObjectId, ref: 'User' },
        approvedAt: Date,
        costSnapshot: { type: Number },
        warnings: [String],
    },
    rejectionReason: { type: String, trim: true, default: '' },
    // Alta de presupuesto: lo que pide el cliente, cargado por el vendedor en la oportunidad.
    requestDetails: { type: String, trim: true, default: '', maxlength: 2000 },
    assignedTo: { type: ObjectId, ref: 'User', default: null }, // CPO que tomó la oportunidad
    workOrder: { type: ObjectId, ref: 'WorkOrder', default: null },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    history: [HistorySchema],
}, { timestamps: true });
QuoteSchema.index({ status: 1, validUntil: 1 });
QuoteSchema.index({ client: 1, createdAt: -1 });
export const Quote = mongoose.model('Quote', QuoteSchema);

export const WO_STATUS = ['Pendiente', 'Pre-producción', 'Diseño', 'Producción', 'Calidad', 'Colocación', 'Lista para entrega', 'Entregada', 'Baja'];

const WorkOrderSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    quote: { type: ObjectId, ref: 'Quote', required: true, unique: true },
    quoteNumber: String,
    client: { type: ObjectId, ref: 'Client', required: true },
    clientName: { type: String, required: true },
    title: { type: String, default: '' },
    items: [{ description: String, detail: String, quantity: Number, unitPrice: Number, subtotal: Number }],
    net: Number, vat: Number, total: Number, plannedCost: Number,
    invoiceType: String, vatRate: Number,
    status: { type: String, enum: WO_STATUS, default: 'Pendiente' },
    priority: { type: String, enum: ['Normal', 'Alta', 'Urgente'], default: 'Normal' },
    dueDate: { type: Date, required: true },
    originalDueDate: { type: Date, required: true },
    reschedules: [{ from: Date, to: Date, reason: String, user: { type: ObjectId, ref: 'User' }, userName: String, date: { type: Date, default: Date.now } }],
    needsDesign: { type: Boolean, default: false },
    needsInstallation: { type: Boolean, default: false },
    installationAddress: { type: String, default: '' },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    deliveredAt: { type: Date, default: null },
    productionStartedAt: { type: Date, default: null },  // primera vez que entra a Producción
    productionEndedAt: { type: Date, default: null },     // última vez que sale de Producción (a Calidad+)
    billing: {
        invoiced: { type: Number, default: 0 },   // total facturado (neto de NC)
        status: { type: String, enum: ['Sin facturar', 'Parcial', 'Facturada'], default: 'Sin facturar' },
    },
    collected: { type: Number, default: 0 },     // cobros + retenciones aplicadas
    advances: { type: Number, default: 0 },      // anticipos recibidos
    cancellation: { reason: String, user: { type: ObjectId, ref: 'User' }, userName: String, date: Date },
    notes: { type: String, default: '' },
    history: [HistorySchema],
    createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
WorkOrderSchema.index({ status: 1, dueDate: 1 });
WorkOrderSchema.index({ client: 1 });
export const WorkOrder = mongoose.model('WorkOrder', WorkOrderSchema);

export const TASK_STATUS = ['Pendiente', 'En progreso', 'Completada'];
const TaskSchema = new mongoose.Schema({
    workOrder: { type: ObjectId, ref: 'WorkOrder', required: true },
    workOrderNumber: String,
    clientName: String,
    itemDescription: String,
    description: { type: String, required: true },
    sector: { type: ObjectId, ref: 'Sector', default: null },
    quantity: Number,
    kind: { type: String, enum: ['produccion', 'preprod'], default: 'produccion' }, // preprod = tareas previas a producir
    dueDate: { type: Date, default: null },
    order: { type: Number, default: 0 },           // orden de carga (para encadenar en Fase 3)
    predecessor: { type: ObjectId, ref: 'Task', default: null }, // no se puede tomar hasta que ésta termine
    status: { type: String, enum: TASK_STATUS, default: 'Pendiente' },
    assignedUser: { type: ObjectId, ref: 'User', default: null },
    startedAt: Date,
    finishedAt: Date,
    notes: { type: String, default: '' },
    history: [HistorySchema],
}, { timestamps: true });
TaskSchema.index({ sector: 1, status: 1 });
TaskSchema.index({ workOrder: 1 });
export const Task = mongoose.model('Task', TaskSchema);
