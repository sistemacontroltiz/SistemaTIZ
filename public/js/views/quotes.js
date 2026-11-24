// Presupuestos: listado, cotizador (materiales + mano de obra + margen), vigencia,
// estados, revisión de costos y aprobación que genera la OT.
import { api } from '../api.js';
import { html, raw, setHtml, $, $$, modal, toast, showError, readForm, options, money, num, dmy, dmyhm, ymd, addDays, badge, confirmDialog, withBusy } from '../dom.js';
import { aiPhotoBlock, attachmentsBlock, installPreviewHandlers } from './preview-widgets.js';

const STATUSES = ['Oportunidad', 'Borrador', 'Enviado', 'Aprobado', 'Rechazado', 'Vencido', 'Baja'];
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function render(ctx) {
    if (ctx.params[0] === 'alta') return altaForm(ctx);
    if (ctx.params[0]) return editor(ctx, ctx.params[0] === 'new' ? null : ctx.params[0]);
    ctx.setTitle('Presupuestos');
    const canAlta = ctx.can('opportunities:create') || ctx.can('quotes:write');
    ctx.setActions(html`${canAlta ? html`<a class="btn" href="#/quotes/alta">+ Alta de presupuesto</a>` : ''}${ctx.can('quotes:write') ? html`<a class="btn primary" href="#/quotes/new">+ Nuevo presupuesto</a>` : ''}`);
    setHtml(ctx.root, html`<div class="filters"><input type="search" placeholder="Número, cliente o título" data-q>
        <select data-status>${options(STATUSES, '', { empty: 'Todos los estados' })}</select></div><div data-list></div>`);
    const load = async () => {
        const list = await api.get('/quotes', { q: $('[data-q]', ctx.root).value, status: $('[data-status]', ctx.root).value });
        setHtml($('[data-list]', ctx.root), html`<div class="table-wrap"><table><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Título</th>
            <th class="num">Total</th><th>Vigencia</th><th>Estado</th><th>OT</th></tr></thead><tbody>
            ${list.length ? list.map(q => html`<tr class="clickable" data-id="${q._id}"><td class="nowrap">${q.number}</td><td>${dmy(q.issueDate)}</td><td>${q.clientName}</td>
            <td>${q.title}</td><td class="num">${money(q.total)}</td><td>${dmy(q.validUntil)}</td><td>${badge(q.status)}</td><td>${q.workOrder?.number || ''}</td></tr>`)
            : html`<tr><td colspan="8" class="muted">No hay presupuestos.</td></tr>`}</tbody></table></div>`);
    };
    let t;
    ctx.root.oninput = (e) => { if (e.target.matches('[data-q]')) { clearTimeout(t); t = setTimeout(load, 250); } };
    ctx.root.onchange = load;
    ctx.root.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate(`#/quotes/${tr.dataset.id}`); };
    await load();
}

// ---------- Cotizador ----------
// Alta de presupuesto: el vendedor carga la oportunidad; después el CPO la toma.
async function altaForm(ctx) {
    ctx.setTitle('Alta de presupuesto');
    const clients = await api.get('/clients', { active: 'true', limit: 2000 });
    ctx.setActions(html`<a class="btn" href="#/quotes">Volver</a>`);
    setHtml(ctx.root, html`<form id="altaForm" class="card">
        <p class="muted">Cargá la oportunidad de venta con lo que pide el cliente. Después el responsable de producción la toma, arma los ítems y la mano de obra, y envía el presupuesto.</p>
        <div class="grid cols-2">
            <div class="field"><label>Cliente *</label><select name="client" required>${options(clients, '', { empty: 'Elegí un cliente' })}</select></div>
            <div class="field"><label>Título / obra</label><input name="title" maxlength="200" placeholder="Ej.: Cartelería local Av. Mitre"></div>
        </div>
        <div class="field"><label>¿Qué pide el cliente? *</label><textarea name="requestDetails" required maxlength="2000" rows="5" placeholder="Descripción del trabajo, medidas aproximadas, materiales que menciona, plazos, referencias…"></textarea></div>
        <div class="row end"><button class="primary" type="submit">Cargar oportunidad</button></div>
    </form>`);
    $('#altaForm', ctx.root).addEventListener('submit', async (e) => {
        e.preventDefault();
        await withBusy(e.submitter, async () => {
            try { const q = await api.post('/quotes/opportunity', readForm(e.target)); toast('Oportunidad cargada.', 'ok'); ctx.navigate(`#/quotes/${q._id}`); }
            catch (err) { showError(err); }
        });
    });
}

