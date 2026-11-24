import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { Role } from '../models/catalogs.js';
import AppError from '../utils/AppError.js';
import { ALL_PERMISSIONS, PERMISSIONS } from '../config/permissions.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

// Login con bloqueo por intentos fallidos y mensaje genérico
// (no revela si el email existe).
export async function authenticate(email, password) {
    const user = await User.findOne({ email: email.toLowerCase() })
        .select('+password +failedLogins +lockUntil +tokenVersion').populate('role');
    if (!user) {
        await bcrypt.compare(password, DUMMY_HASH); // mismo tiempo de respuesta
        throw AppError.unauthorized('Email o contraseña incorrectos.');
    }
    if (user.lockUntil && user.lockUntil > new Date()) {
        const min = Math.ceil((user.lockUntil - Date.now()) / 60000);
        throw new AppError(`Usuario bloqueado por intentos fallidos. Probá en ${min} minuto(s).`, 423);
    }
    const ok = await user.matchPassword(password);
    if (!ok) {
        user.failedLogins += 1;
        if (user.failedLogins >= MAX_FAILED) {
            user.failedLogins = 0;
            user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
        }
        await user.save({ validateModifiedOnly: true });
        throw AppError.unauthorized('Email o contraseña incorrectos.');
    }
    if (!user.active) throw AppError.forbidden('Usuario desactivado. Hablá con un administrador.');
    user.failedLogins = 0; user.lockUntil = null; user.lastLoginAt = new Date();
    await user.save({ validateModifiedOnly: true });
    return user;
}

export function sessionPayload(user) {
    return {
        id: user._id, name: user.name, email: user.email,
        role: { key: user.role.key, label: user.role.label },
        sector: user.sector ? { id: user.sector._id ?? user.sector, name: user.sector.name } : null,
        permissions: user.role.permissions,
        mustChangePassword: user.mustChangePassword,
    };
}

export async function changeOwnPassword(userId, current, next) {
    const user = await User.findById(userId).select('+password +tokenVersion');
    if (!(await user.matchPassword(current))) throw AppError.badRequest('La contraseña actual no es correcta.');
    if (current === next) throw AppError.badRequest('La nueva contraseña debe ser distinta a la actual.');
    user.password = next;
    user.mustChangePassword = false;
    await user.save();
    return user;
}

// Personas que pueden integrar un equipo de colocación (sin datos sensibles).
export async function listInstallers() {
    const roles = await Role.find({ permissions: { $in: ['installations:own', 'installations:write'] } }).select('_id');
    return User.find({ active: true, role: { $in: roles.map(r => r._id) } }).select('name role').populate('role', 'label').sort({ name: 1 }).lean();
}

export const listUsers = () => User.find().populate('role', 'key label').populate('sector', 'name').sort({ name: 1 }).lean();

export async function createUser(data) {
    await ensureRole(data.role);
    const user = await User.create({ ...data, mustChangePassword: true });
    return User.findById(user._id).populate('role', 'key label').populate('sector', 'name');
}

async function ensureRole(id) {
    const role = await Role.findById(id);
    if (!role) throw AppError.badRequest('El rol indicado no existe.');
    return role;
}

async function countActiveAdmins(excludeId) {
    const admin = await Role.findOne({ key: 'admin' });
    if (!admin) return 0;
    return User.countDocuments({ role: admin._id, active: true, _id: { $ne: excludeId } });
}

export async function updateUser(id, data, actor) {
    const user = await User.findById(id).select('+tokenVersion').populate('role');
    if (!user) throw AppError.notFound('Usuario');
    const losingAdmin = user.role.key === 'admin' && (data.active === false || (data.role && String(data.role) !== String(user.role._id)));
    if (losingAdmin && (await countActiveAdmins(user._id)) === 0) throw AppError.badRequest('Tiene que quedar al menos un administrador activo.');
    if (String(user._id) === String(actor._id) && data.active === false) throw AppError.badRequest('No podés desactivar tu propio usuario.');
    if (data.role) await ensureRole(data.role);

    for (const k of ['name', 'email', 'role', 'sector', 'active']) if (data[k] !== undefined) user[k] = data[k];
    if (data.password) { user.password = data.password; user.mustChangePassword = true; }
    if (data.active === false || data.role) user.tokenVersion += 1; // corta sesiones abiertas
    await user.save();
    return User.findById(id).populate('role', 'key label').populate('sector', 'name');
}

export async function deleteUser(id, actor) {
    // No se borran usuarios (quedan referenciados en la historia): se desactivan.
    return updateUser(id, { active: false }, actor);
}

// ----- Roles -----
export const listRoles = () => Role.find().sort({ label: 1 }).lean();
export const permissionCatalog = () => Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }));

export async function createRole(data) {
    return Role.create({ ...data, system: false });
}

export async function updateRole(id, data) {
    const role = await Role.findById(id);
    if (!role) throw AppError.notFound('Rol');
    if (role.key === 'admin') { data.permissions = ALL_PERMISSIONS; data.key = 'admin'; }
    Object.assign(role, data);
    await role.save(); // los permisos se leen en cada request: el cambio rige al instante
    return role;
}

export async function deleteRole(id) {
    const role = await Role.findById(id);
    if (!role) throw AppError.notFound('Rol');
    if (role.system) throw AppError.badRequest('Este rol es del sistema y no se puede borrar.');
    const users = await User.countDocuments({ role: id });
    if (users) throw AppError.badRequest(`Hay ${users} usuario(s) con este rol. Cambiales el rol antes de borrarlo.`);
    await role.deleteOne();
}
