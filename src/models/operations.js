// Control de calidad y colocaciones.
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const QualityTemplateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true, default: '' },
    items: [{ type: String, trim: true, required: true }],
    active: { type: Boolean, default: true },
}, { timestamps: true });
export const QualityTemplate = mongoose.model('QualityTemplate', QualityTemplateSchema);

const QualityCheckSchema = new mongoose.Schema({
    workOrder: { type: ObjectId, ref: 'WorkOrder', required: true },
    workOrderNumber: String,
    template: { type: ObjectId, ref: 'QualityTemplate', default: null },
    templateName: String,
    results: [{ item: String, ok: Boolean, note: { type: String, default: '' } }],
    result: { type: String, enum: ['Aprobado', 'Rechazado'], required: true },
    observations: { type: String, default: '' },
    inspector: { type: ObjectId, ref: 'User' },
    inspectorName: String,
    // Solo aplica cuando el control es Rechazado: ¿el material se puede reutilizar?
    materialReusable: { type: String, enum: ['si', 'no', null], default: null },
    photos: [{
        file: String, originalName: String, mime: String, size: Number,
        uploadedBy: { type: ObjectId, ref: 'User' }, uploadedAt: { type: Date, default: Date.now },
    }],
    date: { type: Date, default: Date.now },
}, { timestamps: true });
QualityCheckSchema.index({ workOrder: 1, date: -1 });
export const QualityCheck = mongoose.model('QualityCheck', QualityCheckSchema);

export const INSTALLATION_STATUS = ['Programada', 'En proceso', 'Realizada', 'Reprogramada', 'Cancelada'];
const InstallationSchema = new mongoose.Schema({
    workOrder: { type: ObjectId, ref: 'WorkOrder', required: true },
    workOrderNumber: String,
    clientName: String,
    date: { type: Date, required: true },
    timeSlot: { type: String, default: '' },
    address: { type: String, required: true, trim: true },
    contactName: { type: String, default: '' },
    contactPhone: { type: String, default: '' },
    team: [{ type: ObjectId, ref: 'User' }],
    vehicle: { type: String, default: '' },
    instructions: { type: String, default: '' },
    status: { type: String, enum: INSTALLATION_STATUS, default: 'Programada' },
    result: { type: String, default: '' },
    startedAt: Date,   // cuando el colocador toma la tarea (solo si la OT ya está en Colocación)
    completedAt: Date,
    photos: [{
        file: String, originalName: String, mime: String, size: Number,
        uploadedBy: { type: ObjectId, ref: 'User' }, uploadedAt: { type: Date, default: Date.now },
    }],
    history: [{ action: String, userName: String, date: { type: Date, default: Date.now } }],
    createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
InstallationSchema.index({ date: 1, status: 1 });
InstallationSchema.index({ team: 1, date: 1 });
export const Installation = mongoose.model('Installation', InstallationSchema);
