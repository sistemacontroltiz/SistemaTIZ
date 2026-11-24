// Consulta de constancia de inscripción (padrón A5) para autocompletar clientes.
// Requiere asociar el servicio "ws_sr_constancia_inscripcion" al certificado.
import AppError from '../../utils/AppError.js';
import { credentials, isSimulated } from './config.js';
import { getTicket } from './wsaa.js';
import { soapCall, asArray } from './soap.js';

export async function lookupCuit(cuit) {
    if (isSimulated()) {
        return { cuit, name: `CONTRIBUYENTE SIMULADO ${cuit.slice(-4)}`, ivaCondition: 'RI', address: 'Calle Falsa 123', city: 'CABA', province: 'CIUDAD AUTONOMA BUENOS AIRES', simulated: true };
    }
    const { cuit: own, urls } = credentials();
    const t = await getTicket('ws_sr_constancia_inscripcion');
    const body = await soapCall(urls.padronA5, '',
        `<a5:getPersona_v2 xmlns:a5="http://a5.soap.ws.server.puc.sr/"><token>${t.token}</token><sign>${t.sign}</sign><cuitRepresentada>${own}</cuitRepresentada><idPersona>${cuit}</idPersona></a5:getPersona_v2>`);
    const p = body.getPersona_v2Response?.personaReturn;
    if (!p) throw AppError.notFound('Contribuyente');
    const errMsg = asArray(p.errorConstancia?.error).join(' ');
    const g = p.datosGenerales;
    if (!g) throw AppError.badRequest(errMsg || 'ARCA no devolvió datos para ese CUIT.');

    const taxes = asArray(p.datosRegimenGeneral?.impuesto).map(i => String(i.idImpuesto));
    let ivaCondition = 'CF';
    if (p.datosMonotributo) ivaCondition = 'MT';
    else if (taxes.includes('30')) ivaCondition = 'RI';
    else if (taxes.includes('32')) ivaCondition = 'EX';

    const dom = g.domicilioFiscal || {};
    return {
        cuit,
        name: g.razonSocial || [g.apellido, g.nombre].filter(Boolean).join(' '),
        ivaCondition,
        address: dom.direccion || '',
        city: dom.localidad || '',
        province: dom.descripcionProvincia || '',
        warning: errMsg || undefined,
    };
}
