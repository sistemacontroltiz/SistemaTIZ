// Presupuestos, OT y producción.
import * as quotes from '../services/quoteService.js';
import * as wos from '../services/workOrderService.js';
import * as production from '../services/productionService.js';
import { audit } from '../services/auditService.js';
import { getSettings } from '../models/catalogs.js';
import { quotePdf } from '../pdf/documents.js';
import { woMoney } from '../utils/moneyFilter.js';

// ---- Presupuestos ----
export const listQuotes = async (req, res) => res.json(await quotes.listQuotes(req.query));
export const getQuote = async (req, res) => res.json(await quotes.getQuote(req.params.id));
export async function createOpportunity(req, res) {
    const q = await quotes.createOpportunity(req.body, req);
    res.status(201).json(q);
}
export async function updateOpportunity(req, res) {
    res.json(await quotes.updateOpportunity(req.params.id, req.body, req));
}
export async function takeOpportunity(req, res) {
    res.json(await quotes.takeOpportunity(req.params.id, req));
}
export async function createQuote(req, res) {
    const q = await quotes.createQuote(req.body, req);
    await audit(req, 'quote.create', 'Quote', q._id, `${q.number} ${q.clientName} ${q.total}`);
    res.status(201).json(q);
}
export async function updateQuote(req, res) {
    const q = await quotes.updateQuote(req.params.id, req.body, req);
    await audit(req, 'quote.update', 'Quote', q._id, `${q.number} total ${q.total}`);
    res.json(q);
}
export async function quoteStatus(req, res) {
    const q = await quotes.changeQuoteStatus(req.params.id, req.body, req);
    await audit(req, 'quote.status', 'Quote', q._id, `${q.number} → ${q.status}`);
    res.json(q);
}
export async function extendQuote(req, res) {
    const q = await quotes.extendValidity(req.params.id, req.body, req);
    await audit(req, 'quote.extend', 'Quote', q._id, `${q.number} vigencia`);
    res.json(q);
}
export async function reviewQuote(req, res) {
    const q = await quotes.getQuote(req.params.id);
    res.json(await quotes.reviewForApproval(q));
}
export async function approveQuote(req, res) {
    const r = await quotes.approveQuote(req.params.id, req.body, req);
    await audit(req, 'quote.approve', 'Quote', r.quote._id, `${r.quote.number} → ${r.workOrder.number}`);
    res.json(r);
}
export async function duplicateQuote(req, res) {
    const q = await quotes.duplicateQuote(req.params.id, req);
    res.status(201).json(q);
}
export async function quotePdfHandler(req, res) {
    const q = await quotes.getQuote(req.params.id);
    const pdf = await quotePdf(q, await getSettings());
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${q.number}.pdf"` }).send(pdf);
}

// ---- OT ----
export const listWorkOrders = async (req, res) => res.json(woMoney(req, await wos.listWorkOrders(req.query)));
export const getWorkOrder = async (req, res) => res.json(woMoney(req, await wos.getWorkOrder(req.params.id)));
export async function woStatus(req, res) {
    const w = await wos.changeStatus(req.params.id, req.body, req);
    await audit(req, 'workorder.status', 'WorkOrder', w._id, `${w.number} → ${w.status}`);
    res.json(woMoney(req, w));
}
export async function woReschedule(req, res) {
    const w = await wos.reschedule(req.params.id, req.body, req);
    await audit(req, 'workorder.reschedule', 'WorkOrder', w._id, `${w.number}: ${req.body.reason}`);
    res.json(woMoney(req, w));
}
export async function woUpdate(req, res) {
    res.json(woMoney(req, await wos.updateWorkOrder(req.params.id, req.body, req)));
}
export async function woCancel(req, res) {
    const w = await wos.cancelWorkOrder(req.params.id, req.body, req);
    await audit(req, 'workorder.cancel', 'WorkOrder', w._id, `${w.number}: ${req.body.reason}`);
    res.json(woMoney(req, w));
}
export async function woConsume(req, res) {
    const r = await wos.consumeMaterials(req.params.id, req.body, req);
    await audit(req, 'workorder.consume', 'WorkOrder', req.params.id, `${req.body.lines.length} línea(s)`);
    res.json(woMoney(req, r));
}

// ---- Producción ----
export const listTasks = async (req, res) => res.json(await production.listTasks(req.query, req));
export const takeTask = async (req, res) => res.json(await production.takeTask(req.params.id, req));
export const finishTask = async (req, res) => res.json(await production.finishTask(req.params.id, req.body, req));
export async function revertTask(req, res) {
    const t = await production.revertTask(req.params.id, req);
    await audit(req, 'task.revert', 'Task', t._id, t.description);
    res.json(t);
}
export const assignTask = async (req, res) => res.json(await production.assignTask(req.params.id, req.body, req));
