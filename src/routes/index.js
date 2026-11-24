// Todas las rutas de la API. Cada una declara: permiso requerido + validación.
// Ninguna ruta de datos es pública: solo /auth/login.
import { Router } from 'express';
import { requireAuth, permit } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { photoUpload, documentUpload, verifyFileSignatures } from '../middleware/upload.js';
import * as S from '../validators/schemas.js';
import * as auth from '../controllers/authController.js';
import * as admin from '../controllers/adminController.js';
import * as party from '../controllers/partyController.js';
import * as sales from '../controllers/salesController.js';
import * as ops from '../controllers/operationsController.js';
import * as bill from '../controllers/billingController.js';

const r = Router();
const id = validate({ params: S.idParam });
const q = validate({ query: S.pagination });
const body = (schema) => validate({ body: schema });
const idBody = (schema) => validate({ params: S.idParam, body: schema });

// ---------- Autenticación ----------
r.post('/auth/login', loginLimiter, body(S.login), auth.login);
r.post('/auth/logout', auth.logout);
r.use(requireAuth); // todo lo que sigue exige sesión
r.get('/auth/me', auth.me);
r.post('/auth/change-password', body(S.changePassword), auth.changePassword);

// ---------- Administración ----------
const usersAdmin = permit('users:admin');
r.get('/users', usersAdmin, admin.listUsers);
r.get('/users/installers', permit('installations:write', 'users:admin'), admin.listInstallers);
r.post('/users', usersAdmin, body(S.userCreate), admin.createUser);
r.put('/users/:id', usersAdmin, idBody(S.userUpdate), admin.updateUser);
r.delete('/users/:id', usersAdmin, id, admin.deactivateUser);
r.get('/roles', usersAdmin, admin.listRoles);
r.post('/roles', usersAdmin, body(S.roleSchema), admin.createRole);
r.put('/roles/:id', usersAdmin, idBody(S.roleSchema), admin.updateRole);
r.delete('/roles/:id', usersAdmin, id, admin.deleteRole);
r.get('/audit', permit('audit:read'), admin.auditLog);

const settings = permit('settings:admin');
r.get('/settings/company', permit('settings:admin', 'invoices:read', 'quotes:read'), admin.getCompany);
r.put('/settings/company', settings, body(S.settingsSchema), admin.updateCompany);
r.get('/settings/arca-check', settings, admin.arcaCheck);

// Catálogos simples: lectura para quien trabaja con ellos, escritura solo configuración
const catalogRead = permit('settings:admin', 'quotes:read', 'production:read', 'users:admin', 'quality:read', 'catalog:read');
for (const [path, handlers, schema, readPerm] of [
    ['sectors', admin.sectors, S.sectorSchema, catalogRead],
    ['labor-rates', admin.laborRates, S.laborRateSchema, catalogRead],
    ['quality-templates', admin.qualityTemplates, S.qualityTemplateSchema, permit('quality:read', 'settings:admin')],
]) {
    const writePerm = path === 'quality-templates' ? permit('settings:admin', 'quality:write') : settings;
    r.get(`/${path}`, readPerm, handlers.list);
    r.post(`/${path}`, writePerm, body(schema), handlers.create);
    r.put(`/${path}/:id`, writePerm, idBody(schema), handlers.update);
    r.delete(`/${path}/:id`, writePerm, id, handlers.remove);
}

// ---------- Clientes / proveedores / catálogo ----------
r.get('/clients', permit('clients:read', 'quotes:read', 'invoices:read', 'payments:read'), q, party.clients.list);
r.get('/clients/:id', permit('clients:read'), id, party.clients.get);
r.post('/clients', permit('clients:write'), body(S.clientSchema), party.clients.create);
r.put('/clients/:id', permit('clients:write'), idBody(S.clientSchema), party.clients.update);
r.delete('/clients/:id', permit('clients:write'), id, party.clients.remove);
r.get('/clients/:id/statement', permit('payments:read'), id, bill.statement);
r.get('/padron/:cuit', permit('clients:write', 'suppliers:write'), validate({ params: S.cuitParam }), party.padron);

