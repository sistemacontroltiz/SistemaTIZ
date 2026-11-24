// Facturación electrónica ARCA: listado, emisión desde una o varias OT,
// notas de crédito, reintento seguro y PDF con QR.
import { api } from '../api.js';
import { html, raw, setHtml, $, $$, modal, toast, showError, readForm, options, money, dmy, dmyhm, today, badge, confirmDialog, withBusy } from '../dom.js';

const KIND = { FA: 'Factura A', FB: 'Factura B', FC: 'Factura C', NCA: 'NC A', NCB: 'NC B', NCC: 'NC C', NDA: 'ND A', NDB: 'ND B', NDC: 'ND C' };
const ENV_LABEL = { homologacion: 'HOMOLOGACIÓN (pruebas de ARCA)', produccion: 'PRODUCCIÓN', simulado: 'SIMULADO (sin ARCA)' };

async function arcaBanner() {
    try {
        const { arca } = await api.get('/settings/company');
        const cls = arca.mode === 'produccion' && arca.configured ? 'ok' : arca.configured ? 'warn' : 'bad';
        return html`<div class="alert ${cls}">ARCA: <strong>${ENV_LABEL[arca.mode]}</strong>${arca.cuit ? ` · CUIT ${arca.cuit}` : ''}${arca.problem ? html` · ${arca.problem}` : ''}
            ${arca.mode !== 'produccion' ? ' · Los comprobantes no tienen validez fiscal.' : ''}</div>`;
    } catch { return ''; }
}

export async function render(ctx) {
    if (ctx.params[0] === 'new') return issueForm(ctx, ctx.params[1]);
    if (ctx.params[0]) return detail(ctx, ctx.params[0]);
    ctx.setTitle('Facturación ARCA');
    if (ctx.can('invoices:issue')) ctx.setActions(html`<a class="btn primary" href="#/invoices/new">+ Emitir factura</a>`);
    setHtml(ctx.root, html`${await arcaBanner()}<div class="filters"><input type="search" placeholder="Cliente" data-q>
        <select data-status>${options([['impagas', 'Con saldo'], ['Autorizada', 'Autorizadas'], ['Error', 'Con error'], ['Rechazada', 'Rechazadas'], ['Pendiente', 'Pendientes']].map(([v, l]) => ({ v, l })), '', { value: 'v', label: 'l', empty: 'Todas' })}</select>
        <input type="date" data-from><input type="date" data-to></div><div data-list></div>`);
    const load = async () => {
        const list = await api.get('/invoices', { q: $('[data-q]', ctx.root).value, status: $('[data-status]', ctx.root).value, from: $('[data-from]', ctx.root).value, to: $('[data-to]', ctx.root).value });
        setHtml($('[data-list]', ctx.root), html`<div class="table-wrap"><table><thead><tr><th>Comprobante</th><th>Fecha</th><th>Cliente</th><th>OT</th><th class="num">Total</th>
            <th class="num">Saldo</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
            ${list.length ? list.map(i => html`<tr class="clickable" data-id="${i._id}"><td class="nowrap">${KIND[i.kind]} ${i.number ? `${String(i.pointOfSale).padStart(5, '0')}-${String(i.number).padStart(8, '0')}` : ''}</td>
            <td>${dmy(i.date)}</td><td>${i.clientSnapshot.name}</td><td>${i.workOrders.map(w => w.number).join(', ')}</td><td class="num">${money(i.total)}</td>
            <td class="num">${i.balance > 0 ? money(i.balance) : ''}</td><td>${dmy(i.dueDate)}</td><td>${badge(i.status)}${i.environment !== 'produccion' ? html` <span class="badge">${i.environment}</span>` : ''}</td></tr>`)
            : html`<tr><td colspan="8" class="muted">Sin comprobantes.</td></tr>`}</tbody></table></div>`);
    };
    let t;
    ctx.root.oninput = (e) => { if (e.target.matches('[data-q]')) { clearTimeout(t); t = setTimeout(load, 250); } };
    ctx.root.onchange = load;
    ctx.root.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate(`#/invoices/${tr.dataset.id}`); };
    await load();
}

