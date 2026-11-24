// Endpoints oficiales de ARCA por entorno y carga del certificado.
import fs from 'node:fs';
import env from '../../config/env.js';
import AppError from '../../utils/AppError.js';

export const ENDPOINTS = {
    homologacion: {
        wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
        wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
        padronA5: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    },
    produccion: {
        wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
        wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
        padronA5: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    },
};

export const arcaMode = () => env.ARCA_MODE;
export const isSimulated = () => env.ARCA_MODE === 'simulado';

function readPem(inline, path, label) {
    if (inline) return inline.replace(/\\n/g, '\n');
    if (path) {
        try { return fs.readFileSync(path, 'utf8'); } catch { throw new AppError(`ARCA: no se pudo leer el archivo del ${label} (${path}).`, 503); }
    }
    throw new AppError(`ARCA no está configurado: falta el ${label}. Revisá el archivo .env.`, 503);
}

export function credentials() {
    if (!env.ARCA_CUIT) throw new AppError('ARCA no está configurado: falta ARCA_CUIT en el .env.', 503);
    return {
        cuit: env.ARCA_CUIT,
        certPem: readPem(env.ARCA_CERT_PEM, env.ARCA_CERT_PATH, 'certificado'),
        keyPem: readPem(env.ARCA_KEY_PEM, env.ARCA_KEY_PATH, 'clave privada'),
        urls: ENDPOINTS[env.ARCA_MODE],
    };
}

export function status() {
    const simulated = isSimulated();
    let configured = simulated;
    let problem = '';
    if (!simulated) {
        try { credentials(); configured = true; } catch (e) { problem = e.message; }
    }
    return { mode: env.ARCA_MODE, cuit: env.ARCA_CUIT || '', configured, problem };
}