r.get('/suppliers', permit('suppliers:read', 'purchases:read'), q, party.suppliers.list);
r.get('/suppliers/:id', permit('suppliers:read'), id, party.suppliers.get);
r.post('/suppliers', permit('suppliers:write'), body(S.supplierSchema), party.suppliers.create);
r.put('/suppliers/:id', permit('suppliers:write'), idBody(S.supplierSchema), party.suppliers.update);
r.delete('/suppliers/:id', permit('suppliers:write'), id, party.suppliers.remove);

r.get('/products', permit('catalog:read', 'quotes:write', 'purchases:write', 'materials:consume'), q, party.products.list);
r.get('/products/:id', permit('catalog:read'), id, party.products.get);
r.post('/products', permit('catalog:write'), body(S.productSchema), party.products.create);
r.put('/products/:id', permit('catalog:write'), idBody(S.productSchema), party.products.update);
r.delete('/products/:id', permit('catalog:write'), id, party.products.remove);
r.get('/products/:id/movements', permit('catalog:read'), id, party.productMovements);
r.post('/products/:id/adjust', permit('stock:adjust'), idBody(S.stockAdjust), party.adjustStock);

// ---------- Presupuestos ----------
r.get('/quotes', permit('quotes:read'), q, sales.listQuotes);
r.get('/quotes/:id', permit('quotes:read'), id, sales.getQuote);
r.get('/quotes/:id/pdf', permit('quotes:read'), id, sales.quotePdfHandler);
r.get('/quotes/:id/review', permit('quotes:approve'), id, sales.reviewQuote);
r.post('/quotes/opportunity', permit('opportunities:create', 'quotes:write'), body(S.opportunitySchema), sales.createOpportunity);
r.put('/quotes/:id/opportunity', permit('opportunities:create', 'quotes:write'), idBody(S.opportunitySchema), sales.updateOpportunity);
r.post('/quotes/:id/take', permit('quotes:write'), id, sales.takeOpportunity);
r.post('/quotes', permit('quotes:write'), body(S.quoteSchema), sales.createQuote);
r.put('/quotes/:id', permit('quotes:write'), idBody(S.quoteSchema), sales.updateQuote);
r.post('/quotes/:id/status', permit('quotes:write'), idBody(S.quoteStatus), sales.quoteStatus);
r.post('/quotes/:id/extend', permit('quotes:write'), idBody(S.quoteExtend), sales.extendQuote);
r.post('/quotes/:id/approve', permit('quotes:approve'), idBody(S.quoteApprove), sales.approveQuote);
r.post('/quotes/:id/duplicate', permit('quotes:write'), id, sales.duplicateQuote);

// ---------- Órdenes de trabajo ----------
r.get('/workorders', permit('workorders:read', 'invoices:issue', 'payments:write', 'installations:write', 'purchases:write'), q, sales.listWorkOrders);
r.get('/workorders/:id', permit('workorders:read'), id, sales.getWorkOrder);
r.put('/workorders/:id', permit('workorders:write'), idBody(S.woUpdate), sales.woUpdate);
r.post('/workorders/:id/status', permit('workorders:write'), idBody(S.woStatus), sales.woStatus);
r.post('/workorders/:id/reschedule', permit('workorders:write'), idBody(S.woReschedule), sales.woReschedule);
r.post('/workorders/:id/cancel', permit('workorders:baja'), idBody(S.woCancel), sales.woCancel);
r.post('/workorders/:id/consume', permit('materials:consume'), idBody(S.consumeSchema), sales.woConsume);

// ---------- Producción ----------
r.get('/tasks', permit('production:read'), sales.listTasks);
r.post('/tasks/:id/take', permit('production:work'), id, sales.takeTask);
r.post('/tasks/:id/finish', permit('production:work'), idBody(S.taskNote), sales.finishTask);
r.post('/tasks/:id/revert', permit('production:assign'), id, sales.revertTask);
r.put('/tasks/:id/assign', permit('production:assign'), idBody(S.taskAssign), sales.assignTask);

