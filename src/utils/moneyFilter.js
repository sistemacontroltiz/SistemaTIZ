// Filtra importes de las respuestas según los permisos del usuario.
// - Venta (totales, facturación, cobranzas): dueños / comercial / cobranzas.
// - Costo (costo de insumos, costos de la OT): además compras/depósito y quien edita el catálogo.
// Un perfil operativo (Producción / Diseño) no recibe ningún importe, ni aunque consulte la API directo.
import { can } from '../middleware/auth.js';

const WO_MONEY_KEYS = new Set([
    'total', 'net', 'vat', 'subtotal', 'unitPrice', 'unitCost', 'plannedCost', 'totalCost',
    'costMaterials', 'costLabor', 'collected', 'advances', 'invoiced', 'marginPct',
    'billing', 'costs', 'invoices', 'payments', 'amount', 'totalApplied', 'balance', 'paid',
    'workOrderAmounts', 'withholdings',
]);
const PRODUCT_COST_KEYS = new Set(['cost', 'costUpdatedAt', 'unitCost']);

// Elimina recursivamente las claves indicadas. Respeta Date, ObjectId y demás (solo entra a objetos planos).
function deepStripKeys(v, keys) {
    if (Array.isArray(v)) return v.map(x => deepStripKeys(x, keys));
    if (v && typeof v === 'object' && v.constructor === Object) {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            if (keys.has(k)) continue;
            out[k] = deepStripKeys(val, keys);
        }
        return out;
    }
    return v;
}

export const canSeeMoney = (req) => can(req, 'quotes:read') || can(req, 'invoices:read') || can(req, 'payments:read');
export const canSeeCost = (req) => canSeeMoney(req) || can(req, 'purchases:read') || can(req, 'catalog:write');

const toPlain = (data) => (data && typeof data.toObject === 'function' ? data.toObject() : data);

export const woMoney = (req, data) => (canSeeMoney(req) ? data : deepStripKeys(toPlain(data), WO_MONEY_KEYS));
export const productCost = (req, data) => (canSeeCost(req) ? data : deepStripKeys(toPlain(data), PRODUCT_COST_KEYS));
