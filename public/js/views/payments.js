// Cobranzas: saldos por cobrar, cobros con retenciones, anticipos, aplicación,
// anulación, vista semanal y cuenta corriente.
import { api } from '../api.js';
import { html, setHtml, $, toast, showError, readForm, options, money, dmy, today, badge, confirmDialog, withBusy, modal } from '../dom.js';
import { statement } from './catalogs.js';

const kpi = (label, value, sub = '') => html`<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

const TABS = [['board', 'Seguimiento'], ['receivables', 'Por cobrar'], ['collect', 'Registrar cobro'], ['advance', 'Registrar anticipo'], ['list', 'Cobros registrados'], ['weekly', 'Semanal'], ['statement', 'Cuenta corriente']];

export async function render(ctx) {
    ctx.setTitle('Cobranzas');
    const tab = TABS.some(([k]) => k === ctx.params[0]) ? ctx.params[0] : 'board';
    const allowed = TABS.filter(([k]) => ctx.can('payments:write') || !['collect', 'advance'].includes(k));
    setHtml(ctx.root, html`<div class="tabs">${allowed.map(([k, l]) => html`<button type="button" data-goto="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`)}</div><div data-tab></div>`);
    const box = $('[data-tab]', ctx.root);
    ctx.root.onclick = (e) => { const g = e.target.closest('[data-goto]'); if (g) ctx.navigate(`#/payments/${g.dataset.goto}`); };
    const views = { board, receivables, collect, advance, list, weekly, statement: statementTab };
    await views[tab](ctx, box, ctx.params[1]);
}

// Tablero visual de seguimiento de cobranzas: todas las obras con total, facturado,
// cobrado, faltante, avance y estado de cobro. Pensado para el perfil de cobranzas.
const COBRO_CLASS = { Cobrado: 'ok', Parcial: 'warn', 'Sin cobrar': '', Vencido: 'bad' };
async function board(ctx, box) {
    const { rows, totals } = await api.get('/payments/board');
    const canWO = ctx.can('workorders:read');
    setHtml(box, html`<div class="grid cols-4">
        ${kpi('Valor de obras', money(totals.total), `${totals.count} obra(s)`)}
        ${kpi('Facturado', money(totals.invoiced))}
        ${kpi('Cobrado', money(totals.cobrado))}
        ${kpi('Faltante por cobrar', money(totals.saldo), `${totals.withBalance} con saldo`)}</div>
        ${totals.overdue > 0 ? html`<div class="alert warn mt">Vencido sin cobrar: <strong>${money(totals.overdue)}</strong></div>` : ''}
        <div class="filters mt"><input type="search" data-q class="search-wide" placeholder="Buscar cliente, OT o presupuesto…">
        <select data-estado>${options(['con saldo', 'vencido', 'sin cobrar', 'parcial', 'cobrado'], '', { empty: 'Todos los estados' })}</select></div>
        <div data-board></div>`);
    const draw = () => {
        const q = $('[data-q]', box).value.trim().toLowerCase();
        const f = $('[data-estado]', box).value;
        let list = rows;
        if (q) list = list.filter(r => [r.clientName, r.number, r.quoteNumber].some(x => (x || '').toLowerCase().includes(q)));
        if (f === 'con saldo') list = list.filter(r => r.saldo > 0.01);
        else if (f) list = list.filter(r => r.cobro.toLowerCase() === f);
        setHtml($('[data-board]', box), html`<div class="table-wrap"><table><thead><tr><th>OT / Presup.</th><th>Cliente</th><th>Estado OT</th>
            <th class="num">Total</th><th class="num">Facturado</th><th class="num">Cobrado</th><th class="num">Faltante</th><th>Avance de cobro</th><th>Cobro</th></tr></thead>
            <tbody>${list.length ? list.map(r => html`<tr class="${canWO ? 'clickable' : ''}" data-id="${r.workOrder}">
            <td class="nowrap">${r.number || ''}${r.quoteNumber ? html` <span class="small muted">${r.quoteNumber}</span>` : ''}</td>
            <td>${r.clientName}</td><td>${badge(r.status)}</td>
            <td class="num">${money(r.total)}</td><td class="num">${money(r.invoiced)}</td><td class="num">${money(r.cobrado)}</td>
            <td class="num"><strong>${money(r.saldo)}</strong></td>
            <td><span class="cobro-bar"><span class="cobro-fill ${COBRO_CLASS[r.cobro] || ''}" data-pct="${r.pct}"></span></span> <span class="small muted">${r.pct}%</span></td>
            <td><span class="badge ${COBRO_CLASS[r.cobro] || ''}">${r.cobro}</span></td></tr>`)
            : html`<tr><td colspan="9" class="muted">Sin obras para ese filtro.</td></tr>`}</tbody></table></div>`);
        // El ancho de la barra se setea por JS (el CSP bloquea estilos inline en el HTML).
        $('[data-board]', box).querySelectorAll('.cobro-fill').forEach(el => { el.style.width = `${el.dataset.pct}%`; });
    };
    draw();
    box.oninput = draw;
    box.addEventListener('change', draw);
    box.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && canWO) ctx.navigate(`#/workorders/${tr.dataset.id}`); });
}