// ---------- Compras ----------
r.get('/purchases', permit('purchases:read'), q, ops.listPurchases);
r.get('/purchases/:id', permit('purchases:read'), id, ops.getPurchase);
r.post('/purchases', permit('purchases:write'), body(S.purchaseSchema), ops.createPurchase);
r.post('/purchases/:id/cancel', permit('purchases:write'), idBody(S.paymentCancel), ops.cancelPurchase);
r.post('/purchases/ai-extract', permit('purchases:write'), documentUpload.single('file'), verifyFileSignatures, ops.aiExtract);

// ---------- Calidad ----------
r.get('/quality', permit('quality:read'), ops.listQuality);
r.get('/quality/pending', permit('quality:read'), ops.pendingQuality);
r.get('/quality/stats', permit('quality:read'), ops.qualityStats);
r.post('/quality', permit('quality:write'), body(S.qualityCheckSchema), ops.createQuality);
r.post('/quality/:id/photos', permit('quality:write'), id, photoUpload.array('photos', 10), verifyFileSignatures, ops.uploadQualityPhotos);
r.get('/quality/:id/photos/:photoId', permit('quality:read'), validate({ params: S.idParam.extend({ photoId: S.objectId }) }), ops.getQualityPhoto);
r.delete('/quality/:id/photos/:photoId', permit('quality:write'), validate({ params: S.idParam.extend({ photoId: S.objectId }) }), ops.deleteQualityPhoto);

// ---------- Colocaciones ----------
const instRead = permit('installations:read', 'installations:own');
r.get('/installations', instRead, ops.listInstallations);
r.get('/installations/:id', instRead, id, ops.getInstallation);
r.post('/installations', permit('installations:write'), body(S.installationSchema), ops.createInstallation);
r.put('/installations/:id', permit('installations:write'), idBody(S.installationUpdate), ops.updateInstallation);
r.post('/installations/:id/start', permit('installations:write'), id, ops.startInstallation);
r.post('/installations/:id/close', permit('installations:write'), idBody(S.installationClose), ops.closeInstallation);
r.post('/installations/:id/photos', permit('installations:write'), id, photoUpload.array('photos', 10), verifyFileSignatures, ops.uploadPhotos);
r.get('/installations/:id/photos/:photoId', instRead, validate({ params: S.idParam.extend({ photoId: S.objectId }) }), ops.getPhoto);
r.delete('/installations/:id/photos/:photoId', permit('installations:write'), validate({ params: S.idParam.extend({ photoId: S.objectId }) }), ops.deletePhoto);

// ---------- Facturación ----------
r.get('/invoices', permit('invoices:read'), q, bill.listInvoices);
r.get('/invoices/:id', permit('invoices:read', 'payments:read'), id, bill.getInvoice);
r.get('/invoices/:id/pdf', permit('invoices:read', 'payments:read'), id, bill.invoicePdfHandler);
r.post('/invoices', permit('invoices:issue'), body(S.invoiceSchema), bill.issueInvoice);
r.post('/invoices/:id/retry', permit('invoices:issue'), id, bill.retryInvoice);
r.post('/invoices/:id/credit-note', permit('invoices:issue'), idBody(S.creditNoteSchema), bill.creditNote);
r.delete('/invoices/:id', permit('invoices:issue'), id, bill.discardInvoice);

// ---------- Cobranzas ----------
r.get('/payments', permit('payments:read'), q, bill.listPayments);
r.get('/payments/:id/pdf', permit('payments:read'), id, bill.paymentPdfHandler);
r.get('/payments/receivables', permit('payments:read'), bill.receivables);
r.get('/payments/board', permit('payments:read'), bill.collectionsBoard);
r.get('/payments/weekly', permit('payments:read'), q, bill.weekly);
r.post('/payments', permit('payments:write'), body(S.paymentSchema), bill.createPayment);
r.post('/payments/:id/apply', permit('payments:write'), idBody(S.paymentApply), bill.applyAdvance);
r.post('/payments/:id/cancel', permit('payments:write'), idBody(S.paymentCancel), bill.cancelPayment);

// ---------- Estadísticas ----------
r.get('/stats/summary', permit('stats:read'), q, bill.stats);

export default r;
