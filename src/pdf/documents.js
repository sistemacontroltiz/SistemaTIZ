// PDFs de presupuesto y de factura electrónica (con QR de ARCA).
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { CBTE_TYPES } from '../models/billing.js';
import { IVA_CONDITIONS } from '../models/parties.js';
import { formatCuit } from '../utils/cuit.js';
import { toYMD } from '../utils/dates.js';
import { qrPng, qrUrl } from '../integrations/arca/qr.js';
import { fullNumber } from '../services/invoiceService.js';

const LOGO = path.resolve('public/img/LogoPresupuesto.png');
const money = (n) => `$ ${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d) => (d ? toYMD(d).split('-').reverse().join('/') : '');

function toBuffer(doc) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
    });
}

function header(doc, settings, title, right) {
    try { doc.image(LOGO, 40, 35, { width: 150 }); } catch { /* sin logo */ }
    doc.fontSize(9).fillColor('#333')
        .text(settings.businessName || '', 40, 90)
        .text(settings.address || '')
        .text(`CUIT ${formatCuit(settings.cuit)} · ${IVA_CONDITIONS[settings.ivaCondition]?.label ?? ''}`)
        .text([settings.phone, settings.email].filter(Boolean).join(' · '));
    doc.fontSize(16).fillColor('#000').text(title, 330, 40, { width: 225, align: 'right' });
    doc.fontSize(9).text(right.join('\n'), 330, 64, { width: 225, align: 'right' });
    doc.moveTo(40, 145).lineTo(555, 145).strokeColor('#bbb').stroke();
}

function itemsTable(doc, items, startY) {
    const cols = [40, 330, 390, 470];
    doc.fontSize(9).fillColor('#000').font('Helvetica-Bold');
    doc.text('Descripción', cols[0], startY).text('Cant.', cols[1], startY, { width: 50, align: 'right' })
        .text('P. unit.', cols[2], startY, { width: 75, align: 'right' }).text('Subtotal', cols[3], startY, { width: 85, align: 'right' });
    doc.font('Helvetica');
    let y = startY + 16;
    for (const it of items) {
        const h = Math.max(doc.heightOfString(it.description, { width: 280 }), 12);
        if (y + h > 700) { doc.addPage(); y = 50; }
        doc.text(it.description, cols[0], y, { width: 280 })
            .text(String(it.quantity), cols[1], y, { width: 50, align: 'right' })
            .text(money(it.unitPrice), cols[2], y, { width: 75, align: 'right' })
            .text(money(it.subtotal), cols[3], y, { width: 85, align: 'right' });
        y += h + 6;
    }
    return y;
}

function totals(doc, y, rows) {
    y += 8;
    doc.moveTo(330, y).lineTo(555, y).strokeColor('#bbb').stroke();
    y += 6;
    for (const [label, value, bold] of rows) {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9)
            .text(label, 330, y, { width: 130 }).text(money(value), 460, y, { width: 95, align: 'right' });
        y += bold ? 16 : 13;
    }
    doc.font('Helvetica').fontSize(9);
    return y;
}

export async function quotePdf(quote, settings) {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    header(doc, settings, 'PRESUPUESTO', [`N° ${quote.number}`, `Fecha: ${dmy(quote.issueDate)}`, `Válido hasta: ${dmy(quote.validUntil)}`]);
    const c = quote.client;
    doc.fontSize(10).font('Helvetica-Bold').text('Cliente', 40, 155).font('Helvetica').fontSize(9)
        .text(`${c?.name ?? quote.clientName}${c?.cuit ? ` · CUIT ${formatCuit(c.cuit)}` : ''}`)
        .text(quote.contact ? `Atención: ${quote.contact}` : '');
    if (quote.title) doc.moveDown(0.5).font('Helvetica-Bold').text(quote.title).font('Helvetica');
    const items = quote.items.map(i => (i.toObject ? i.toObject() : i));
    let y = itemsTable(doc, items.map(i => ({ ...i, description: i.detail ? `${i.description}\n${i.detail}` : i.description })), doc.y + 14);
    const rows = [['Subtotal', quote.net]];
    if (quote.invoiceType !== 'C') rows.push([`IVA ${quote.vatRate}%`, quote.vat]);
    rows.push(['TOTAL', quote.total, true]);
    y = totals(doc, y, rows);
    doc.moveDown(2).fontSize(8.5).fillColor('#333');
    const lines = [
        quote.deliveryDays ? `Plazo de entrega: ${quote.deliveryDays} días hábiles desde la aprobación.` : '',
        quote.paymentTerms ? `Forma de pago: ${quote.paymentTerms}` : '',
        quote.notes, settings.quoteTerms,
    ].filter(Boolean);
    doc.text(lines.join('\n\n'), 40, y + 20, { width: 515 });
    return toBuffer(doc);
}

export async function invoicePdf(inv, settings) {
    const t = CBTE_TYPES[inv.kind];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    header(doc, settings, t.label.toUpperCase(), [
        `N° ${String(inv.pointOfSale).padStart(5, '0')}-${String(inv.number ?? 0).padStart(8, '0')}`,
        `Fecha: ${dmy(inv.date)}`, `Vencimiento: ${dmy(inv.dueDate)}`,
        `IIBB: ${settings.iibb || '-'} · Inicio act.: ${dmy(settings.activityStart) || '-'}`,
    ]);
    // Letra en el recuadro central (obligatorio)
    doc.rect(275, 35, 40, 40).stroke('#000');
    doc.fontSize(24).font('Helvetica-Bold').text(t.letter, 275, 43, { width: 40, align: 'center' });
    doc.fontSize(6).font('Helvetica').text(`COD. ${String(inv.cbteType).padStart(2, '0')}`, 275, 66, { width: 40, align: 'center' });

    const c = inv.clientSnapshot;
    const docLabel = c.docType === 80 ? `CUIT ${formatCuit(c.docNumber)}` : c.docType === 96 ? `DNI ${c.docNumber}` : 'Consumidor final';
    doc.fontSize(10).font('Helvetica-Bold').text('Cliente', 40, 155).font('Helvetica').fontSize(9)
        .text(`${c.name} · ${docLabel}`).text(`Condición IVA: ${IVA_CONDITIONS[c.ivaCondition]?.label ?? ''}`).text(c.address || '');
    if (inv.concept !== 1) doc.text(`Período facturado: ${dmy(inv.serviceFrom)} al ${dmy(inv.serviceTo)}`);
    if (inv.associated?.number) doc.text(`Comprobante asociado: ${fullNumber(inv.associated)}`);

    let y = itemsTable(doc, inv.items, doc.y + 14);
    const rows = t.letter === 'A'
        ? [['Neto gravado', inv.net], [`IVA ${inv.vatRate}%`, inv.vat], ['TOTAL', inv.total, true]]
        : [['TOTAL', inv.total, true]];
    y = totals(doc, y, rows);
    if (t.letter === 'B' && inv.vat > 0) {
        doc.fontSize(8).text(`Régimen de Transparencia Fiscal al Consumidor (Ley 27.743): IVA contenido ${money(inv.vat)}`, 40, y + 6, { width: 515 });
    }

    if (inv.status === 'Autorizada') {
        const footY = 700;
        const png = await qrPng(qrUrl(inv, settings.cuit));
        doc.image(png, 40, footY, { width: 90 });
        doc.fontSize(9).text(`CAE: ${inv.cae}`, 140, footY + 20).text(`Vencimiento CAE: ${dmy(inv.caeDue)}`, 140, footY + 34);
        if (inv.environment !== 'produccion') {
            doc.fillColor('#c00').fontSize(10).text(`${inv.environment === 'simulado' ? 'COMPROBANTE SIMULADO' : 'COMPROBANTE DE HOMOLOGACIÓN (PRUEBA)'} - SIN VALIDEZ FISCAL`, 140, footY + 54);
        }
    } else {
        doc.fillColor('#c00').fontSize(14).text(`BORRADOR - ${inv.status.toUpperCase()} - SIN CAE`, 40, 720, { width: 515, align: 'center' });
    }
    return toBuffer(doc);
}

// Recibo de pago (cobro o anticipo). NO es un comprobante fiscal: no va a ARCA.
export async function reciboPdf(payment, settings) {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const right = [`N° ${payment.number}`, `Fecha: ${dmy(payment.date)}`, `Forma de pago: ${payment.method}`];
    if (payment.reference) right.push(`Ref.: ${payment.reference}`);
    if (payment.chequeDueDate) right.push(`Vto. cheque: ${dmy(payment.chequeDueDate)}`);
    header(doc, settings, 'RECIBO', right);

    doc.fontSize(10).font('Helvetica-Bold').text('Recibimos de', 40, 165).font('Helvetica').fontSize(9).text(payment.clientName || '');

    const woNum = payment.workOrder?.number;
    const concepto = payment.kind === 'anticipo'
        ? `Anticipo a cuenta${woNum ? ` del trabajo ${woNum}` : ''}`
        : `Pago${payment.invoice ? ' de factura' : ''}${woNum ? ` del trabajo ${woNum}` : ''}`;
    doc.moveDown(0.6).font('Helvetica-Bold').text('En concepto de', 40).font('Helvetica').text(concepto, { width: 515 });
    if (payment.notes) doc.fontSize(9).fillColor('#555').text(payment.notes, { width: 515 }).fillColor('#000');

    const ret = payment.withholdings || {};
    const totalRet = (ret.iva || 0) + (ret.iibb || 0) + (ret.ganancias || 0) + (ret.suss || 0);
    const rows = [['Importe recibido', payment.amount, totalRet === 0]];
    if (totalRet > 0) {
        if (ret.iva) rows.push(['Retención IVA', ret.iva]);
        if (ret.iibb) rows.push(['Retención IIBB', ret.iibb]);
        if (ret.ganancias) rows.push(['Retención Ganancias', ret.ganancias]);
        if (ret.suss) rows.push(['Retención SUSS', ret.suss]);
        rows.push(['Total aplicado', payment.totalApplied, true]);
    }
    totals(doc, doc.y + 24, rows);

    doc.fontSize(10).fillColor('#c00').font('Helvetica-Bold').text('DOCUMENTO NO VÁLIDO COMO FACTURA', 40, 715, { width: 515, align: 'center' }).fillColor('#000').font('Helvetica');
    if (payment.status === 'Anulado') {
        doc.fontSize(44).fillColor('#c00').opacity(0.25).text('ANULADO', 40, 380, { width: 515, align: 'center' }).opacity(1).fillColor('#000');
    }
    return toBuffer(doc);
}
