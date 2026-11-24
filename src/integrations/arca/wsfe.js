// WSFEv1: factura electrónica (A, B, C, notas de crédito y débito).
// En modo "simulado" devuelve CAEs de prueba sin conectarse a ARCA.
import crypto from 'node:crypto';
import AppError from '../../utils/AppError.js';
import { credentials, isSimulated } from './config.js';
import { getTicket } from './wsaa.js';
import { soapCall, xmlEscape, asArray } from './soap.js';
import { round2 } from '../../utils/money.js';

const NS = 'http://ar.gov.afip.dif.FEV1/';
const VAT_IDS = { 0: 3, 10.5: 4, 21: 5, 27: 6 }; // códigos de alícuota de ARCA

async function auth() {
    const { cuit, urls } = credentials();
    const t = await getTicket('wsfe');
    return { url: urls.wsfe, xml: `<Auth><Token>${t.token}</Token><Sign>${t.sign}</Sign><Cuit>${cuit}</Cuit></Auth>`, cuit };
}

function checkErrors(result) {
    const errs = asArray(result?.Errors?.Err).map(e => `${e.Code}: ${e.Msg}`);
    return errs;
}

const simulatedLast = new Map();

export async function dummy() {
    if (isSimulated()) return { AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK', simulated: true };
    const { urls } = credentials();
    const body = await soapCall(urls.wsfe, `${NS}FEDummy`, `<FEDummy xmlns="${NS}"/>`);
    return body.FEDummyResponse?.FEDummyResult;
}

export async function lastAuthorized(pointOfSale, cbteType) {
    if (isSimulated()) return simulatedLast.get(`${pointOfSale}-${cbteType}`) ?? 0;
    const a = await auth();
    const body = await soapCall(a.url, `${NS}FECompUltimoAutorizado`,
        `<FECompUltimoAutorizado xmlns="${NS}">${a.xml}<PtoVta>${pointOfSale}</PtoVta><CbteTipo>${cbteType}</CbteTipo></FECompUltimoAutorizado>`);
    const r = body.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
    const errs = checkErrors(r);
    if (errs.length) throw new AppError(`ARCA: ${errs.join(' | ')}`, 502);
    return Number(r?.CbteNro ?? 0);
}

export async function getVoucher(pointOfSale, cbteType, number) {
    if (isSimulated()) return null;
    const a = await auth();
    const body = await soapCall(a.url, `${NS}FECompConsultar`,
        `<FECompConsultar xmlns="${NS}">${a.xml}<FeCompConsReq><CbteTipo>${cbteType}</CbteTipo><CbteNro>${number}</CbteNro><PtoVta>${pointOfSale}</PtoVta></FeCompConsReq></FECompConsultar>`);
    const r = body.FECompConsultarResponse?.FECompConsultarResult;
    if (checkErrors(r).length) return null;
    return r?.ResultGet ?? null;
}

// Arma el XML del comprobante. `v` ya viene validado y redondeado.
export function buildDetail(v) {
    const iva = v.letter === 'C' || v.vat === 0 ? '' : `<Iva><AlicIva><Id>${VAT_IDS[v.vatRate]}</Id><BaseImp>${v.net.toFixed(2)}</BaseImp><Importe>${v.vat.toFixed(2)}</Importe></AlicIva></Iva>`;
    const services = v.concept === 1 ? '' : `<FchServDesde>${v.serviceFrom}</FchServDesde><FchServHasta>${v.serviceTo}</FchServHasta><FchVtoPago>${v.dueDate}</FchVtoPago>`;
    const assoc = v.associated ? `<CbtesAsoc><CbteAsoc><Tipo>${v.associated.type}</Tipo><PtoVta>${v.associated.pointOfSale}</PtoVta><Nro>${v.associated.number}</Nro><Cuit>${v.associated.cuit}</Cuit><CbteFch>${v.associated.date}</CbteFch></CbteAsoc></CbtesAsoc>` : '';
    return `<FECAEDetRequest><Concepto>${v.concept}</Concepto><DocTipo>${v.docType}</DocTipo><DocNro>${xmlEscape(v.docNumber)}</DocNro>`
        + `<CbteDesde>${v.number}</CbteDesde><CbteHasta>${v.number}</CbteHasta><CbteFch>${v.date}</CbteFch>`
        + `<ImpTotal>${v.total.toFixed(2)}</ImpTotal><ImpTotConc>0.00</ImpTotConc><ImpNeto>${v.net.toFixed(2)}</ImpNeto>`
        + `<ImpOpEx>${(v.exempt || 0).toFixed(2)}</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>${v.vat.toFixed(2)}</ImpIVA>`
        + `${services}<MonId>PES</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>${v.receiverIvaId}</CondicionIVAReceptorId>${assoc}${iva}</FECAEDetRequest>`;
}

// Solicita CAE. Devuelve { approved, cae, caeDue, observations, errors }.
export async function requestCAE(v) {
    if (round2(v.net + v.vat + (v.exempt || 0)) !== round2(v.total)) {
        throw new AppError('Los importes no cierran (neto + IVA ≠ total).', 400);
    }
    if (isSimulated()) {
        simulatedLast.set(`${v.pointOfSale}-${v.cbteType}`, v.number);
        const due = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
        return { approved: true, cae: `7${crypto.randomInt(1e12, 9e12)}`.slice(0, 14), caeDue: due, observations: ['Comprobante SIMULADO: sin validez fiscal.'], errors: [] };
    }
    const a = await auth();
    const xml = `<FECAESolicitar xmlns="${NS}">${a.xml}<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${v.pointOfSale}</PtoVta><CbteTipo>${v.cbteType}</CbteTipo></FeCabReq><FeDetReq>${buildDetail(v)}</FeDetReq></FeCAEReq></FECAESolicitar>`;
    const body = await soapCall(a.url, `${NS}FECAESolicitar`, xml, { timeoutMs: 60000 });
    const r = body.FECAESolicitarResponse?.FECAESolicitarResult;
    const det = asArray(r?.FeDetResp?.FECAEDetResponse)[0] || {};
    const observations = asArray(det.Observaciones?.Obs).map(o => `${o.Code}: ${o.Msg}`);
    const errors = checkErrors(r);
    const approved = det.Resultado === 'A' && Boolean(det.CAE);
    return { approved, cae: approved ? String(det.CAE) : '', caeDue: det.CAEFchVto || '', observations, errors };
}
