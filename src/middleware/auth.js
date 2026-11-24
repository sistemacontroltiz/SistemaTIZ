// Autenticación con JWT guardado en cookie httpOnly (el JavaScript del navegador
// no puede leerla, así que un XSS no puede robar la sesión).
import jwt from 'jsonwebtoken';
import env, { isProd } from '../config/env.js';
import User from '../models/User.js';
import AppError from '../utils/AppError.js';

export const COOKIE_NAME = 'erp_session';

export function cookieOptions() {
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: 'strict',
        path: '/',
        maxAge: env.JWT_EXPIRES_HOURS * 3600 * 1000,
    };
}

export function signSession(user) {
    return jwt.sign({ sub: String(user._id), v: user.tokenVersion }, env.JWT_SECRET, {
        expiresIn: `${env.JWT_EXPIRES_HOURS}h`, algorithm: 'HS256',
    });
}

// Exige sesión válida. Recarga el usuario en cada request: si fue desactivado
// o cambió la contraseña, la sesión deja de valer al instante.
export async function requireAuth(req, res, next) {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw AppError.unauthorized();
    let payload;
    try {
        payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        throw AppError.unauthorized(e.name === 'TokenExpiredError' ? 'La sesión expiró. Ingresá de nuevo.' : 'Sesión inválida.');
    }
    const user = await User.findById(payload.sub).select('+tokenVersion').populate('role').populate('sector', 'name');
    if (!user || !user.active || user.tokenVersion !== payload.v || !user.role) {
        res.clearCookie(COOKIE_NAME, { path: '/' });
        throw AppError.unauthorized('Sesión inválida.');
    }
    req.user = user;
    req.permissions = new Set(user.role.permissions);
    next();
}

// Exige AL MENOS UNO de los permisos indicados.
export function permit(...perms) {
    return (req, res, next) => {
        if (!req.permissions || !perms.some(p => req.permissions.has(p))) throw AppError.forbidden();
        next();
    };
}

export const can = (req, perm) => Boolean(req.permissions?.has(perm));