function materialRow(m, products) {
    return html`<tr data-mat><td><select name="product" data-type="id">${options(products, m.product?._id || m.product, { empty: '— libre —' })}</select></td>
        <td><input name="name" value="${m.name || ''}" required maxlength="200"></td><td><input name="unit" value="${m.unit || ''}" maxlength="30" class="nowrap"></td>
        <td><input name="quantity" type="number" step="any" min="0" value="${m.quantity ?? 1}" data-type="number"></td>
        <td><input name="unitCost" type="number" step="0.01" min="0" value="${m.unitCost ?? 0}" data-type="number"></td>
        <td class="num" data-total>${money((m.quantity ?? 1) * (m.unitCost ?? 0))}</td><td><button type="button" class="sm danger" data-del-line>✕</button></td></tr>`;
}
function laborRow(l, rates, sectors) {
    return html`<tr data-lab><td><select name="laborRate" data-type="id">${options(rates, l.laborRate?._id || l.laborRate, { empty: '— libre —' })}</select></td>
        <td><input name="name" value="${l.name || ''}" required maxlength="200"></td>
        <td><select name="sector" data-type="id">${options(sectors, l.sector?._id || l.sector, { empty: 'Sin sector' })}</select></td>
        <td><input name="quantity" type="number" step="any" min="0" value="${l.quantity ?? 1}" data-type="number"></td>
        <td><input name="unitCost" type="number" step="0.01" min="0" value="${l.unitCost ?? 0}" data-type="number"></td>
        <td class="num" data-total>${money((l.quantity ?? 1) * (l.unitCost ?? 0))}</td>
        <td class="num"><input type="checkbox" name="parallel" ${l.parallel ? raw('checked') : ''}></td>
        <td><button type="button" class="sm danger" data-del-line>✕</button></td></tr>`;
}
function itemBlock(it, cat) {
    return html`<div class="item-block" data-item>
        <div class="head">
            <div><label>Descripción del ítem *</label><input name="description" value="${it.description || ''}" required maxlength="500"></div>
            <div><label>Cantidad</label><input name="quantity" type="number" step="any" min="0.0001" value="${it.quantity ?? 1}" data-type="number"></div>
            <div><label><input type="checkbox" name="priceOverride" ${it.priceOverride ? raw('checked') : ''}> Precio fijo</label>
                <input name="unitPrice" type="number" step="0.01" min="0" value="${it.unitPrice ?? ''}" data-type="number" ${it.priceOverride ? '' : raw('disabled')}></div>
            <div><button type="button" class="sm danger" data-del-item>Quitar ítem</button></div>
        </div>
        <div class="field mt"><label>Detalle (aparece en el PDF)</label><textarea name="detail" maxlength="2000">${it.detail || ''}</textarea></div>
        <h3>Materiales (por unidad del ítem)</h3>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Catálogo</th><th>Material</th><th>Unidad</th><th>Cant.</th><th>Costo u.</th><th class="num">Total</th><th></th></tr></thead>
        <tbody data-mats>${(it.materials || []).map(m => materialRow(m, cat.products))}</tbody></table></div>
        <button type="button" class="sm mt" data-add-mat>+ Material</button>
        <h3>Mano de obra (por unidad del ítem) <span class="small muted">— se encadenan en orden; marcá "Paralela" la que puede ir sin esperar a la anterior</span></h3>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Tarifa</th><th>Tarea</th><th>Sector</th><th>Cant.</th><th>Costo u.</th><th class="num">Total</th><th title="Sin predecesora">Paralela</th><th></th></tr></thead>
        <tbody data-labs>${(it.labor || []).map(l => laborRow(l, cat.rates, cat.sectors))}</tbody></table></div>
        <button type="button" class="sm mt" data-add-lab>+ Mano de obra</button>
        <div class="row end mt small" data-item-sum></div>
    </div>`;
}

