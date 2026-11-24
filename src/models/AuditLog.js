// Bitácora de acciones sensibles: quién, qué, cuándo y desde dónde.
import mongoose from 'mongoose';

const AuditLogSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: String,
    action: { type: String, required: true },   // ej: 'quote.approve'
    entity: { type: String, required: true },   // ej: 'Quote'
    entityId: { type: String, default: '' },
    summary: { type: String, default: '' },
    ip: String,
    date: { type: Date, default: Date.now },
});
AuditLogSchema.index({ date: -1 });
AuditLogSchema.index({ entity: 1, entityId: 1 });

export default mongoose.model('AuditLog', AuditLogSchema);
