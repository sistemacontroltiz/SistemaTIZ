// WSAA: autenticación con ARCA. Firma un "ticket de pedido de acceso" (TRA) con el
// certificado de la empresa y obtiene token + sign válidos por ~12 horas.
// El ticket se guarda en la base para no pedir uno nuevo en cada factura.
import forge from 'node-forge';
import { ArcaTicket } from '../../models/billing.js';
import AppError from '../../utils/AppError.js';
import { credentials, arcaMode } from './config.js';
import { soapCall, parseXml } from './soap.js';

export function buildTRA(service, now = new Date()) {
    const gen = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const exp = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId><generationTime>${gen}</generationTime><expirationTime>${exp}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
}

// Firma CMS (PKCS#7 SignedData con el contenido incluido), en base64.
export function signTRA(tra, certPem, keyPem) {
    let cert, key;
    try {
        cert = forge.pki.certificateFromPem(certPem);
        key = forge.pki.privateKeyFromPem(keyPem);
    } catch {
        throw new AppError('ARCA: el certificado o la clave privada no tienen un formato PEM válido.', 503);
    }
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, 'utf8');
    p7.addCertificate(cert);
    p7.addSigner({
        key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
            { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
            { type: forge.pki.oids.messageDigest },
            { type: forge.pki.oids.signingTime, value: new Date() },
        ],
    });
    p7.sign();
    return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export async function getTicket(service) {
    const id = `${arcaMode()}:${service}`;
    const cached = await ArcaTicket.findById(id).lean();
    if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) return cached;

    const { certPem, keyPem, urls } = credentials();
    const cms = signTRA(buildTRA(service), certPem, keyPem);
    let body;
    try {
        body = await soapCall(urls.wsaa, '',
            `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><in0>${cms}</in0></loginCms>`);
    } catch (e) {
        // ARCA no entrega otro ticket mientras el anterior siga vigente.
        if (/ya posee un TA valido/i.test(e.faultString || '') && cached) return cached;
        if (/ya posee un TA valido/i.test(e.faultString || '')) {
            throw new AppError('ARCA indica que ya hay un ticket vigente que no está guardado en este sistema. Esperá unos minutos y reintentá.', 503);
        }
        if (/Computador no autorizado|no autorizado/i.test(e.faultString || '')) {
            throw new AppError(`ARCA: el certificado no está autorizado para el servicio "${service}". Asocialo en el Administrador de Relaciones de ARCA.`, 503);
        }
        throw e;
    }
    const ticketXml = body?.loginCmsResponse?.loginCmsReturn;
    const ticket = parseXml(ticketXml || '')?.loginTicketResponse;
    if (!ticket?.credentials?.token) throw new AppError('ARCA: respuesta de autenticación inválida.', 502);
    const doc = {
        _id: id,
        token: ticket.credentials.token,
        sign: ticket.credentials.sign,
        expiresAt: new Date(ticket.header.expirationTime),
    };
    await ArcaTicket.findByIdAndUpdate(id, doc, { upsert: true });
    return doc;
}
