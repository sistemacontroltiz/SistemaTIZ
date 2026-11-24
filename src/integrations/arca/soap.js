// Cliente SOAP mínimo para los web services de ARCA.
import { XMLParser } from 'fast-xml-parser';
import AppError from '../../utils/AppError.js';

const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false, // todo como texto: evita perder ceros a la izquierda (CAE, CUIT)
    trimValues: true,
});

export const xmlEscape = (v) => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

export function parseXml(xml) {
    return parser.parse(xml);
}

export async function soapCall(url, action, bodyXml, { timeoutMs = 30000 } = {}) {
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Header/><soapenv:Body>${bodyXml}</soapenv:Body></soapenv:Envelope>`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: action },
            body: envelope,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (e) {
        throw new AppError(`No se pudo conectar con ARCA (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.message}).`, 503);
    }
    const text = await res.text();
    const doc = parseXml(text);
    const body = doc?.Envelope?.Body;
    if (body?.Fault) {
        const msg = body.Fault.faultstring || 'Error SOAP';
        const err = new AppError(`ARCA: ${msg}`, 502);
        err.faultString = msg;
        throw err;
    }
    if (!res.ok || !body) throw new AppError(`ARCA respondió HTTP ${res.status}.`, 502);
    return body;
}

export const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
