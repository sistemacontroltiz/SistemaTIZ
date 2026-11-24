// Facturas (ARCA), cobros y caché de tickets de acceso de ARCA.
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

// Códigos oficiales de comprobante de ARCA
export const CBTE_TYPES = {
    FA: { code: 1, letter: 'A', label: 'Factura A', credit: false },
    NDA: { code: 2, letter: 'A', label: 'Nota de Débito A', credit: false },
    NCA: { code: 3, letter: 'A', label: 'Nota de Crédito A', credit: true },
    FB: { code: 6, letter: 'B', label: 'Factura B', credit: false },
    NDB: { code: 7, letter: 'B', label: 'Nota de Débito B', credit: false },
    NCB: { code: 8, letter: 'B', label: 'Nota de Crédito B', credit: true },
    FC: { code: 11, letter: 'C', label: 'Factura C', credit: false },
    NDC: { code: 12, letter: 'C', label: 'Nota de Débito C', credit: false },
    NCC: { code: 13, letter: 'C', label: 'Nota de Crédito C', credit: true },
};

const InvoiceSchema = new mongoose.Schema({
    kind: { type: String, enum: Object.keys(CBTE_TYPES), required: true },
    cbteType: { type: Number, required: true },
    pointOfSale: { type: Number, required: true },
    number: { type: Number, default: null }, // lo asigna ARCA al autorizar
    date: { type: Date, required: true },
    concept: { type: Number, enum: [1, 2, 3], default: 3 }, // 1 productos, 2 servicios, 3 ambos
    serviceFrom: Date, serviceTo: Date,
    dueDate: { type: Date, required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    clientSnapshot: {
        name: String, docType: Number, docNumber: String, ivaCondition: String, ivaConditionId: Number, address: String,
    },
    workOrders: [{ type: ObjectId, ref: 'WorkOrder' }],
    workOrderAmounts: [{ workOrder: { type: ObjectId, ref: 'WorkOrder' }, amount: Number }], // total asignado a cada OT
    items: [{ description: String, quantity: Number, unitPrice: Number, subtotal: Number }],
    vatRate: { type: Number, default: 21 },
    net: { type: Number, required: true, min: 0 },
    vat: { type: Number, required: true, min: 0 },
    exempt: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0.01 },
    associated: { type: ObjectId, ref: 'Invoice', default: null }, // NC/ND -> factura original
    status: { type: String, enum: ['Pendiente', 'Autorizada', 'Rechazada', 'Error'], default: 'Pendiente' },
    environment: { type: String, enum: ['homologacion', 'produccion', 'simulado'], required: true },
    cae: { type: String, default: '' },
    caeDue: { type: Date, default: null },
    arcaObservations: [String],
    arcaErrors: [String],
    // Saldo de cobranza (solo para facturas/ND)
    paid: { type: Number, default: 0 },      // cobros + retenciones aplicadas
    credited: { type: Number, default: 0 },  // notas de crédito aplicadas
    notes: { type: String, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
InvoiceSchema.index(
    { pointOfSale: 1, cbteType: 1, number: 1, environment: 1 },
    { unique: true, partialFilterExpression: { number: { $type: 'number' } } },
);
InvoiceSchema.index({ client: 1, date: -1 });
InvoiceSchema.virtual('balance').get(function balance() {
    if (CBTE_TYPES[this.kind]?.credit || this.status !== 'Autorizada') return 0;
    return Math.round((this.total - this.paid - this.credited) * 100) / 100;
});
InvoiceSchema.set('toJSON', { virtuals: true });
InvoiceSchema.set('toObject', { virtuals: true });
export const Invoice = mongoose.model('Invoice', InvoiceSchema);

export const PAYMENT_METHODS = ['Transferencia', 'Efectivo', 'Cheque', 'eCheq', 'Tarjeta', 'Otro'];

const PaymentSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    kind: { type: String, enum: ['cobro', 'anticipo'], required: true },
    client: { type: ObjectId, ref: 'Client', required: true },
    clientName: String,
    invoice: { type: ObjectId, ref: 'Invoice', default: null },
    workOrder: { type: ObjectId, ref: 'WorkOrder', default: null },
    date: { type: Date, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: { type: String, trim: true, default: '' }, // n° de cheque, operación...
    chequeDueDate: { type: Date, default: null },
    amount: { type: Number, required: true, min: 0 },     // dinero recibido
    withholdings: {
        iva: { type: Number, min: 0, default: 0 },
        iibb: { type: Number, min: 0, default: 0 },
        ganancias: { type: Number, min: 0, default: 0 },
        suss: { type: Number, min: 0, default: 0 },
    },
    totalApplied: { type: Number, required: true, min: 0.01 }, // amount + retenciones
    status: { type: String, enum: ['Vigente', 'Anulado'], default: 'Vigente' },
    notes: { type: String, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
PaymentSchema.index({ client: 1, date: -1 });
PaymentSchema.index({ invoice: 1 });
PaymentSchema.index({ workOrder: 1 });
export const Payment = mongoose.model('Payment', PaymentSchema);

const ArcaTicketSchema = new mongoose.Schema({
    _id: String, // `${entorno}:${servicio}`
    token: String, sign: String, expiresAt: Date,
}, { timestamps: true });
export const ArcaTicket = mongoose.model('ArcaTicket', ArcaTicketSchema);

// Evita que dos personas emitan a la vez el mismo tipo de comprobante (numeración correlativa)
const IssueLockSchema = new mongoose.Schema({ _id: String, until: Date });
export const IssueLock = mongoose.model('IssueLock', IssueLockSchema);