function readItems(form) {
    return $$('[data-item]', form).map(block => {
        const head = Object.fromEntries(['description', 'quantity', 'unitPrice', 'detail'].map(n => [n, $(`[name=${n}]`, block).value]));
        const lines = (sel) => $$(sel, block).map(tr => readForm({ elements: $$('input,select', tr) }));
        return {
            description: head.description.trim(), detail: head.detail.trim(), quantity: Number(head.quantity) || 0,
            priceOverride: $('[name=priceOverride]', block).checked,
            unitPrice: head.unitPrice === '' ? undefined : Number(head.unitPrice),
            materials: lines('[data-mat]'), labor: lines('[data-lab]'),
        };
    });
}

// Mismo cálculo que el servidor, solo para mostrar en pantalla.
function recalc(form) {
    const invoiceType = form.invoiceType.value;
    const vatRate = invoiceType === 'C' ? 0 : Number(form.vatRate.value);
    const marginPct = Math.min(Math.max(Number(form.marginPct?.value) || 0, 0), 99.9);
    const factor = 1 - marginPct / 100;
    let net = 0; let cost = 0;
    for (const block of $$('[data-item]', form)) {
        let cm = 0; let cl = 0;
        for (const tr of $$('[data-mat],[data-lab]', block)) {
            const t = r2(Number($('[name=quantity]', tr).value) * Number($('[name=unitCost]', tr).value));
            setHtml($('[data-total]', tr), money(t));
            if (tr.matches('[data-mat]')) cm += t; else cl += t;
        }
        const q = Number($('[name=quantity]', block).value) || 0;
        const unitCost = r2(cm + cl);
        const fixed = $('[name=priceOverride]', block).checked;
        const priceInput = $('[name=unitPrice]', block);
        priceInput.disabled = !fixed;
        const unitPrice = fixed ? r2(Number(priceInput.value) || 0) : r2(factor > 0 ? unitCost / factor : unitCost);
        if (!fixed) priceInput.value = unitPrice;
        const sub = r2(unitPrice * q);
        net += sub; cost += unitCost * q;
        setHtml($('[data-item-sum]', block), html`Costo u. ${money(unitCost)} · Precio u. <strong>${money(unitPrice)}</strong> · Subtotal <strong>${money(sub)}</strong>
            ${unitPrice < unitCost ? html` <span class="badge bad">Bajo costo</span>` : ''}`);
    }
    net = r2(net);
    const vat = r2(net * vatRate / 100);
    setHtml($('[data-totals]', form), html`<span>Costo total</span><span class="right">${money(cost)}</span>
        <span>Ganancia</span><span class="right">${money(net - cost)}</span>
        <span>Margen s/ venta</span><span class="right">${net ? `${num((net - cost) / net * 100, 1)} %` : '-'}</span>
        <span>Subtotal</span><span class="right">${money(net)}</span><span>IVA ${vatRate}%</span><span class="right">${money(vat)}</span>
        <span class="grand">Total</span><span class="right grand">${money(net + vat)}</span>`);
}

