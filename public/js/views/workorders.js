// Órdenes de trabajo: semáforo, detalle con tareas, materiales, calidad,
// colocaciones, facturación, costos reales e historial.
import { api } from '../api.js';
import { html, raw, setHtml, $, $$, modal, toast, showError, readForm, options, money, num, dmy, dmyhm, ymd, badge, light, confirmDialog, withBusy, durHuman } from '../dom.js';
import { attachmentsBlock, installPreviewHandlers } from './preview-widgets.js';

const STATUSES = ['Pendiente', 'Diseño', 'Producción', 'Calidad', 'Colocación', 'Lista para entrega', 'Entregada', 'Baja'];
const LIGHTS = { 'en-termino': 'En término', proxima: 'Vence pronto', vencida: 'Vencidas' };

// Puede ver importes solo quien tiene algún permiso financiero (dueños/comercial/cobranzas).
const seesMoney = (ctx) => ctx.can('quotes:read') || ctx.can('invoices:read') || ctx.can('payments:read');

export async function render(ctx) {
    if (ctx.params[0]) return detail(ctx, ctx.params[0]);
    ctx.setTitle('Órdenes de trabajo');
    const canMoney = seesMoney(ctx);
    setHtml(ctx.root, html`<div class="filters"><input type="search" placeholder="OT, cliente, presupuesto…" data-q>
        <select data-status>${options(['activas', ...STATUSES], 'activas', { empty: 'Todas', label: s => (s === 'activas' ? 'Activas' : s) })}</select>
        <select data-light>${options(Object.keys(LIGHTS), '', { empty: 'Cualquier vencimiento', label: k => LIGHTS[k] })}</select></div><div data-list></div>`);
    const load = async () => {
        const list = await api.get('/workorders', { q: $('[data-q]', ctx.root).value, status: $('[data-status]', ctx.root).value, light: $('[data-light]', ctx.root).value });
        setHtml($('[data-list]', ctx.root), html`<div class="table-wrap"><table><thead><tr><th>OT</th><th>Cliente</th><th>Título</th><th>Estado</th><th>Entrega</th><th>Semáforo</th>
            <th>Avance</th>${canMoney ? html`<th>Facturación</th><th class="num">Total</th>` : ''}</tr></thead><tbody>
            ${list.length ? list.map(w => html`<tr class="clickable" data-id="${w._id}"><td class="nowrap"><strong>${w.number}</strong>${w.priority !== 'Normal' ? html` <span class="badge bad">${w.priority}</span>` : ''}</td>
            <td>${w.clientName}</td><td>${w.title}</td><td>${badge(w.status)}</td><td class="nowrap">${dmy(w.dueDate)}${w.reschedules?.length ? html` <span class="badge warn" title="Reprogramada">R${w.reschedules.length}</span>` : ''}</td>
            <td>${light(w.light)}</td><td><progress class="progress" max="100" value="${w.progress}"></progress></td>${canMoney ? html`<td>${badge(w.billing?.status)}</td><td class="num">${money(w.total)}</td>` : ''}</tr>`)
            : html`<tr><td colspan="${canMoney ? 9 : 7}" class="muted">Sin órdenes.</td></tr>`}</tbody></table></div>`);
    };
    let t;
    ctx.root.oninput = (e) => { if (e.target.matches('[data-q]')) { clearTimeout(t); t = setTimeout(load, 250); } };
    ctx.root.onchange = load;
    ctx.root.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate(`#/workorders/${tr.dataset.id}`); };
    await load();
}

