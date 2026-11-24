// Operaciones genéricas para entidades simples (clientes, proveedores, productos,
// sectores, mano de obra, plantillas de calidad).
import AppError from '../utils/AppError.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function crud(Model, { label, searchFields = ['name'], defaultSort = { name: 1 }, populate } = {}) {
    return {
        async list({ q, active, limit = 500 } = {}) {
            const filter = {};
            if (q) {
                const rx = new RegExp(escapeRegex(q), 'i');
                filter.$or = searchFields.map(f => ({ [f]: rx }));
            }
            if (active === 'true') filter.active = true;
            let query = Model.find(filter).sort(defaultSort).limit(Math.min(limit, 2000));
            if (populate) query = query.populate(populate);
            return query.lean();
        },
        async get(id) {
            let query = Model.findById(id);
            if (populate) query = query.populate(populate);
            const doc = await query;
            if (!doc) throw AppError.notFound(label);
            return doc;
        },
        async create(data) {
            return Model.create(data);
        },
        async update(id, data) {
            const doc = await Model.findById(id);
            if (!doc) throw AppError.notFound(label);
            doc.set(data);
            await doc.save();
            return doc;
        },
        // Baja lógica: la historia sigue apuntando al registro.
        async deactivate(id) {
            const doc = await Model.findById(id);
            if (!doc) throw AppError.notFound(label);
            if ('active' in doc) { doc.active = false; await doc.save(); return doc; }
            await doc.deleteOne();
            return doc;
        },
    };
}
