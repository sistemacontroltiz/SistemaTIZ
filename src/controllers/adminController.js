// Usuarios, roles, configuración, catálogos simples y auditoría.
import * as users from '../services/userService.js';
import { crud } from '../services/crudService.js';
import { audit, listAudit } from '../services/auditService.js';
import { Sector, LaborRate, Settings, getSettings } from '../models/catalogs.js';
import { QualityTemplate } from '../models/operations.js';
import * as arcaConfig from '../integrations/arca/config.js';
import * as wsfe from '../integrations/arca/wsfe.js';

export const listUsers = async (req, res) => res.json(await users.listUsers());
export const listInstallers = async (req, res) => res.json(await users.listInstallers());
export async function createUser(req, res) {
    const u = await users.createUser(req.body);
    await audit(req, 'user.create', 'User', u._id, `${u.email} (${u.role.key})`);
    res.status(201).json(u);
}
export async function updateUser(req, res) {
    const u = await users.updateUser(req.params.id, req.body, req.user);
    await audit(req, 'user.update', 'User', u._id, `${u.email}${req.body.password ? ' + reseteo de contraseña' : ''}`);
    res.json(u);
}
export async function deactivateUser(req, res) {
    const u = await users.deleteUser(req.params.id, req.user);
    await audit(req, 'user.deactivate', 'User', u._id, u.email);
    res.json(u);
}

export const listRoles = async (req, res) => res.json({ roles: await users.listRoles(), permissions: users.permissionCatalog() });
export async function createRole(req, res) {
    const r = await users.createRole(req.body);
    await audit(req, 'role.create', 'Role', r._id, r.key);
    res.status(201).json(r);
}
export async function updateRole(req, res) {
    const r = await users.updateRole(req.params.id, req.body);
    await audit(req, 'role.update', 'Role', r._id, `${r.key}: ${r.permissions.length} permisos`);
    res.json(r);
}
export async function deleteRole(req, res) {
    await users.deleteRole(req.params.id);
    await audit(req, 'role.delete', 'Role', req.params.id);
    res.json({ ok: true });
}

export const getCompany = async (req, res) => res.json({ settings: await getSettings(), arca: arcaConfig.status() });
export async function updateCompany(req, res) {
    const s = await Settings.findByIdAndUpdate('company', req.body, { new: true, upsert: true, runValidators: true });
    await audit(req, 'settings.update', 'Settings', 'company', 'Datos de la empresa');
    res.json(s);
}
export async function arcaCheck(req, res) {
    res.json({ status: arcaConfig.status(), dummy: await wsfe.dummy() });
}

// Catálogos simples con el mismo patrón
function simple(Model, label, entity) {
    const svc = crud(Model, { label });
    return {
        list: async (req, res) => res.json(await svc.list(req.query)),
        create: async (req, res) => { const d = await svc.create(req.body); await audit(req, `${entity}.create`, entity, d._id, d.name); res.status(201).json(d); },
        update: async (req, res) => { const d = await svc.update(req.params.id, req.body); await audit(req, `${entity}.update`, entity, d._id, d.name); res.json(d); },
        remove: async (req, res) => { const d = await svc.deactivate(req.params.id); await audit(req, `${entity}.deactivate`, entity, d._id, d.name); res.json(d); },
    };
}
export const sectors = simple(Sector, 'Sector', 'Sector');
export const laborRates = simple(LaborRate, 'Mano de obra', 'LaborRate');
export const qualityTemplates = simple(QualityTemplate, 'Plantilla', 'QualityTemplate');

export const auditLog = async (req, res) => res.json(await listAudit(req.query));