async function receivables(ctx, box) {
    const r = await api.get('/payments/receivables');
    setHtml(box, html`<div class="grid cols-3"><div class="kpi"><div class="label">Total por cobrar</div><div class="value">${money(r.totals.balance)}</div></div>
        <div class="kpi"><div class="label">Vencido</div><div class="value">${money(r.totals.overdue)}</div></div>
        <div class="kpi"><div class="label">Anticipos sin aplicar</div><div class="value">${money(r.unappliedAdvances.reduce((a, p) => a + p.totalApplied, 0))}</div></div></div>
        <div class="grid cols-2 mt"><div class="card"><h2>Por cliente</h2><div class="table-wrap"><table><thead><tr><th>Cliente</th><th class="num">Facturas</th><th class="num">Saldo</th><th class="num">Vencido</th></tr></thead>
        <tbody>${r.clients.map(c => html`<tr class="clickable" data-statement="${c.client}"><td>${c.clientName}</td><td class="num">${c.invoices}</td><td class="num">${money(c.balance)}</td>
        <td class="num">${c.overdue ? html`<span class="badge bad">${money(c.overdue)}</span>` : ''}</td></tr>`)}</tbody></table></div></div>
        <div class="card"><h2>Anticipos sin aplicar</h2>${r.unappliedAdvances.length ? html`<div class="table-wrap"><table><thead><tr><th>Recibo</th><th>Cliente</th><th>OT</th><th class="num">Importe</th><th></th></tr></thead>
        <tbody>${r.unappliedAdvances.map(p => html`<tr><td>${p.number}</td><td>${p.clientName}</td><td>${p.workOrder?.number}</td><td class="num">${money(p.totalApplied)}</td>
        <td>${ctx.can('payments:write') ? html`<button class="sm" data-apply="${p._id}" data-client="${p.client}" data-wo="${p.workOrder?._id}">Aplicar a factura</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">No hay anticipos pendientes de aplicar.</p>`}</div></div>
        <div class="card"><h2>Facturas con saldo</h2><div class="table-wrap"><table><thead><tr><th>Comprobante</th><th>Cliente</th><th>Fecha</th><th>Vence</th><th class="num">Atraso</th><th class="num">Total</th><th class="num">Saldo</th><th></th></tr></thead>
        <tbody>${r.invoices.length ? r.invoices.map(i => html`<tr><td><a href="#/invoices/${i._id}">${i.fullNumber}</a></td><td>${i.clientName}</td><td>${dmy(i.date)}</td><td>${dmy(i.dueDate)}</td>
        <td class="num">${i.overdueDays ? html`<span class="badge bad">${i.overdueDays} días</span>` : ''}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.balance)}</td>
        <td>${ctx.can('payments:write') ? html`<a class="btn sm primary" href="#/payments/collect/${i._id}">Cobrar</a>` : ''}</td></tr>`)
        : html`<tr><td colspan="8" class="muted">No hay saldos pendientes.</td></tr>`}</tbody></table></div></div>`);
    box.onclick = async (e) => {
        const st = e.target.closest('[data-statement]');
        if (st) statement({ _id: st.dataset.statement }).catch(showError);
        const ap = e.target.closest('[data-apply]');
        if (ap) {
            const invs = (await api.get('/invoices', { client: ap.dataset.client, status: 'impagas' })).filter(i => i.workOrders.some(w => w._id === ap.dataset.wo));
            if (!invs.length) { toast('No hay facturas con saldo de esa OT.'); return; }
            const m = modal({
                title: 'Aplicar anticipo', body: html`<form id="apForm"><div class="field"><label>Factura</label><select name="invoice">${options(invs, '', { label: i => `${i.fullNumber} · saldo ${money(i.balance)}` })}</select></div></form>`,
                footer: html`<button data-close>Cancelar</button><button class="primary" form="apForm">Aplicar</button>`,
            });
            m.el.querySelector('form').addEventListener('submit', async (ev) => {
                ev.preventDefault();
                try { await api.post(`/payments/${ap.dataset.apply}/apply`, readForm(ev.target)); m.close(); toast('Anticipo aplicado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
            });
        }
    };
}

const withholdingFields = html`<h3>Retenciones sufridas</h3><div class="grid cols-4">
    <div class="field"><label>IVA</label><input name="wh_iva" type="number" step="0.01" min="0" value="0"></div>
    <div class="field"><label>Ingresos Brutos</label><input name="wh_iibb" type="number" step="0.01" min="0" value="0"></div>
    <div class="field"><label>Ganancias</label><input name="wh_ganancias" type="number" step="0.01" min="0" value="0"></div>
    <div class="field"><label>SUSS</label><input name="wh_suss" type="number" step="0.01" min="0" value="0"></div></div>`;
const methodFields = html`<div class="grid cols-4">
    <div class="field"><label>Fecha del pago *</label><input type="date" name="date" required max="${today()}" value="${today()}"></div>
    <div class="field"><label>Medio</label><select name="method">${options(['Transferencia', 'Efectivo', 'Cheque', 'eCheq', 'Tarjeta', 'Otro'], 'Transferencia')}</select></div>
    <div class="field"><label>Referencia / N° de cheque</label><input name="reference" maxlength="100"></div>
    <div class="field"><label>Vto. cheque</label><input type="date" name="chequeDueDate" data-type="optional"></div></div>`;

function paymentBody(form, extra) {
    const f = readForm(form);
    const wh = { iva: Number(f.wh_iva || 0), iibb: Number(f.wh_iibb || 0), ganancias: Number(f.wh_ganancias || 0), suss: Number(f.wh_suss || 0) };
    return { ...extra, date: f.date, method: f.method, reference: f.reference, chequeDueDate: f.chequeDueDate || null, amount: Number(f.amount || 0), withholdings: wh, notes: f.notes };
}
function appliedTotal(form) {
    const f = readForm(form);
    return ['amount', 'wh_iva', 'wh_iibb', 'wh_ganancias', 'wh_suss'].reduce((a, k) => a + Number(f[k] || 0), 0);
}

async function collect(ctx, box, invoiceId) {
    const pre = invoiceId ? await api.get(`/invoices/${invoiceId}`) : null;
    const clients = await api.get('/clients', { active: 'true', limit: 2000 });
    setHtml(box, html`<form class="card" id="payForm"><div class="grid cols-2">
        <div class="field"><label>Cliente *</label><select name="client" required>${options(clients, pre?.client, { empty: 'Elegí cliente' })}</select></div>
        <div class="field"><label>Comprobante *</label><select name="invoice" required></select></div></div>
        <div class="field hidden" data-wo-field><label>Trabajo (OT) del recibo *</label><select name="reciboWo"></select></div>
        ${methodFields}<div class="field"><label>Importe recibido *</label><input name="amount" type="number" step="0.01" min="0" required></div>
        ${withholdingFields}<div class="field"><label>Notas</label><input name="notes" maxlength="500"></div>
        <div class="row end"><strong data-applied></strong><button class="primary" data-submit>Registrar cobro</button></div></form>`);
    const form = $('#payForm', box);
    let invs = [], clientWos = [];
    const isRecibo = () => form.invoice.value === '__recibo__';
    const loadInvoices = async () => {
        invs = form.client.value ? await api.get('/invoices', { client: form.client.value, status: 'impagas' }) : [];
        const invOpts = invs.map(i => `<option value="${i._id}">${i.fullNumber} · vence ${dmy(i.dueDate)} · saldo ${money(i.balance)}</option>`).join('');
        form.invoice.innerHTML = `<option value="">Elegí factura</option><option value="__recibo__">Cobro por Recibo</option>${invOpts}`;
        if (invoiceId && invs.some(i => i._id === invoiceId)) form.invoice.value = invoiceId;
        clientWos = form.client.value ? await api.get('/workorders', { status: 'con_saldo', client: form.client.value }) : [];
        setHtml(form.reciboWo, options(clientWos, '', { empty: clientWos.length ? 'Elegí OT' : 'Este cliente no tiene OT con saldo', label: w => `${w.number} · ${w.title || ''} · pendiente ${money(w.total - w.collected - w.advances)}` }));
        toggleMode(); update();
    };
    const toggleMode = () => {
        $('[data-wo-field]', box).classList.toggle('hidden', !isRecibo());
        $('[data-submit]', box).textContent = isRecibo() ? 'Cobrar por recibo' : 'Registrar cobro';
    };
    const update = () => {
        const inv = invs.find(i => i._id === form.invoice.value);
        if (inv && !form.amount.value) form.amount.value = inv.balance;
        const tot = appliedTotal(form);
        setHtml($('[data-applied]', box), isRecibo()
            ? html`Recibo por ${money(tot)} · no se emite factura`
            : html`Aplicado: ${money(tot)}${inv ? html` de ${money(inv.balance)}${tot > inv.balance + 0.01 ? html` <span class="badge bad">supera el saldo</span>` : ''}` : ''}`);
    };
    await loadInvoices();
    box.onchange = (e) => {
        if (e.target.name === 'client') { form.amount.value = ''; loadInvoices(); }
        else if (e.target.name === 'invoice') { toggleMode(); update(); }
        else update();
    };
    box.oninput = update;
    box.onsubmit = async (e) => {
        e.preventDefault();
        if (isRecibo() && !form.reciboWo.value) { toast('Elegí la OT del recibo.', 'bad'); return; }
        await withBusy(e.submitter, async () => {
            const p = isRecibo()
                ? await api.post('/payments', paymentBody(form, { kind: 'anticipo', client: form.client.value, workOrder: form.reciboWo.value }))
                : await api.post('/payments', paymentBody(form, { kind: 'cobro', client: form.client.value, invoice: form.invoice.value }));
            toast(isRecibo() ? `Recibo ${p.number} por ${money(p.totalApplied)}.` : `Cobro ${p.number} registrado por ${money(p.totalApplied)}.`, 'ok');
            ctx.navigate(isRecibo() ? '#/payments/list' : '#/payments/receivables');
        });
    };
}

async function advance(ctx, box, woId) {
    const wos = await api.get('/workorders', { status: 'con_saldo' });
    setHtml(box, html`<div class="alert info">El anticipo se registra contra la OT antes de facturar. Cuando se emita la factura se aplica automáticamente.</div>
        <form class="card" id="advForm"><div class="field"><label>OT *</label><select name="workOrder" required>${options(wos, woId, { empty: 'Elegí OT', label: w => `${w.number} · ${w.clientName} · pendiente ${money(w.total - w.collected - w.advances)}` })}</select></div>
        ${methodFields}<div class="field"><label>Importe recibido *</label><input name="amount" type="number" step="0.01" min="0" required></div>
        ${withholdingFields}<div class="field"><label>Notas</label><input name="notes" maxlength="500"></div>
        <div class="row end"><button class="primary">Registrar anticipo</button></div></form>`);
    box.onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const wo = wos.find(w => w._id === form.workOrder.value);
        await withBusy(e.submitter, async () => {
            const p = await api.post('/payments', paymentBody(form, { kind: 'anticipo', client: String(wo.client), workOrder: wo._id }));
            toast(`Anticipo ${p.number} registrado.`, 'ok');
            ctx.navigate(`#/workorders/${wo._id}`);
        });
    };
}

