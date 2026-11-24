// Facturación, cobranzas y estadísticas.
import * as invoices from '../services/invoiceService.js';
import * as payments from '../services/paymentService.js';
import { summary } from '../services/statsService.js';
import { audit } from '../services/auditService.js';
import { getSettings } from '../models/catalogs.js';
import { invoicePdf, reciboPdf } from '../pdf/documents.js';

export const listInvoices = async (req, res) => res.json(await invoices.listInvoices(req.query));
export const getInvoice = async (req, res) => res.json(await invoices.getInvoice(req.params.id));

// Crea el borrador y pide el CAE en el mismo paso.
export async function issueInvoice(req, res) {
    const draft = await invoices.draftInvoice(req.body, req);
    await audit(req, 'invoice.draft', 'Invoice', draft._id, `${draft.kind} ${draft.clientSnapshot.name} ${draft.total}`);
    try {
        res.status(201).json(await invoices.authorize(draft._id, req));
    } catch (e) {
        e.details = { ...(e.details || {}), invoiceId: draft._id };
        throw e;
    }
}
export const retryInvoice = async (req, res) => res.json(await invoices.authorize(req.params.id, req));
export async function creditNote(req, res) {
    const nc = await invoices.createCreditNote(req.params.id, req.body, req);
    await audit(req, 'invoice.creditnote', 'Invoice', req.params.id, `${nc.kind} ${nc.total}: ${req.body.reason}`);
    try {
        res.status(201).json(await invoices.authorize(nc._id, req));
    } catch (e) {
        e.details = { ...(e.details || {}), invoiceId: nc._id };
        throw e;
    }
}
export async function discardInvoice(req, res) {
    await invoices.discardDraft(req.params.id, req);
    res.json({ ok: true });
}
export async function invoicePdfHandler(req, res) {
    const inv = await invoices.getInvoice(req.params.id);
    const pdf = await invoicePdf(inv, await getSettings());
    const name = inv.number ? `${inv.kind}-${String(inv.pointOfSale).padStart(5, '0')}-${String(inv.number).padStart(8, '0')}` : `borrador-${inv._id}`;
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}.pdf"` }).send(pdf);
}

export async function paymentPdfHandler(req, res) {
    const p = await payments.getPayment(req.params.id);
    const pdf = await reciboPdf(p, await getSettings());
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="recibo-${p.number}.pdf"` }).send(pdf);
}
export const listPayments = async (req, res) => res.json(await payments.listPayments(req.query));
export async function createPayment(req, res) {
    const p = await payments.createPayment(req.body, req);
    await audit(req, 'payment.create', 'Payment', p._id, `${p.number} ${p.kind} ${p.clientName} ${p.totalApplied}`);
    res.status(201).json(p);
}
export async function applyAdvance(req, res) {
    const p = await payments.applyAdvance(req.params.id, req.body, req);
    await audit(req, 'payment.apply', 'Payment', p._id, `${p.number} aplicado`);
    res.json(p);
}
export async function cancelPayment(req, res) {
    const p = await payments.cancelPayment(req.params.id, req.body, req);
    await audit(req, 'payment.cancel', 'Payment', p._id, `${p.number}: ${req.body.reason}`);
    res.json(p);
}
export const receivables = async (req, res) => res.json(await payments.receivables());
export const collectionsBoard = async (req, res) => res.json(await payments.collectionsBoard());
export const statement = async (req, res) => res.json(await payments.accountStatement(req.params.id));
export const weekly = async (req, res) => res.json(await payments.weekly(req.query));

export const stats = async (req, res) => res.json(await summary(req.query));