async function editor(ctx, id) {
    const [q, clients, products, rates, sectors, company] = await Promise.all([
        id ? api.get(`/quotes/${id}`) : null,
        api.get('/clients', { active: 'true', limit: 2000 }),
        ctx.can('quotes:write') ? api.get('/products', { active: 'true', limit: 2000 }) : [],
        api.get('/labor-rates', { active: 'true' }).catch(() => []),
        api.get('/sectors').catch(() => []),
        api.get('/settings/company').catch(() => ({ settings: {} })),
    ]);
    const cat = { products, rates, sectors };
    const editable = ctx.can('quotes:write') && (!q || ['Borrador', 'Enviado', 'Rechazado'].includes(q.status));
    ctx.setTitle(q ? `Presupuesto ${q.number}` : 'Nuevo presupuesto');
    if (q && !editable) return detail(ctx, q);

    const d = q || { invoiceType: company.settings.ivaCondition === 'RI' ? 'A' : 'C', vatRate: 21, marginPct: 40, validUntil: addDays(company.settings.quoteValidityDays || 15), items: [{ quantity: 1 }] };
    ctx.setActions(html`${q ? html`<a class="btn" href="/api/quotes/${q._id}/pdf" target="_blank" rel="noopener">PDF</a>` : ''}<a class="btn" href="#/quotes">Volver</a>`);
    setHtml(ctx.root, html`<form id="quoteForm">
        ${q ? html`<div class="card row between"><div>${badge(q.status)} <span class="muted small">Creado ${dmy(q.issueDate)} por ${q.createdBy?.name || ''}</span></div>
            <div class="row" data-status-actions>${statusButtons(ctx, q)}</div></div>` : ''}
        ${d.requestDetails ? html`<div class="alert info"><strong>Pedido del cliente:</strong> ${d.requestDetails}</div>` : ''}
        <div class="card"><div class="grid cols-3">
            <div class="field"><label>Cliente *</label><select name="client" required>${options(clients, q?.client?._id, { empty: 'Elegí un cliente' })}</select></div>
            <div class="field"><label>Atención (contacto)</label><input name="contact" list="contactsList" maxlength="120" value="${d.contact || ''}"><datalist id="contactsList"></datalist></div>
            <div class="field"><label>Título / obra</label><input name="title" maxlength="200" value="${d.title || ''}"></div>
            <div class="field"><label>Tipo de factura</label><select name="invoiceType">${options(['A', 'B', 'C'], d.invoiceType)}</select></div>
            <div class="field"><label>IVA %</label><select name="vatRate" data-type="number">${options(['21', '10.5', '27', '0'], String(d.vatRate))}</select></div>
            <div class="field"><label>Margen % (sobre venta)</label><input name="marginPct" type="number" step="0.1" min="0" max="99.9" data-type="number" value="${d.marginPct ?? 40}"></div>
            <div class="field"><label>Válido hasta *</label><input name="validUntil" type="date" required value="${ymd(d.validUntil)}" min="${ymd(new Date())}"></div>
            <div class="field"><label>Plazo de entrega (días hábiles)</label><input name="deliveryDays" type="number" min="0" data-type="number" value="${d.deliveryDays ?? ''}"></div>
            <div class="field"><label>Forma de pago</label><input name="paymentTerms" maxlength="300" value="${d.paymentTerms || '50% anticipo, saldo contra entrega'}"></div>
        </div><div class="field"><label>Notas</label><textarea name="notes" maxlength="3000">${d.notes || ''}</textarea></div></div>
        <div data-items>${d.items.map(it => itemBlock(it, cat))}</div>
        <div class="row between card"><button type="button" data-add-item>+ Agregar ítem</button><div class="totals" data-totals></div></div>
        <div class="row end"><button class="primary" type="submit">${q ? 'Guardar cambios' : 'Crear presupuesto'}</button></div>
    </form>
    ${q ? history(q) : ''}`);

    ctx.root.insertAdjacentHTML('beforeend', String(aiPhotoBlock()) + String(attachmentsBlock('presupuesto')));
    installPreviewHandlers();
    const form = $('#quoteForm');
    const fillContacts = () => {
        const c = clients.find(x => x._id === form.client.value);
        setHtml($('#contactsList'), (c?.contacts || []).map(x => html`<option value="${x.name}">${x.position}</option>`));
    };
    fillContacts();
    recalc(form);

    ctx.root.oninput = (e) => { if (e.target.closest('#quoteForm')) recalc(form); };
    ctx.root.onchange = (e) => {
        const t = e.target;
        if (t.name === 'client') {
            fillContacts();
            // Al elegir el cliente, trae su contacto (el que recibe facturas, o el primero).
            const c = clients.find(x => x._id === form.client.value);
            form.contact.value = (c?.contacts || []).find(x => x.receivesInvoices)?.name || c?.contacts?.[0]?.name || '';
        }
        if (t.name === 'product' && t.value) {
            const p = products.find(x => x._id === t.value); const tr = t.closest('tr');
            $('[name=name]', tr).value = p.name; $('[name=unit]', tr).value = p.unit; $('[name=unitCost]', tr).value = p.cost;
        }
        if (t.name === 'laborRate' && t.value) {
            const r = rates.find(x => x._id === t.value); const tr = t.closest('tr');
            $('[name=name]', tr).value = r.name; $('[name=unitCost]', tr).value = r.cost;
            if (r.sector) $('[name=sector]', tr).value = r.sector;
        }
        recalc(form);
    };
    ctx.root.onclick = async (e) => {
        const t = e.target;
        if (t.closest('[data-add-item]')) { $('[data-items]').insertAdjacentHTML('beforeend', String(itemBlock({ quantity: 1, marginPct: 40 }, cat))); recalc(form); }
        if (t.closest('[data-del-item]')) { if ($$('[data-item]').length > 1) t.closest('[data-item]').remove(); else toast('El presupuesto necesita al menos un ítem.'); recalc(form); }
        if (t.closest('[data-add-mat]')) { $('[data-mats]', t.closest('[data-item]')).insertAdjacentHTML('beforeend', String(materialRow({}, products))); recalc(form); }
        if (t.closest('[data-add-lab]')) { $('[data-labs]', t.closest('[data-item]')).insertAdjacentHTML('beforeend', String(laborRow({}, rates, sectors))); recalc(form); }
        if (t.closest('[data-del-line]')) { t.closest('tr').remove(); recalc(form); }
        if (q) await handleStatusClick(e, ctx, q);
    };
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const head = readForm({ elements: $$('.card [name]', form).filter(el => !el.closest('[data-item]')) });
        const body = { ...head, vatRate: Number(head.vatRate), marginPct: Number(head.marginPct) || 0, items: readItems(form) };
        if (!body.deliveryDays && body.deliveryDays !== 0) body.deliveryDays = null;
        await withBusy(e.submitter, async () => {
            const saved = q ? await api.put(`/quotes/${q._id}`, body) : await api.post('/quotes', body);
            toast(`Presupuesto ${saved.number} guardado. Total ${money(saved.total)}`, 'ok');
            if (q) ctx.reload(); else ctx.navigate(`#/quotes/${saved._id}`);
        });
    };
}