async function detail(ctx, id) {
    const w = await api.get(`/workorders/${id}`);
    ctx.setTitle(`${w.number} · ${w.clientName}`);
    const closed = ['Entregada', 'Baja'].includes(w.status);
    const canMoney = seesMoney(ctx);
    ctx.setActions(html`
        ${ctx.can('invoices:issue') && w.status !== 'Baja' && w.billing?.status !== 'Facturada' ? html`<a class="btn primary" href="#/invoices/new/${w._id}">Facturar</a>` : ''}
        ${ctx.can('payments:write') && w.status !== 'Baja' ? html`<a class="btn" href="#/payments/advance/${w._id}">Registrar anticipo</a>` : ''}
        <a class="btn" href="#/quotes/${w.quote}">Ver ${w.quoteNumber}</a><a class="btn" href="#/workorders">Volver</a>`);

    const nextStatuses = STATUSES.filter(s => s !== 'Baja' && s !== w.status && (s !== 'Colocación' || w.needsInstallation));
    setHtml(ctx.root, html`
        ${w.status === 'Baja' ? html`<div class="alert bad">Dada de baja el ${dmy(w.cancellation?.date)} por ${w.cancellation?.userName}: ${w.cancellation?.reason}</div>` : ''}
        <div class="grid cols-4">
            <div class="kpi"><div class="label">Estado</div><div class="value">${badge(w.status)}</div><div class="sub">${light(w.light)}</div></div>
            <div class="kpi"><div class="label">Entrega comprometida</div><div class="value">${dmy(w.dueDate)}</div>
                <div class="sub">${closed ? (w.deliveredAt ? `Entregada ${dmy(w.deliveredAt)}` : '') : `${w.daysLeft} día(s)`}${w.reschedules.length ? ` · original ${dmy(w.originalDueDate)}` : ''}</div></div>
            <div class="kpi"><div class="label">Avance producción</div><div class="value">${w.progress}%</div><progress class="progress" max="100" value="${w.progress}"></progress></div>
            ${canMoney ? html`<div class="kpi"><div class="label">Total OT</div><div class="value">${money(w.total)}</div>
                <div class="sub">Facturado ${money(w.billing.invoiced)} · Cobrado ${money(w.collected)}${w.advances ? ` · Anticipos ${money(w.advances)}` : ''}</div></div>` : ''}
        </div>
        ${!closed && ctx.can('workorders:write') ? html`<div class="card row mt">
            <form class="row" data-form="status"><label class="mb0">Pasar a</label><select name="status">${options(nextStatuses, '')}</select>
            <input name="note" placeholder="Nota (opcional)" maxlength="500"><button class="primary">Cambiar estado</button></form>
            <span class="spacer"></span><button type="button" data-reschedule>Reprogramar</button><button type="button" data-edit>Editar datos</button>
            ${ctx.can('workorders:baja') ? html`<button type="button" class="danger" data-cancel>Dar de baja</button>` : ''}</div>` : ''}
        <div class="tabs" data-tabs>${['Resumen', 'Producción', 'Materiales y costos', 'Calidad', 'Colocación', 'Facturación', 'Historial'].map((t, i) => html`<button type="button" data-tab="${i}" class="${i === 0 ? 'active' : ''}${(i === 5 && !canMoney) ? ' hidden' : ''}">${t}</button>`)}</div>
        <div data-panel="0">${summaryPanel(w, canMoney)}</div>
        <div data-panel="1" class="hidden">${tasksPanel(w)}</div>
        <div data-panel="2" class="hidden">${costsPanel(w, ctx, canMoney)}</div>
        <div data-panel="3" class="hidden">${qualityPanel(w, ctx)}</div>
        <div data-panel="4" class="hidden">${installPanel(w, ctx)}</div>
        <div data-panel="5" class="hidden">${canMoney ? billingPanel(w) : ''}</div>
        <div data-panel="6" class="hidden"><ul class="timeline">${[...w.history].reverse().map(h => html`<li><span class="when">${dmyhm(h.date)}</span><strong>${h.userName || ''}</strong> ${h.action}</li>`)}</ul></div>`);

    ctx.root.insertAdjacentHTML('beforeend', String(attachmentsBlock('OT')));
    installPreviewHandlers();
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        if (f.dataset.form === 'status') {
            await withBusy(e.submitter, async () => { await api.post(`/workorders/${id}/status`, readForm(f)); toast('Estado actualizado.', 'ok'); ctx.reload(); });
        }
        if (f.dataset.form === 'consume') {
            const lines = $$('[data-cons]', f).map(tr => ({ product: $('[name=product]', tr).value, quantity: Number($('[name=quantity]', tr).value) })).filter(l => l.product && l.quantity > 0);
            if (!lines.length) { toast('Cargá al menos un insumo con cantidad.'); return; }
            await withBusy(e.submitter, async () => {
                const r = await api.post(`/workorders/${id}/consume`, { lines });
                $('[data-cons-body]', f).innerHTML = ''; // evita reenviar el mismo consumo si se vuelve a tocar antes de recargar
                toast(r.warnings.length ? r.warnings.join(' ') : 'Consumo registrado.', r.warnings.length ? '' : 'ok');
                ctx.reload();
            });
        }
    };
    ctx.root.onclick = async (e) => {
        const t = e.target;
        const tab = t.closest('[data-tab]');
        if (tab) {
            $$('[data-tab]', ctx.root).forEach(b => b.classList.toggle('active', b === tab));
            $$('[data-panel]', ctx.root).forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
        }
        if (t.closest('[data-reschedule]')) reschedule(ctx, w);
        if (t.closest('[data-edit]')) editData(ctx, w);
        const take = t.closest('[data-start-install]');
        if (take) {
            await withBusy(take, async () => {
                try { await api.post(`/installations/${take.dataset.startInstall}/start`); toast('Colocación tomada. Quedó registrado el inicio.', 'ok'); ctx.reload(); }
                catch (err) { showError(err); }
            });
        }
        if (t.closest('[data-cancel]')) {
            const reason = await confirmDialog(`¿Dar de baja ${w.number}? Se cancelan tareas y colocaciones pendientes.`, { input: 'Motivo de la baja', danger: true, okText: 'Dar de baja' });
            if (reason) await withBusy(t, async () => { await api.post(`/workorders/${id}/cancel`, { reason }); toast('OT dada de baja.', 'ok'); ctx.reload(); });
        }
        if (t.closest('[data-add-cons]')) {
            const products = await api.get('/products', { active: 'true', limit: 2000 });
            $('[data-cons-body]', ctx.root).insertAdjacentHTML('beforeend', consRowHtml(products));
        }
        const plan = t.closest('[data-plan]');
        if (plan) {
            const products = await api.get('/products', { active: 'true', limit: 2000 });
            $('[data-cons-body]', ctx.root).insertAdjacentHTML('beforeend', consRowHtml(products, plan.dataset.plan, plan.dataset.qty));
            toast('Insumo agregado al consumo. Revisá la cantidad y registrá.', 'ok');
        }
        if (t.closest('[data-load-planned]')) {
            const products = await api.get('/products', { active: 'true', limit: 2000 });
            const body = $('[data-cons-body]', ctx.root);
            body.innerHTML = '';
            for (const m of (w.plannedMaterials || []).filter(x => x.product)) {
                body.insertAdjacentHTML('beforeend', consRowHtml(products, String(m.product), m.quantity));
            }
            toast('Se cargaron los insumos previstos. Revisá las cantidades y registrá.', 'ok');
        }
        if (t.closest('[data-del]')) t.closest('tr').remove();
    };
}

