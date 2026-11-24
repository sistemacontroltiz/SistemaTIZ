// Compras, calidad y colocaciones.
import * as purchases from '../services/purchaseService.js';
import * as ops from '../services/operationsService.js';
import { audit } from '../services/auditService.js';

export const listPurchases = async (req, res) => res.json(await purchases.listPurchases(req.query));
export const getPurchase = async (req, res) => res.json(await purchases.getPurchase(req.params.id));
export async function createPurchase(req, res) {
    const p = await purchases.createPurchase(req.body, req);
    await audit(req, 'purchase.create', 'Purchase', p._id, `${p.number} ${p.supplierName} ${p.total}`);
    res.status(201).json(p);
}
export async function cancelPurchase(req, res) {
    const p = await purchases.cancelPurchase(req.params.id, req.body, req);
    await audit(req, 'purchase.cancel', 'Purchase', p._id, `${p.number}: ${req.body.reason}`);
    res.json(p);
}
export async function aiExtract(req, res) {
    if (!req.file) return res.status(400).json({ message: 'Adjuntá la factura (PDF o foto).' });
    res.json(await purchases.extractInvoiceWithAI(req.file));
}

export const listQuality = async (req, res) => res.json(await ops.listQualityChecks(req.query));
export const pendingQuality = async (req, res) => res.json(await ops.pendingQuality());
export const qualityStats = async (req, res) => res.json(await ops.qualityStats(req.query));
export async function uploadQualityPhotos(req, res) {
    if (!req.files?.length) return res.status(400).json({ message: 'Elegí al menos una foto.' });
    res.status(201).json(await ops.addQualityPhotos(req.params.id, req.files, req));
}
export async function getQualityPhoto(req, res) {
    const p = await ops.getQualityPhoto(req.params.id, req.params.photoId);
    res.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(p.path, { dotfiles: 'allow' });
}
export async function deleteQualityPhoto(req, res) {
    await ops.deleteQualityPhoto(req.params.id, req.params.photoId, req);
    res.json({ ok: true });
}
export async function createQuality(req, res) {
    const c = await ops.createQualityCheck(req.body, req);
    await audit(req, 'quality.check', 'WorkOrder', c.workOrder, `${c.workOrderNumber}: ${c.result}`);
    res.status(201).json(c);
}

export const listInstallations = async (req, res) => res.json(await ops.listInstallations(req.query, req));
export const getInstallation = async (req, res) => res.json(await ops.getInstallation(req.params.id, req));
export async function createInstallation(req, res) {
    const i = await ops.createInstallation(req.body, req);
    await audit(req, 'installation.create', 'Installation', i._id, `${i.workOrderNumber} ${i.address}`);
    res.status(201).json(i);
}
export const updateInstallation = async (req, res) => res.json(await ops.updateInstallation(req.params.id, req.body, req));
export async function startInstallation(req, res) {
    res.json(await ops.startInstallation(req.params.id, req));
}
export async function closeInstallation(req, res) {
    const i = await ops.closeInstallation(req.params.id, req.body, req);
    await audit(req, 'installation.close', 'Installation', req.params.id, req.body.status);
    res.json(i);
}
export async function uploadPhotos(req, res) {
    if (!req.files?.length) return res.status(400).json({ message: 'Elegí al menos una foto.' });
    res.status(201).json(await ops.addPhotos(req.params.id, req.files, req));
}
export async function getPhoto(req, res) {
    const p = await ops.getPhoto(req.params.id, req.params.photoId, req);
    res.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(p.path, { dotfiles: 'allow' });
}
export async function deletePhoto(req, res) {
    await ops.deletePhoto(req.params.id, req.params.photoId, req);
    res.json({ ok: true });
}
