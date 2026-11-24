// Clientes y proveedores comparten estructura de contactos y datos fiscales.
import mongoose from 'mongoose';
import { isValidCuit, normalizeCuit } from '../utils/cuit.js';

export const IVA_CONDITIONS = {
    RI: { label: 'Responsable Inscripto', arcaId: 1 },
    MT: { label: 'Monotributo', arcaId: 6 },
    EX: { label: 'IVA Exento', arcaId: 4 },
    CF: { label: 'Consumidor Final', arcaId: 5 },
    NR: { label: 'No Responsable / No Categorizado', arcaId: 7 },
};

const ContactSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    position: { type: String, trim: true, default: '' }, // cargo
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    receivesInvoices: { type: Boolean, default: false },
}, { _id: true });

const partyFields = {
    name: { type: String, required: true, trim: true, maxlength: 200 }, // razón social
    tradeName: { type: String, trim: true, default: '' },
    docType: { type: String, enum: ['CUIT', 'DNI', 'SIN'], default: 'CUIT' },
    cuit: {
        type: String, trim: true, set: normalizeCuit,
        validate: { validator(v) { return this.docType !== 'CUIT' || isValidCuit(v); }, message: 'CUIT inválido (revisá el dígito verificador).' },
    },
    ivaCondition: { type: String, enum: Object.keys(IVA_CONDITIONS), default: 'RI' },
    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    province: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    contacts: [ContactSchema],
    notes: { type: String, trim: true, default: '', maxlength: 2000 },
    active: { type: Boolean, default: true },
};

const ClientSchema = new mongoose.Schema({
    ...partyFields,
    paymentTermDays: { type: Number, min: 0, default: null }, // null = usar el de configuración
}, { timestamps: true });
ClientSchema.index({ cuit: 1 }, { unique: true, partialFilterExpression: { cuit: { $type: 'string', $gt: '' } } });
ClientSchema.index({ name: 'text', tradeName: 'text' });
export const Client = mongoose.model('Client', ClientSchema);

const SupplierSchema = new mongoose.Schema({
    ...partyFields,
    category: { type: String, trim: true, default: '' },
}, { timestamps: true });
SupplierSchema.index({ cuit: 1 }, { unique: true, partialFilterExpression: { cuit: { $type: 'string', $gt: '' } } });
export const Supplier = mongoose.model('Supplier', SupplierSchema);