function summaryPanel(w, canMoney = true) {
    return html`<div class="grid cols-2"><div class="card"><h2>Trabajo</h2>
        <div class="table-wrap"><table><thead><tr><th>Ítem</th><th class="num">Cant.</th>${canMoney ? html`<th class="num">Subtotal</th>` : ''}</tr></thead>
        <tbody>${w.items.map(i => html`<tr><td>${i.description}${i.detail ? html`<div class="small muted">${i.detail}</div>` : ''}</td><td class="num">${num(i.quantity)}</td>${canMoney ? html`<td class="num">${money(i.subtotal)}</td>` : ''}</tr>`)}</tbody></table></div>
        ${w.notes ? html`<p class="mt">${w.notes}</p>` : ''}</div>
        <div class="card"><h2>Cliente y entrega</h2>
        <p><strong>${w.client?.name}</strong><br>${w.client?.phone || ''} ${w.client?.email || ''}<br>${(w.client?.contacts || []).map(c => `${c.name}${c.position ? ` (${c.position})` : ''}`).join(', ')}</p>
        <p>Prioridad: <strong>${w.priority}</strong> · Diseño: ${w.needsDesign ? 'Sí' : 'No'} · Colocación: ${w.needsInstallation ? `Sí, ${w.installationAddress || 'sin dirección'}` : 'No'}</p>
        ${w.reschedules.length ? html`<h3>Reprogramaciones</h3><ul class="timeline">${w.reschedules.map(r => html`<li><span class="when">${dmyhm(r.date)}</span>${dmy(r.from)} → ${dmy(r.to)} · ${r.userName}: ${r.reason}</li>`)}</ul>` : ''}
        </div></div>`;
}

