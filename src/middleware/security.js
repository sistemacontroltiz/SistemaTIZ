// Cabeceras de seguridad, CORS, CSRF, sanitización y límites de pedidos.
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsOrigins, isProd } from '../config/env.js';
import AppError from '../utils/AppError.js';

export const securityHeaders = helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'"],          // sin scripts inline ni externos
            'style-src': ["'self'"],
            'img-src': ["'self'", 'data:', 'blob:'],
            'connect-src': ["'self'"],
            'object-src': ["'none'"],
            'frame-ancestors': ["'none'"],
            'form-action': ["'self'"],
            'upgrade-insecure-requests': isProd ? [] : null,
        },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProd ? undefined : false,
});

// CORS: solo orígenes declarados en CORS_ORIGINS. Si el frontend se sirve desde
// el mismo servidor (lo normal), no hace falta declarar nada.
export function cors(req, res, next) {
    const origin = req.get('origin');
    if (origin && corsOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Credentials', 'true');
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}

// CSRF: además de la cookie SameSite=Strict, toda escritura debe traer la cabecera
// X-Requested-With (un formulario de otro sitio no puede agregarla) y, si trae
// Origin, debe ser propio.
export function csrfGuard(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'fetch') throw AppError.forbidden('Solicitud rechazada (CSRF).');
    const origin = req.get('origin');
    if (origin) {
        const host = req.get('host');
        const sameOrigin = origin === `${req.protocol}://${host}` || origin === `https://${host}` || origin === `http://${host}`;
        if (!sameOrigin && !corsOrigins.includes(origin)) throw AppError.forbidden('Origen no permitido.');
    }
    next();
}

// Elimina claves peligrosas ($operadores y claves con punto) de body, params y query.
function clean(value, depth = 0) {
    if (depth > 20) return undefined;
    if (Array.isArray(value)) return value.map(v => clean(v, depth + 1));
    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
            out[k] = clean(v, depth + 1);
        }
        return out;
    }
    return value;
}

export function sanitize(req, res, next) {
    if (req.body) req.body = clean(req.body);
    if (req.params) req.params = clean(req.params);
    // En Express 5 req.query es de solo lectura: se redefine con la versión limpia.
    Object.defineProperty(req, 'query', { value: clean({ ...req.query }), writable: true, configurable: true });
    next();
}

const json429 = (msg) => (req, res) => res.status(429).json({ message: msg });

export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: json429('Demasiados intentos de ingreso. Esperá 15 minutos.'),
});

export const apiLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: json429('Demasiadas solicitudes. Probá en un minuto.'),
});
