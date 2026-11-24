import AuditLog from '../models/AuditLog.js';

// Registra una acción. Nunca debe frenar la operación principal si falla.
export async function audit(req, action, entity, entityId = '', summary = '') {
    try {
        await AuditLog.create({
            user: req?.user?._id ?? null,
            userName: req?.user?.name ?? 'sistema',
            action, entity, entityId: String(entityId), summary: String(summary).slice(0, 500),
            ip: req?.ip,
        });
    } catch (e) {
        console.error('[audit] no se pudo registrar', action, e.message);
    }
}

export async function listAudit({ entity, entityId, limit = 200 }) {
    const filter = {};
    if (entity) filter.entity = entity;
    if (entityId) filter.entityId = entityId;
    return AuditLog.find(filter).sort({ date: -1 }).limit(Math.min(limit, 1000)).lean();
}

export const historyEntry = (req, action) => ({ action, user: req.user?._id, userName: req.user?.name, date: new Date() });