function tasksPanel(w) {
    return html`<div class="table-wrap"><table><thead><tr><th>Ítem</th><th>Tarea</th><th>Sector</th><th class="num">Cant.</th><th>Estado</th><th>Responsable</th><th>Inicio</th><th>Fin</th></tr></thead>
        <tbody>${w.tasks.length ? w.tasks.map(t => html`<tr><td>${t.itemDescription}</td><td>${t.description}</td><td>${t.sector?.name || '-'}</td><td class="num">${num(t.quantity)}</td>
        <td>${badge(t.status)}</td><td>${t.assignedUser?.name || ''}</td><td>${dmyhm(t.startedAt)}</td><td>${dmyhm(t.finishedAt)}</td></tr>`)
        : html`<tr><td colspan="8" class="muted">El presupuesto no tenía mano de obra cargada.</td></tr>`}</tbody></table></div>`;
}

// Fila del formulario de consumo; permite preseleccionar insumo y cantidad.
function consRowHtml(products, selected = '', qty = '') {
    return String(html`<tr data-cons><td><select name="product">${options(products.filter(p => !p.isService), selected, { empty: 'Elegí insumo', label: p => `${p.name} (${num(p.stock)} ${p.unit})` })}</select></td>
        <td><input name="quantity" type="number" step="any" min="0" value="${qty}"></td><td><button type="button" class="sm danger" data-del>✕</button></td></tr>`);
}

function costsPanel(w, ctx, canMoney = true) {
    const net = w.net || 0;
    const realMargin = net && w.costs.total ? ((net - w.costs.total) / net * 100) : null;
    return html`${canMoney ? html`<div class="grid cols-3">
        <div class="kpi"><div class="label">Costo previsto (presupuesto)</div><div class="value">${money(w.plannedCost)}</div><div class="sub">Margen previsto ${net ? num((net - w.plannedCost) / net * 100, 1) : '-'}%</div></div>
        <div class="kpi"><div class="label">Costo real cargado</div><div class="value">${money(w.costs.total)}</div><div class="sub">Materiales ${money(w.costs.materials)} · Compras ${money(w.costs.purchases)}</div></div>
        <div class="kpi"><div class="label">Margen real (sobre neto)</div><div class="value">${realMargin === null ? '-' : `${num(realMargin, 1)}%`}</div><div class="sub">Neto ${money(net)}</div></div></div>` : ''}
        <div class="card mt"><h2>Materiales previstos (del presupuesto)</h2>
        <div class="table-wrap"><table><thead><tr><th>Insumo</th><th class="num">Cant. prevista</th>${canMoney ? html`<th class="num">Costo u.</th><th class="num">Total</th>` : ''}<th></th></tr></thead>
        <tbody>${(w.plannedMaterials || []).length ? w.plannedMaterials.map(m => html`<tr><td>${m.name}${m.product ? '' : html` <span class="small muted">(no vinculado al catálogo)</span>`}</td>
        <td class="num">${num(m.quantity)} ${m.unit}</td>${canMoney ? html`<td class="num">${money(m.unitCost)}</td><td class="num">${money(m.total)}</td>` : ''}
        <td class="num">${m.product && ctx.can('materials:consume') && !['Entregada', 'Baja'].includes(w.status) ? html`<button type="button" class="sm" data-plan="${m.product}" data-qty="${m.quantity}">Consumir</button>` : ''}</td></tr>`)
        : html`<tr><td colspan="${canMoney ? 5 : 3}" class="muted">El presupuesto no tenía insumos cargados.</td></tr>`}</tbody></table></div>
        ${(w.plannedMaterials || []).some(m => m.product) && ctx.can('materials:consume') && !['Entregada', 'Baja'].includes(w.status) ? html`<div class="row mt"><button type="button" data-load-planned>Cargar todos al consumo</button></div>` : ''}</div>
        <div class="card mt"><h2>Materiales consumidos del stock</h2>
        <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Insumo</th><th class="num">Cantidad</th>${canMoney ? html`<th class="num">Costo u.</th><th class="num">Total</th>` : ''}</tr></thead>
        <tbody>${w.movements.length ? w.movements.map(m => html`<tr><td>${dmy(m.date)}</td><td>${m.product?.name}</td><td class="num">${num(-m.quantity)} ${m.product?.unit}</td>
        ${canMoney ? html`<td class="num">${money(m.unitCost)}</td><td class="num">${money(-m.quantity * m.unitCost)}</td>` : ''}</tr>`) : html`<tr><td colspan="${canMoney ? 5 : 3}" class="muted">Sin consumos.</td></tr>`}</tbody></table></div>
        ${ctx.can('materials:consume') && !['Entregada', 'Baja'].includes(w.status) ? html`<form data-form="consume" class="mt"><h3>Registrar consumo</h3>
            <table class="lines"><tbody data-cons-body></tbody></table><div class="row mt"><button type="button" data-add-cons>+ Insumo</button><button class="primary">Registrar consumo</button></div></form>` : ''}</div>`;
}