function statusButtons(ctx, q) {
    const b = [];
    if (q.status === 'Oportunidad') {
        if (ctx.can('quotes:write')) b.push(html`<button type="button" class="primary" data-take>Tomar y armar presupuesto</button>`);
        if (ctx.can('quotes:write') || ctx.can('opportunities:create')) b.push(html`<button type="button" class="danger" data-st="Baja">Descartar</button>`);
        return b;
    }
    if (ctx.can('quotes:write')) {
        if (q.status === 'Borrador') b.push(html`<button type="button" data-st="Enviado">Marcar enviado</button>`);
        if (q.status === 'Enviado') b.push(html`<button type="button" data-st="Rechazado">Rechazado por el cliente</button>`);
        if (['Borrador', 'Enviado', 'Vencido'].includes(q.status)) b.push(html`<button type="button" data-extend>Extender vigencia</button>`);
        if (!['Aprobado', 'Baja'].includes(q.status)) b.push(html`<button type="button" class="danger" data-st="Baja">Dar de baja</button>`);
        b.push(html`<button type="button" data-duplicate>Duplicar</button>`);
    }
    if (ctx.can('quotes:approve') && ['Borrador', 'Enviado'].includes(q.status)) b.push(html`<button type="button" class="primary" data-approve>Aprobar y generar OT</button>`);
    return b;
}