async function list(ctx, box) {
    setHtml(box, html`<div class="filters"><input type="date" data-from><input type="date" data-to><select data-kind>${options(['cobro', 'anticipo'], '', { empty: 'Cobros y anticipos' })}</select></div><div data-rows></div>`);
    const load = async () => {
        const rows = await api.get('/payments', { from: $('[data-from]', box).value, to: $('[data-to]', box).value, kind: $('[data-kind]', box).value });
        setHtml($('[data-rows]', box), html`<div class="table-wrap"><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Aplicado a</th><th>Medio</th>
            <th class="num">Recibido</th><th class="num">Retenciones</th><th>Estado</th><th></th></tr></thead><tbody>
            ${rows.length ? rows.map(p => html`<tr><td><a href="/api/payments/${p._id}/pdf" target="_blank" rel="noopener" title="Ver recibo (PDF)">${p.number}</a></td><td>${dmy(p.date)}</td><td>${p.clientName}</td><td>${p.kind}</td>
            <td>${p.invoice ? `${p.invoice.kind} ${String(p.invoice.pointOfSale).padStart(5, '0')}-${String(p.invoice.number).padStart(8, '0')}` : p.workOrder?.number || ''}</td>
            <td>${p.method} ${p.reference}</td><td class="num">${money(p.amount)}</td><td class="num">${money(p.totalApplied - p.amount)}</td><td>${badge(p.status)}</td>
            <td>${ctx.can('payments:write') && p.status === 'Vigente' ? html`<button class="sm danger" data-cancel="${p._id}">Anular</button>` : ''}</td></tr>`)
            : html`<tr><td colspan="10" class="muted">Sin cobros.</td></tr>`}</tbody></table></div>`);
    };
    box.onchange = load;
    box.onclick = async (e) => {
        const b = e.target.closest('[data-cancel]');
        if (!b) return;
        const reason = await confirmDialog('Anular el cobro devuelve el saldo a la factura.', { input: 'Motivo', danger: true, okText: 'Anular' });
        if (reason) await withBusy(b, async () => { await api.post(`/payments/${b.dataset.cancel}/cancel`, { reason }); toast('Cobro anulado.', 'ok'); load(); });
    };
    await load();
}

