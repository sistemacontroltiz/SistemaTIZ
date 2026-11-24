// Subida de fotos: solo imágenes reales (se valida la firma del archivo, no solo
// la extensión), nombre aleatorio y guardado FUERA de la carpeta pública.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import env from '../config/env.js';
import AppError from '../utils/AppError.js';

export const uploadRoot = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(path.join(uploadRoot, 'photos'), { recursive: true });

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(uploadRoot, 'photos')),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] || '.bin'}`),
});

export const photoUpload = multer({
    storage,
    limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => cb(ALLOWED[file.mimetype] ? null : AppError.badRequest('Solo se permiten fotos JPG, PNG o WEBP.'), Boolean(ALLOWED[file.mimetype])),
});

// Para facturas de compra a leer con IA: se guardan en memoria, no en disco.
export const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : AppError.badRequest('Formato no admitido (PDF, JPG, PNG o WEBP).'), ok);
    },
});

function signatureMatches(buf, mime) {
    if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (mime === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mime === 'image/webp') return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    if (mime === 'application/pdf') return buf.subarray(0, 5).toString() === '%PDF-';
    return false;
}

// Después de multer: borra y rechaza archivos cuyo contenido no coincide con el tipo declarado.
export async function verifyFileSignatures(req, res, next) {
    const files = req.files || (req.file ? [req.file] : []);
    for (const f of files) {
        const buf = f.buffer || await fs.promises.readFile(f.path).then(b => b.subarray(0, 16));
        if (!signatureMatches(buf, f.mimetype)) {
            await Promise.all(files.filter(x => x.path).map(x => fs.promises.rm(x.path, { force: true })));
            throw AppError.badRequest(`"${f.originalname}" no es un archivo válido.`);
        }
    }
    next();
}

export function photoPath(file) {
    // file viene de la base; igual se valida para impedir rutas tipo ../../
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file)) throw AppError.notFound('Foto');
    return path.join(uploadRoot, 'photos', file);
}