async function issueForm(ctx, preselectWo) {
    ctx.setTitle('Emitir factura');
    ctx.setActions(html`<a class="btn" href="#/invoices">Volver</a>`);
    const all = (await api.get('/workorders', { limit: 500 })).filter(w => w.status !== 'Baja' && w.billing.status !== 'Facturada');
    const pre = all.find(w => w._id === preselectWo);
    const clients = [...new Map(all.map(w => [String(w.client), { _id: String(w.client), name: w.clientName }])).values()].sort((a, b) => a.name.localeCompare(b.name));
    setHtml(ctx.root, html`${await arcaBanner()}<form class="card" id="invForm">
        <div class="grid cols-4"><div class="field"><label>Cliente</label><select name="client" required>${options(clients, pre ? String(pre.client) : '', { empty: 'Elegí cliente' })}</select></div>
        <div class="field"><label>Concepto</label><select name="concept" data-type="number">${options([{ v: 3, l: 'Productos y servicios' }, { v: 1, l: 'Productos' }, { v: 2, l: 'Servicios' }], 3, { value: 'v', label: 'l' })}</select></div>
        <div class="field"><label>Fecha</label><input type="date" name="date" value="${today()}" required></div>
        <div class="field"><label>Vencimiento (vacío = plazo del cliente)</label><input type="date" name="dueDate" data-type="optional"></div>
        <div class="field" data-svc><label>Servicio desde</label><input type="date" name="serviceFrom" data-type="optional"></div>
        <div class="field" data-svc><label>Servicio hasta</label><input type="date" name="serviceTo" data-type="optional"></div></div>
        <h3>OT a facturar</h3><p class="small muted">Podés facturar varias OT del mismo cliente en un solo comprobante, o una parte (anticipo / avance) indicando el importe con IVA.</p>
        <div data-wos class="table-wrap"></div>
        <div class="field mt"><label>Observaciones</label><input name="notes" maxlength="1000"></div>
        <div class="row end"><strong data-total></strong><button class="primary">Emitir y pedir CAE</button></div></form>`);
    const form = $('#invForm');
    const drawWos = () => {
        const list = all.filter(w => String(w.client) === form.client.value);
        setHtml($('[data-wos]'), list.length ? html`<table class="lines"><thead><tr><th></th><th>OT</th><th>Título</th><th>Estado</th><th class="num">Total OT</th><th class="num">Facturado</th><th>Importe a facturar (con IVA)</th></tr></thead>
            <tbody>${list.map(w => html`<tr data-wo="${w._id}"><td><input type="checkbox" name="sel" ${w._id === preselectWo || list.length === 1 ? raw('checked') : ''}></td>
            <td>${w.number}</td><td>${w.title}</td><td>${badge(w.status)}</td><td class="num">${money(w.total)}</td><td class="num">${money(w.billing.invoiced)}</td>
            <td><input type="number" step="0.01" min="0.01" name="amount" value="${(w.total - w.billing.invoiced).toFixed(2)}" max="${(w.total - w.billing.invoiced).toFixed(2)}"></td></tr>`)}</tbody></table>`
            : html`<p class="muted">El cliente no tiene OT pendientes de facturar.</p>`);
        sumUp();
    };
    const sumUp = () => {
        const tot = $$('[data-wo]', form).filter(tr => $('[name=sel]', tr).checked).reduce((a, tr) => a + Number($('[name=amount]', tr).value || 0), 0);
        setHtml($('[data-total]'), `Total: ${money(tot)}`);
        $$('[data-svc]', form).forEach(el => el.classList.toggle('hidden', form.concept.value === '1'));
    };
    drawWos();
    ctx.root.onchange = (e) => { if (e.target.name === 'client') drawWos(); else sumUp(); };
    ctx.root.oninput = sumUp;
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const workOrders = $$('[data-wo]', form).filter(tr => $('[name=sel]', tr).checked).map(tr => ({ id: tr.dataset.wo, amount: Number($('[name=amount]', tr).value) }));
        if (!workOrders.length) { toast('Elegí al menos una OT.'); return; }
        const f = readForm(form);
        const body = { workOrders, concept: f.concept, date: f.date, dueDate: f.dueDate, serviceFrom: f.serviceFrom, serviceTo: f.serviceTo, notes: f.notes };
        if (!(await confirmDialog(`Se va a pedir el CAE a ARCA por ${$('[data-total]').textContent}. ¿Continuar?`, { okText: 'Emitir' }))) return;
        await withBusy(e.submitter, async () => {
            try {
                const inv = await api.post('/invoices', body);
                toast(inv.status === 'Autorizada' ? `Autorizada. CAE ${inv.cae}` : `ARCA rechazó el comprobante: ${[...inv.arcaErrors, ...inv.arcaObservations].join(' · ')}`, inv.status === 'Autorizada' ? 'ok' : 'bad');
                ctx.navigate(`#/invoices/${inv._id}`);
            } catch (err) {
                if (err.details?.invoiceId) { showError(err); ctx.navigate(`#/invoices/${err.details.invoiceId}`); return; }
                throw err;
            }
        });
    };
}

