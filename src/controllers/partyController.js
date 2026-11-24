// Clientes, proveedores y catálogo de insumos.
import { crud } from '../services/crudService.js';
import { audit } from '../services/auditService.js';
import { Client, Supplier } from '../models/parties.js';
import { Product } from '../models/inventory.js';
import { lookupCuit } from '../integrations/arca/padron.js';
import * as purchases from '../services/purchaseService.js';
import { productCost } from '../utils/moneyFilter.js';

function partyHandlers(Model, label, entity, searchFields, { costFilter = false } = {}) {
    const svc = crud(Model, { label, searchFields });
    const money = (req, d) => (costFilter ? productCost(req, d) : d);
    return {
        list: async (req, res) => res.json(money(req, await svc.list(req.query))),
        get: async (req, res) => res.json(money(req, await svc.get(req.params.id))),
        create: async (req, res) => { const d = await svc.create(req.body); await audit(req, `${entity}.create`, entity, d._id, d.name); res.status(201).json(d); },
        update: async (req, res) => { const d = await svc.update(req.params.id, req.body); await audit(req, `${entity}.update`, entity, d._id, d.name); res.json(d); },
        remove: async (req, res) => { const d = await svc.deactivate(req.params.id); await audit(req, `${entity}.deactivate`, entity, d._id, d.name); res.json(d); },
    };
}

export const clients = partyHandlers(Client, 'Cliente', 'Client', ['name', 'tradeName', 'cuit', 'email']);
export const suppliers = partyHandlers(Supplier, 'Proveedor', 'Supplier', ['name', 'tradeName', 'cuit', 'category']);
export const products = partyHandlers(Product, 'Insumo', 'Product', ['name', 'sku', 'category'], { costFilter: true });

export const padron = async (req, res) => res.json(await lookupCuit(req.params.cuit));

export const productMovements = async (req, res) => res.json(productCost(req, await purchases.stockMovements(req.params.id)));
export async function adjustStock(req, res) {
    const p = await purchases.adjustStock(req.params.id, req.body, req);
    await audit(req, 'stock.adjust', 'Product', p._id, `${req.body.quantity} ${p.unit}: ${req.body.note}`);
    res.json(p);
}
