// Catálogo de insumos/productos, movimientos de stock y compras.
import mongoose from 'mongoose';
const { ObjectId } = mongoose.Schema.Types;

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true, maxlength: 200 },
    sku: { type: String, trim: true, default: undefined },
    category: { type: String, trim: true, default: 'General' },
    unit: { type: String, required: true, trim: true, default: 'unidad' }, // unidad de stock
    // Equivalencias: 1 "placa" = 2.97 m2, 1 "rollo" = 50 m, etc.
    equivalences: [{ unit: { type: String, trim: true }, factor: { type: Number, min: 0 } }],
    cost: { type: Number, min: 0, default: 0 }, // último costo por unidad de stock
    costUpdatedAt: { type: Date, default: null },
    costHistory: [{ cost: Number, date: Date, source: String, ref: ObjectId }],
    stock: { type: Number, default: 0 },
    minStock: { type: Number, min: 0, default: 0 },
    isService: { type: Boolean, default: false }, // tercerizados: no lleva stock
    suppliers: [{ type: ObjectId, ref: 'Supplier' }],
    active: { type: Boolean, default: true },
}, { timestamps: true });
ProductSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string', $gt: '' } } });
export const Product = mongoose.model('Product', ProductSchema);

const StockMovementSchema = new mongoose.Schema({
    product: { type: ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: ['ingreso', 'consumo', 'ajuste', 'devolucion'], required: true },
    quantity: { type: Number, required: true }, // positivo entra, negativo sale
    unitCost: { type: Number, min: 0, default: 0 },
    workOrder: { type: ObjectId, ref: 'WorkOrder', default: null },
    purchase: { type: ObjectId, ref: 'Purchase', default: null },
    note: { type: String, trim: true, default: '' },
    user: { type: ObjectId, ref: 'User' },
    date: { type: Date, default: Date.now },
}, { timestamps: true });
StockMovementSchema.index({ product: 1, date: -1 });
StockMovementSchema.index({ workOrder: 1 });
export const StockMovement = mongoose.model('StockMovement', StockMovementSchema);

const PurchaseItemSchema = new mongoose.Schema({
    product: { type: ObjectId, ref: 'Product', default: null },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0.0001 },
    unit: { type: String, trim: true, default: '' }, // unidad de compra
    factor: { type: Number, min: 0.0001, default: 1 }, // conversión a unidad de stock
    unitCost: { type: Number, required: true, min: 0 }, // por unidad de compra, sin IVA
    total: { type: Number, required: true, min: 0 },
    // Distribución del costo a OTs (tercerizados, materiales específicos)
    allocations: [{ workOrder: { type: ObjectId, ref: 'WorkOrder' }, amount: { type: Number, min: 0 } }],
}, { _id: true });

const PurchaseSchema = new mongoose.Schema({
    number: { type: String, unique: true, required: true },
    supplier: { type: ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, trim: true },
    date: { type: Date, required: true },
    invoiceType: { type: String, trim: true, default: '' },
    invoiceNumber: { type: String, trim: true, default: '' },
    items: { type: [PurchaseItemSchema], validate: [(v) => v.length > 0, 'La compra necesita al menos un ítem.'] },
    net: { type: Number, min: 0, required: true },
    vat: { type: Number, min: 0, default: 0 },
    otherTaxes: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, required: true },
    status: { type: String, enum: ['Registrada', 'Anulada'], default: 'Registrada' },
    notes: { type: String, trim: true, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
PurchaseSchema.index({ supplier: 1, invoiceType: 1, invoiceNumber: 1 }, {
    unique: true, partialFilterExpression: { invoiceNumber: { $type: 'string', $gt: '' }, status: 'Registrada' },
});
export const Purchase = mongoose.model('Purchase', PurchaseSchema);
