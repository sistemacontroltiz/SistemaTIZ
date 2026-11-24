import multer from 'multer';
import { isProd } from '../config/env.js';

export function notFound(req, res) {
    res.status(404).json({ message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}

// Nunca devuelve el stack ni mensajes internos al navegador.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
    let status = err.status || err.statusCode || 500;
    let message = 'Error interno del servidor.';
    let details;

    if (err.expose) {
        message = err.message; details = err.details;
    } else if (err.name === 'ValidationError') {
        status = 400;
        details = Object.values(err.errors).map(e => ({ field: e.path, message: e.message }));
        message = details[0]?.message || 'Datos inválidos.';
    } else if (err.name === 'CastError') {
        status = 400; message = `Identificador inválido (${err.path}).`;
    } else if (err.code === 11000) {
        status = 409;
        const field = Object.keys(err.keyValue || {})[0] || 'campo';
        message = `Ya existe un registro con ese valor de "${field}".`;
    } else if (err instanceof multer.MulterError) {
        status = 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo es demasiado grande.' : 'Archivo inválido.';
    } else if (err.type === 'entity.too.large') {
        status = 413; message = 'La solicitud es demasiado grande.';
    } else if (err.type === 'entity.parse.failed') {
        status = 400; message = 'JSON inválido.';
    }

    if (status >= 500) console.error('[error]', req.method, req.originalUrl, err);
    const body = { message };
    if (details) body.details = details;
    if (!isProd && status >= 500) body.debug = err.message;
    res.status(status).json(body);
}