async function handleStatusClick(e, ctx, q) {
    const t = e.target;
    if (t.closest('[data-take]')) {
        await withBusy(t.closest('[data-take]'), async () => {
            try { await api.post(`/quotes/${q._id}/take`); toast('Oportunidad tomada. Armá el presupuesto.', 'ok'); ctx.reload(); }
            catch (err) { showError(err); }
        });
        return;
    }
    const st = t.closest('[data-st]')?.dataset.st;
    if (st) {
        const needs = ['Rechazado', 'Baja'].includes(st);
        const reason = await confirmDialog(`¿Pasar ${q.number} a "${st}"?`, { input: needs ? 'Motivo' : undefined, danger: st === 'Baja' });
        if (!reason) return;
        await withBusy(t, async () => { await api.post(`/quotes/${q._id}/status`, { status: st, reason: needs ? reason : '' }); toast('Estado actualizado.', 'ok'); ctx.reload(); });
    }
    if (t.closest('[data-extend]')) {
        const m = modal({
            title: 'Extender vigencia', body: html`<form id="extForm"><div class="field"><label>Nueva fecha de vigencia</label><input type="date" name="validUntil" required min="${ymd(new Date())}" value="${addDays(15)}"></div></form>`,
            footer: html`<button type="button" data-close>Cancelar</button><button class="primary" form="extForm">Guardar</button>`,
        });
        m.el.querySelector('form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            try { await api.post(`/quotes/${q._id}/extend`, readForm(ev.target)); m.close(); toast('Vigencia extendida.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
        });
    }
    if (t.closest('[data-duplicate]')) await withBusy(t, async () => { const c = await api.post(`/quotes/${q._id}/duplicate`); toast(`Copia creada: ${c.number}`, 'ok'); ctx.navigate(`#/quotes/${c._id}`); });
    if (t.closest('[data-approve]')) approveDialog(ctx, q);
}

async function approveDialog(ctx, q) {
    const review = await api.get(`/quotes/${q._id}/review`);
    const dueDefault = addDays(Math.max(1, Math.round((q.deliveryDays || 10) * 1.4)));
    const m = modal({
        title: `Aprobar ${q.number}`,
        body: html`${review.errors.length ? html`<div class="alert bad"><strong>No se puede aprobar todavía:</strong><ul>${review.errors.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
            ${review.warnings.length ? html`<div class="alert warn"><strong>Revisá estos avisos:</strong><ul>${review.warnings.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
            ${!review.errors.length && !review.warnings.length ? html`<div class="alert ok">Costos y precios verificados.</div>` : ''}
            <form id="approveForm"><div class="grid cols-2">
            <div class="field"><label>Fecha de entrega comprometida *</label><input type="date" name="dueDate" required min="${ymd(new Date())}" value="${dueDefault}"></div>
            <div class="field"><label>Prioridad</label><select name="priority">${options(['Normal', 'Alta', 'Urgente'], 'Normal')}</select></div>
            <label class="check"><input type="checkbox" name="needsDesign"> Requiere diseño previo</label>
            <label class="check"><input type="checkbox" name="needsInstallation" data-inst> Lleva colocación</label>
            <label class="check"><input type="checkbox" name="preProduction" checked> Pre-producción (relevamiento, planos, pedidos y control de presupuesto)</label>
            </div><div class="field" data-addr><label>Dirección de colocación</label><input name="installationAddress" maxlength="300" value="${q.client?.address || ''}"></div>
            ${review.warnings.length ? html`<label class="check"><input type="checkbox" name="acceptWarnings" required> Leí los avisos y apruebo igual</label>` : ''}</form>`,
        footer: html`<button type="button" data-close>Cancelar</button><button class="primary" form="approveForm" ${review.errors.length ? raw('disabled') : ''}>Aprobar y crear OT</button>`,
    });
    m.el.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await withBusy(ev.submitter, async () => {
            const r = await api.post(`/quotes/${q._id}/approve`, readForm(ev.target));
            m.close();
            toast(`Aprobado. Se creó ${r.workOrder.number}${r.preProductionTasks ? ' en pre-producción (4 tareas)' : ` con ${r.tasksCreated} tarea(s)`}.`, 'ok');
            ctx.navigate(`#/workorders/${r.workOrder._id}`);
        });
    });
}