function qualityPanel(w, ctx) {
    return html`${ctx.can('quality:write') && w.status === 'Calidad' ? html`<div class="row mb0"><a class="btn primary" href="#/quality/check/${w._id}">Hacer control de calidad</a></div>` : ''}
        ${w.quality.length ? w.quality.map(c => html`<div class="card mt"><div class="row between"><strong>${c.templateName}</strong><span>${badge(c.result)} ${dmyhm(c.date)} · ${c.inspectorName}</span></div>
        <ul>${c.results.map(r => html`<li>${r.ok ? '✔' : '✘'} ${r.item}${r.note ? html` <em class="muted">— ${r.note}</em>` : ''}</li>`)}</ul>${c.observations ? html`<p>${c.observations}</p>` : ''}
        ${(c.photos || []).length ? html`<div class="qc-photos">${c.photos.map(p => html`<a href="/api/quality/${c._id}/photos/${p._id}" target="_blank" rel="noopener"><img src="/api/quality/${c._id}/photos/${p._id}" alt="Foto de calidad" class="qc-thumb" loading="lazy"></a>`)}</div>` : ''}</div>`)
        : html`<p class="muted mt">Sin controles todavía. La OT necesita un control aprobado para pasar a colocación o entrega.</p>`}`;
}

function installPanel(w, ctx) {
    const canTake = (i) => ctx.can('installations:write') && i.status === 'Programada' && w.status === 'Colocación';
    return html`${circuitTimes(w)}
        ${ctx.can('installations:write') && !['Entregada', 'Baja'].includes(w.status) ? html`<a class="btn primary" href="#/installations/new/${w._id}">Programar colocación</a>` : ''}
        ${w.status !== 'Colocación' && w.installations.some(i => i.status === 'Programada') ? html`<p class="muted small mt">La colocación se puede tomar recién cuando la OT llegue a <strong>Colocación</strong> (producción y calidad terminadas).</p>` : ''}
        ${w.installations.length ? html`<div class="table-wrap mt"><table><thead><tr><th>Fecha</th><th>Dirección</th><th>Equipo</th><th>Estado</th><th>Tomada</th><th>Duración</th><th>Fotos</th><th></th></tr></thead>
        <tbody>${w.installations.map(i => html`<tr><td>${dmy(i.date)} ${i.timeSlot}</td><td>${i.address}</td><td>${i.team.map(u => u.name).join(', ')}</td><td>${badge(i.status)}</td>
        <td>${i.startedAt ? dmyhm(i.startedAt) : '—'}</td><td>${i.startedAt && i.completedAt ? durHuman(i.startedAt, i.completedAt) : (i.startedAt ? 'en curso' : '—')}</td>
        <td><a href="#/installations/${i._id}">${i.photos.length} foto(s)</a></td>
        <td>${canTake(i) ? html`<button type="button" class="sm primary" data-start-install="${i._id}">Tomar</button>` : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="muted mt">Sin colocaciones.</p>`}`;
}

// Tiempos del circuito End-to-End: cuánto tardó producción, cuánto la colocación y el total.
function circuitTimes(w) {
    const lastInst = [...(w.installations || [])].reverse().find(i => i.startedAt);
    const prod = durHuman(w.productionStartedAt, w.productionEndedAt);
    const coloc = lastInst ? durHuman(lastInst.startedAt, lastInst.completedAt) : '—';
    const e2e = w.deliveredAt ? durHuman(w.createdAt, w.deliveredAt) : '—';
    return html`<div class="grid cols-3 mb"><div class="kpi"><div class="label">Producción</div><div class="value">${prod}</div><div class="sub">${w.productionStartedAt ? dmy(w.productionStartedAt) : 'sin iniciar'}</div></div>
        <div class="kpi"><div class="label">Colocación</div><div class="value">${coloc}</div><div class="sub">${lastInst?.startedAt ? (lastInst.completedAt ? 'terminada' : 'en curso') : 'sin tomar'}</div></div>
        <div class="kpi"><div class="label">End-to-End</div><div class="value">${e2e}</div><div class="sub">${w.deliveredAt ? 'desde el alta a la entrega' : 'sin entregar'}</div></div></div>`;
}

function billingPanel(w) {
    return html`<h3>Comprobantes</h3><div class="table-wrap"><table><thead><tr><th>Comprobante</th><th>Fecha</th><th>Estado</th><th class="num">Total</th><th class="num">Imputado a esta OT</th></tr></thead>
        <tbody>${w.invoices.length ? w.invoices.map(i => html`<tr class="clickable"><td><a href="#/invoices/${i._id}">${i.kind} ${String(i.pointOfSale).padStart(5, '0')}-${String(i.number ?? 0).padStart(8, '0')}</a></td>
        <td>${dmy(i.date)}</td><td>${badge(i.status)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.workOrderAmounts.find(x => x.workOrder === w._id)?.amount)}</td></tr>`)
        : html`<tr><td colspan="5" class="muted">Sin facturar.</td></tr>`}</tbody></table></div>
        <h3>Cobros y anticipos</h3><div class="table-wrap"><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Tipo</th><th>Medio</th><th class="num">Importe</th><th class="num">Retenciones</th></tr></thead>
        <tbody>${w.payments.length ? w.payments.map(p => html`<tr><td><a href="/api/payments/${p._id}/pdf" target="_blank" rel="noopener" title="Ver recibo (PDF)">${p.number}</a></td><td>${dmy(p.date)}</td><td>${p.kind}${p.kind === 'anticipo' && !p.invoice ? ' (sin aplicar)' : ''}</td><td>${p.method}</td>
        <td class="num">${money(p.amount)}</td><td class="num">${money(p.totalApplied - p.amount)}</td></tr>`) : html`<tr><td colspan="6" class="muted">Sin cobros directos a esta OT.</td></tr>`}</tbody></table></div>`;
}

function reschedule(ctx, w) {
    const m = modal({
        title: `Reprogramar ${w.number}`,
        body: html`<form id="reForm"><div class="field"><label>Nueva fecha de entrega</label><input type="date" name="dueDate" required min="${ymd(new Date())}" value="${ymd(w.dueDate)}"></div>
            <div class="field"><label>Motivo (queda en el historial)</label><textarea name="reason" required minlength="5" maxlength="500"></textarea></div></form>`,
        footer: html`<button type="button" data-close>Cancelar</button><button class="primary" form="reForm">Reprogramar</button>`,
    });
    m.el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await withBusy(e.submitter, async () => { await api.post(`/workorders/${w._id}/reschedule`, readForm(e.target)); m.close(); toast('OT reprogramada.', 'ok'); ctx.reload(); });
    });
}

function editData(ctx, w) {
    const m = modal({
        title: `Editar ${w.number}`,
        body: html`<form id="edForm"><div class="grid cols-2">
            <div class="field"><label>Prioridad</label><select name="priority">${options(['Normal', 'Alta', 'Urgente'], w.priority)}</select></div><div></div>
            <label class="check"><input type="checkbox" name="needsDesign" ${w.needsDesign ? raw('checked') : ''}> Requiere diseño</label>
            <label class="check"><input type="checkbox" name="needsInstallation" ${w.needsInstallation ? raw('checked') : ''}> Lleva colocación</label></div>
            <div class="field"><label>Dirección de colocación</label><input name="installationAddress" maxlength="300" value="${w.installationAddress}"></div>
            <div class="field"><label>Notas internas</label><textarea name="notes" maxlength="3000">${w.notes}</textarea></div></form>`,
        footer: html`<button type="button" data-close>Cancelar</button><button class="primary" form="edForm">Guardar</button>`,
    });
    m.el.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api.put(`/workorders/${w._id}`, readForm(e.target)); m.close(); toast('Guardado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
    });
}
