// Modelos chicos de configuración: roles, sectores, mano de obra, categorías,
// contador de numeración y datos del emisor.
import mongoose from 'mongoose';
import { ALL_PERMISSIONS } from '../config/permissions.js';

const RoleSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-z0-9_-]{2,30}$/ },
    label: { type: String, required: true, trim: true },
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    system: { type: Boolean, default: false }, // el rol admin no se puede borrar
}, { timestamps: true });
export const Role = mongoose.model('Role', RoleSchema);

const SectorSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
}, { timestamps: true });
export const Sector = mongoose.model('Sector', SectorSchema);

// Mano de obra con costo por unidad (hora, m2, unidad...)
const LaborRateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    unit: { type: String, trim: true, default: 'hora' },
    cost: { type: Number, required: true, min: 0 },
    sector: { type: mongoose.Schema.Types.ObjectId, ref: 'Sector', default: null },
    active: { type: Boolean, default: true },
}, { timestamps: true });
export const LaborRate = mongoose.model('LaborRate', LaborRateSchema);

const CategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
}, { timestamps: true });
export const Category = mongoose.model('Category', CategorySchema);

const CounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', CounterSchema);

export async function nextNumber(key, prefix, pad = 6) {
    const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    return `${prefix}${String(c.seq).padStart(pad, '0')}`;
}

// Datos fiscales de la empresa (documento único)
const SettingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'company' },
    businessName: { type: String, default: '' },
    tradeName: { type: String, default: '' },
    cuit: { type: String, default: '' },
    ivaCondition: { type: String, enum: ['RI', 'MT', 'EX'], default: 'RI' },
    address: { type: String, default: '' },
    iibb: { type: String, default: '' },
    activityStart: { type: Date, default: null },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    pointOfSale: { type: Number, default: 1, min: 1, max: 99998 },
    quoteValidityDays: { type: Number, default: 15, min: 1 },
    defaultPaymentTermDays: { type: Number, default: 30, min: 0 },
    quoteTerms: { type: String, default: 'Precios sin IVA salvo indicación. Validez según fecha indicada.' },
}, { timestamps: true });
export const Settings = mongoose.model('Settings', SettingsSchema);

export async function getSettings() {
    return (await Settings.findById('company')) || Settings.create({ _id: 'company' });
}