function detail(ctx, q) {
    ctx.setActions(html`<a class="btn" href="/api/quotes/${q._id}/pdf" target="_blank" rel="noopener">PDF</a>
        ${q.workOrder ? html`<a class="btn primary" href="#/workorders/${q.workOrder._id}">Ver ${q.workOrder.number}</a>` : ''}<a class="btn" href="#/quotes">Volver</a>`);
    setHtml(ctx.root, html`<div class="card row between"><div>${badge(q.status)} <strong>${q.clientName}</strong> · ${q.title}</div>
        <div class="row">${statusButtons(ctx, q)}</div></div>
        ${q.requestDetails ? html`<div class="card"><h2>Pedido del cliente</h2><p>${q.requestDetails}</p>${q.createdBy ? html`<p class="small muted">Cargado por ${q.createdBy.name || ''}</p>` : ''}</div>` : ''}
        ${q.rejectionReason ? html`<div class="alert bad">Motivo: ${q.rejectionReason}</div>` : ''}
        ${q.approval?.approvedAt ? html`<div class="alert ok">Aprobado el ${dmyhm(q.approval.approvedAt)} por ${q.approval.approvedBy?.name || ''}.
            ${q.approval.warnings?.length ? html`<ul>${q.approval.warnings.map(w => html`<li>${w}</li>`)}</ul>` : ''}</div>` : ''}
        <div class="card"><div class="grid cols-4">
            <div><label>Emisión</label>${dmy(q.issueDate)}</div><div><label>Vigencia</label>${dmy(q.validUntil)}</div>
            <div><label>Factura</label>${q.invoiceType} · IVA ${q.vatRate}%</div><div><label>Entrega</label>${q.deliveryDays ? `${q.deliveryDays} días` : '-'}</div></div></div>
        ${q.items.length ? html`<div class="table-wrap"><table><thead><tr><th>Ítem</th><th class="num">Cant.</th><th class="num">Costo u.</th><th class="num">Margen</th><th class="num">Precio u.</th><th class="num">Subtotal</th></tr></thead>
        <tbody>${q.items.map(i => html`<tr><td><strong>${i.description}</strong><div class="small muted">
            ${i.materials.map(m => `${m.name} ${num(m.quantity)} ${m.unit}`).join(' · ')}${i.labor.length ? ' · ' : ''}${i.labor.map(l => `${l.name} ${num(l.quantity)}`).join(' · ')}</div></td>
            <td class="num">${num(i.quantity)}</td><td class="num">${money(i.unitCost)}</td><td class="num">${i.priceOverride ? 'fijo' : '—'}</td>
            <td class="num">${money(i.unitPrice)}</td><td class="num">${money(i.subtotal)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="5" class="right">Costo total</td><td class="num">${money(q.totalCost)}</td></tr>
        <tr><td colspan="5" class="right">Ganancia (margen ${num(q.marginPct ?? 0, 1)}% s/ venta)</td><td class="num">${money(q.net - q.totalCost)}</td></tr>
        <tr><td colspan="5" class="right">Subtotal</td><td class="num">${money(q.net)}</td></tr><tr><td colspan="5" class="right">IVA</td><td class="num">${money(q.vat)}</td></tr>
        <tr><td colspan="5" class="right">Total</td><td class="num">${money(q.total)}</td></tr></tfoot></table></div>` : ''}
        ${history(q)}`);
    ctx.root.onclick = (e) => handleStatusClick(e, ctx, q);
}

const history = (q) => html`<div class="card mt"><h2>Historial</h2><ul class="timeline">${[...q.history].reverse().map(h => html`<li><span class="when">${dmyhm(h.date)}</span>${h.userName ? html`<strong>${h.userName}</strong>: ` : ''}${h.action}</li>`)}</ul></div>`;
