// Colocaciones: agenda, programación con equipo, fotos y cierre.
import { api } from '../api.js';
import { html, raw, setHtml, $, modal, toast, showError, readForm, options, dmy, dmyhm, ymd, addDays, badge, confirmDialog, withBusy } from '../dom.js';
import { attachmentsBlock, installPreviewHandlers } from './preview-widgets.js';

export async function render(ctx) {
    if (ctx.params[0] === 'new') return programForm(ctx, ctx.params[1]);
    if (ctx.params[0]) return detail(ctx, ctx.params[0]);
    ctx.setTitle(ctx.can('installations:read') ? 'Colocaciones' : 'Mis colocaciones');
    setHtml(ctx.root, html`<div class="filters"><label class="mb0">Desde</label><input type="date" data-from value="${addDays(-7)}">
        <label class="mb0">Hasta</label><input type="date" data-to value="${addDays(30)}">
        <select data-status>${options(['Programada', 'En proceso', 'Realizada', 'Cancelada'], 'Programada', { empty: 'Todas' })}</select></div><div data-list></div>`);
    const load = async () => {
        const list = await api.get('/installations', { from: $('[data-from]', ctx.root).value, to: `${$('[data-to]', ctx.root).value}T23:59:59`, status: $('[data-status]', ctx.root).value });
        const byDay = new Map();
        for (const i of list) { const k = ymd(i.date); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(i); }
        setHtml($('[data-list]', ctx.root), byDay.size ? [...byDay.entries()].map(([day, items]) => html`<div class="card"><h2>${new Date(`${day}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <div class="table-wrap"><table><tbody>${items.map(i => html`<tr class="clickable" data-id="${i._id}"><td class="nowrap">${i.timeSlot || ''}</td><td><strong>${i.workOrderNumber}</strong> · ${i.clientName}</td>
            <td>${i.address}</td><td>${i.team.map(u => u.name).join(', ') || html`<span class="badge warn">Sin equipo</span>`}</td><td>${badge(i.status)}</td><td>${i.photos.length} foto(s)</td></tr>`)}</tbody></table></div></div>`)
            : html`<div class="card muted">No hay colocaciones en el período.</div>`);
    };
    ctx.root.onchange = load;
    ctx.root.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) ctx.navigate(`#/installations/${tr.dataset.id}`); };
    await load();
}

async function programForm(ctx, woId) {
    const [w, users] = await Promise.all([api.get(`/workorders/${woId}`), api.get('/users/installers').catch(() => [])]);
    ctx.setTitle(`Programar colocación · ${w.number}`);
    ctx.setActions(html`<a class="btn" href="#/workorders/${woId}">Volver</a>`);
    const installers = users;
    const contact = w.client?.contacts?.[0];
    setHtml(ctx.root, html`<form class="card" id="instForm"><div class="grid cols-3">
        <div class="field"><label>Fecha *</label><input type="date" name="date" required min="${ymd(new Date())}" value="${addDays(1)}"></div>
        <div class="field"><label>Horario</label><input name="timeSlot" placeholder="ej: 8 a 12 hs" maxlength="40"></div>
        <div class="field"><label>Vehículo</label><input name="vehicle" maxlength="60"></div>
        <div class="field"><label>Dirección *</label><input name="address" required minlength="3" maxlength="300" value="${w.installationAddress || w.client?.address || ''}"></div>
        <div class="field"><label>Contacto en obra</label><input name="contactName" maxlength="120" value="${contact?.name || ''}"></div>
        <div class="field"><label>Teléfono</label><input name="contactPhone" maxlength="60" value="${contact?.phone || w.client?.phone || ''}"></div></div>
        <div class="field"><label>Equipo (Ctrl/Cmd para elegir varios)</label>${installers.length
        ? html`<select name="team" multiple size="6">${options(installers, '', { label: u => `${u.name} · ${u.role?.label || ''}` })}</select>`
        : html`<p class="small muted">No hay usuarios con rol de colocación.</p>`}</div>
        <div class="field"><label>Indicaciones</label><textarea name="instructions" maxlength="2000"></textarea></div>
        <div class="row end"><button class="primary">Programar</button></div></form>`);
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const body = { ...readForm(e.target), workOrder: woId };
        if (!body.team) body.team = [];
        await withBusy(e.submitter, async () => { const i = await api.post('/installations', body); toast('Colocación programada.', 'ok'); ctx.navigate(`#/installations/${i._id}`); });
    };
}

async function detail(ctx, id) {
    const i = await api.get(`/installations/${id}`);
    ctx.setTitle(`Colocación · ${i.workOrderNumber}`);
    ctx.setActions(html`${ctx.can('workorders:read') ? html`<a class="btn" href="#/workorders/${i.workOrder}">Ver OT</a>` : ''}<a class="btn" href="#/installations">Volver</a>`);
    const open = ['Programada', 'En proceso'].includes(i.status);
    const writable = ctx.can('installations:write');
    setHtml(ctx.root, html`<div class="grid cols-2"><div class="card"><div class="row between"><h2 class="mb0">${i.clientName}</h2>${badge(i.status)}</div>
        <p><strong>${dmy(i.date)} ${i.timeSlot}</strong><br>${i.address}<br>Contacto: ${i.contactName} ${i.contactPhone}
        <br>Equipo: ${i.team.map(u => u.name).join(', ') || '-'}${i.vehicle ? ` · Vehículo: ${i.vehicle}` : ''}${i.startedAt ? html`<br>Tomada: ${dmyhm(i.startedAt)}` : ''}</p>
        ${i.instructions ? html`<div class="alert info">${i.instructions}</div>` : ''}${i.result ? html`<p><strong>Resultado:</strong> ${i.result}</p>` : ''}
        ${writable && i.status === 'Programada' ? html`<div class="row mt"><button class="primary" data-take>Tomar</button><button data-close-as="Reprogramada">Reprogramar</button>
            <button class="danger" data-close-as="Cancelada">Cancelar</button></div>
            <p class="muted small mt">"Tomar" se habilita cuando la OT está en Colocación (producción y calidad terminadas).</p>` : ''}
        ${writable && i.status === 'En proceso' ? html`<div class="row mt"><button class="primary" data-close-as="Realizada">Marcar realizada</button><button data-close-as="Reprogramada">Reprogramar</button>
            <button class="danger" data-close-as="Cancelada">Cancelar</button></div>` : ''}</div>
        <div class="card"><h2>Historial</h2><ul class="timeline">${[...i.history].reverse().map(h => html`<li><span class="when">${dmyhm(h.date)}</span>${h.userName}: ${h.action}</li>`)}</ul></div></div>
        <div class="card"><div class="row between"><h2 class="mb0">Fotos (${i.photos.length})</h2>
        ${open && writable ? html`<form class="row" id="photoForm"><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required capture="environment"><button class="primary">Subir</button></form>` : ''}</div>
        <div class="photos mt">${i.photos.map(p => html`<figure><a href="/api/installations/${i._id}/photos/${p._id}" target="_blank" rel="noopener"><img src="/api/installations/${i._id}/photos/${p._id}" alt="${p.originalName}" loading="lazy"></a>
        <figcaption><span>${dmy(p.uploadedAt)}</span>${open && writable ? html`<button type="button" class="link small" data-del-photo="${p._id}">borrar</button>` : ''}</figcaption></figure>`)}</div></div>`);

    ctx.root.insertAdjacentHTML('beforeend', String(attachmentsBlock('colocación')));
    installPreviewHandlers();
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        await withBusy(e.submitter, async () => { await api.upload(`/installations/${id}/photos`, new FormData(e.target)); toast('Fotos subidas.', 'ok'); ctx.reload(); });
    };
    ctx.root.onclick = async (e) => {
        const del = e.target.closest('[data-del-photo]');
        if (del && await confirmDialog('¿Borrar la foto?', { danger: true })) {
            try { await api.del(`/installations/${id}/photos/${del.dataset.delPhoto}`); ctx.reload(); } catch (err) { showError(err); }
        }
        if (e.target.closest('[data-take]')) {
            await withBusy(e.target.closest('[data-take]'), async () => {
                try { await api.post(`/installations/${id}/start`); toast('Colocación tomada. Quedó registrado el inicio.', 'ok'); ctx.reload(); }
                catch (err) { showError(err); }
            });
            return;
        }
        const st = e.target.closest('[data-close-as]')?.dataset.closeAs;
        if (!st) return;
        const m = modal({
            title: st === 'Realizada' ? 'Cerrar colocación' : st,
            body: html`<form id="closeForm">${st === 'Reprogramada' ? html`<div class="field"><label>Nueva fecha</label><input type="date" name="newDate" required min="${ymd(new Date())}"></div>` : ''}
                <div class="field"><label>${st === 'Realizada' ? 'Comentario del trabajo realizado' : 'Motivo'}</label><textarea name="result" ${st !== 'Realizada' ? raw('required') : ''} maxlength="2000"></textarea></div>
                ${st === 'Realizada' && !i.photos.length ? html`<div class="alert warn">Primero subí al menos una foto del trabajo terminado.</div>` : ''}</form>`,
            footer: html`<button type="button" data-close>Volver</button><button class="primary" form="closeForm">Confirmar</button>`,
        });
        m.el.querySelector('form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            await withBusy(ev.submitter, async () => {
                const r = await api.post(`/installations/${id}/close`, { status: st, ...readForm(ev.target) });
                m.close();
                toast(r.warning || 'Colocación actualizada.', r.warning ? '' : 'ok');
                ctx.reload();
            });
        });
    };
}
