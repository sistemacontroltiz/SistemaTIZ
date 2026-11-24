// Código QR obligatorio en comprobantes electrónicos (RG 4291).
import QRCode from 'qrcode';
import { toYMD } from '../../utils/dates.js';

export function qrUrl(inv, issuerCuit) {
    const data = {
        ver: 1,
        fecha: toYMD(inv.date),
        cuit: Number(issuerCuit),
        ptoVta: inv.pointOfSale,
        tipoCmp: inv.cbteType,
        nroCmp: inv.number,
        importe: Number(inv.total.toFixed(2)),
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: inv.clientSnapshot.docType,
        nroDocRec: Number(inv.clientSnapshot.docNumber || 0),
        tipoCodAut: 'E',
        codAut: Number(inv.cae),
    };
    return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(data)).toString('base64')}`;
}

export const qrPng = (url) => QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