async function detail(ctx, id) {
    const i = await api.get(`/invoices/${id}`);
    const credit = i.kind.startsWith('NC');
    const balance = credit || i.status !== 'Autorizada' ? 0 : Math.round((i.total - i.paid - i.credited) * 100) / 100;
    ctx.setTitle(`${i.fullNumber}`);
    ctx.setActions(html`<a class="btn" href="/api/invoices/${i._id}/pdf" target="_blank" rel="noopener">PDF</a><a class="btn" href="#/invoices">Volver</a>`);
    setHtml(ctx.root, html`
        ${i.environment !== 'produccion' ? html`<div class="alert warn">Comprobante de ${ENV_LABEL[i.environment]}: sin validez fiscal.</div>` : ''}
        ${i.arcaErrors?.length ? html`<div class="alert bad"><strong>Errores:</strong><ul>${i.arcaErrors.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
        ${i.arcaObservations?.length ? html`<div class="alert info"><strong>Observaciones de ARCA:</strong><ul>${i.arcaObservations.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
        <div class="grid cols-4">
            <div class="kpi"><div class="label">Estado</div><div class="value">${badge(i.status)}</div><div class="sub">${i.cae ? `CAE ${i.cae} · vto ${dmy(i.caeDue)}` : 'Sin CAE'}</div></div>
            <div class="kpi"><div class="label">Cliente</div><div class="value small">${i.clientSnapshot.name}</div><div class="sub">${i.clientSnapshot.docNumber}</div></div>
            <div class="kpi"><div class="label">Total</div><div class="value">${money(i.total)}</div><div class="sub">Neto ${money(i.net)} · IVA ${money(i.vat)}</div></div>
            <div class="kpi"><div class="label">Saldo</div><div class="value">${money(balance)}</div><div class="sub">Cobrado ${money(i.paid)} · NC ${money(i.credited)} · vence ${dmy(i.dueDate)}</div></div></div>
        <div class="card mt row">
            ${ctx.can('invoices:issue') && ['Error', 'Pendiente'].includes(i.status) ? html`<button class="primary" data-retry>Reintentar con ARCA</button><button class="danger" data-discard>Descartar</button>` : ''}
            ${ctx.can('invoices:issue') && i.status === 'Autorizada' && !credit && balance > 0 ? html`<button data-nc>Emitir nota de crédito</button>` : ''}
            ${ctx.can('payments:write') && balance > 0 ? html`<a class="btn primary" href="#/payments/collect/${i._id}">Registrar cobro</a>` : ''}
            ${i.associated ? html`<a class="btn" href="#/invoices/${i.associated._id}">Ver comprobante original</a>` : ''}
            <span class="spacer"></span><span class="muted small">OT: ${i.workOrders.map(w => w.number).join(', ')}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">P. unit. (neto)</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${i.items.map(it => html`<tr><td>${it.description}</td><td class="num">${it.quantity}</td><td class="num">${money(it.unitPrice)}</td><td class="num">${money(it.subtotal)}</td></tr>`)}</tbody></table></div>
        ${i.payments.length ? html`<h3>Cobros aplicados</h3><div class="table-wrap"><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Medio</th><th class="num">Importe</th><th class="num">Retenciones</th><th>Estado</th></tr></thead>
            <tbody>${i.payments.map(p => html`<tr><td>${p.number}</td><td>${dmy(p.date)}</td><td>${p.method} ${p.reference}</td><td class="num">${money(p.amount)}</td><td class="num">${money(p.totalApplied - p.amount)}</td><td>${badge(p.status)}</td></tr>`)}</tbody></table></div>` : ''}
        ${i.credits.length ? html`<h3>Notas de crédito</h3><ul>${i.credits.map(c => html`<li><a href="#/invoices/${c._id}">${c.fullNumber}</a> · ${money(c.total)} · ${badge(c.status)}</li>`)}</ul>` : ''}
        <p class="small muted mt">Creado ${dmyhm(i.createdAt)}</p>`);

    ctx.root.onclick = async (e) => {
        const t = e.target;
        if (t.closest('[data-retry]')) await withBusy(t, async () => { const r = await api.post(`/invoices/${id}/retry`); toast(r.status === 'Autorizada' ? `Autorizada. CAE ${r.cae}` : 'ARCA rechazó el comprobante.', r.status === 'Autorizada' ? 'ok' : 'bad'); ctx.reload(); });
        if (t.closest('[data-discard]') && await confirmDialog('¿Descartar este comprobante sin CAE?', { danger: true })) {
            await withBusy(t, async () => { await api.del(`/invoices/${id}`); toast('Descartado.', 'ok'); ctx.navigate('#/invoices'); });
        }
        if (t.closest('[data-nc]')) {
            const m = modal({
                title: 'Nota de crédito',
                body: html`<form id="ncForm"><div class="field"><label>Importe con IVA (máximo ${money(balance)})</label><input type="number" name="amount" step="0.01" min="0.01" max="${balance}" value="${balance}" data-type="number" required></div>
                    <div class="field"><label>Motivo</label><input name="reason" required minlength="3" maxlength="500"></div></form>`,
                footer: html`<button data-close>Cancelar</button><button class="primary" form="ncForm">Emitir NC</button>`,
            });
            m.el.querySelector('form').addEventListener('submit', async (ev) => {
                ev.preventDefault();
                await withBusy(ev.submitter, async () => {
                    try {
                        const nc = await api.post(`/invoices/${id}/credit-note`, readForm(ev.target));
                        m.close(); toast(nc.status === 'Autorizada' ? 'Nota de crédito autorizada.' : 'ARCA rechazó la NC.', nc.status === 'Autorizada' ? 'ok' : 'bad');
                        ctx.navigate(`#/invoices/${nc._id}`);
                    } catch (err) { if (err.details?.invoiceId) { m.close(); showError(err); ctx.navigate(`#/invoices/${err.details.invoiceId}`); } else throw err; }
                });
            });
        }
    };
}