async function weekly(ctx, box) {
    const weeks = await api.get('/payments/weekly');
    const max = Math.max(1, ...weeks.map(w => Math.max(w.collected, w.dueAmount)));
    const W = 680; const rowH = 26;
    setHtml(box, html`<div class="card"><h2>Cobrado vs. vencimientos por semana</h2><p class="small muted">Barra de color: cobrado. Barra gris: facturas que vencen esa semana (saldo pendiente).</p>
        <svg class="bars" viewBox="0 0 ${W} ${weeks.length * rowH + 10}" width="100%" role="img" aria-label="Cobranza semanal">
        ${weeks.map((w, i) => html`<text x="0" y="${i * rowH + 16}">${dmy(w.start)}</text>
            <rect class="bar" x="90" y="${i * rowH + 4}" height="9" width="${Math.max(1, (w.collected / max) * (W - 200))}"></rect>
            <rect class="bar alt" x="90" y="${i * rowH + 14}" height="9" width="${Math.max(1, (w.dueAmount / max) * (W - 200))}"></rect>
            <text x="${W - 105}" y="${i * rowH + 16}">${money(w.collected)}</text>`)}</svg></div>
        <div class="table-wrap"><table><thead><tr><th>Semana del</th><th class="num">Cobrado</th><th class="num">Retenciones</th><th class="num">Anticipos</th><th class="num">Vence (saldo)</th><th class="num">Facturas</th></tr></thead>
        <tbody>${weeks.map(w => html`<tr><td>${dmy(w.start)}</td><td class="num">${money(w.collected)}</td><td class="num">${money(w.withholdings)}</td><td class="num">${money(w.advances)}</td>
        <td class="num">${money(w.dueAmount)}</td><td class="num">${w.dueCount || ''}</td></tr>`)}</tbody></table></div>`);
}

async function statementTab(ctx, box) {
    const clients = await api.get('/clients', { limit: 2000 });
    setHtml(box, html`<div class="card row"><select data-client>${options(clients, '', { empty: 'Elegí cliente' })}</select><button data-show class="primary">Ver cuenta corriente</button></div>`);
    box.onclick = (e) => {
        if (!e.target.closest('[data-show]')) return;
        const id = $('[data-client]', box).value;
        if (id) statement({ _id: id }).catch(showError);
    };
}
