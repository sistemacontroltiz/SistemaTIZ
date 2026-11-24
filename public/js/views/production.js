// Tareas de producción: cada operario ve las de su sector, las toma y las finaliza.
import { api } from '../api.js';
import { html, setHtml, $, toast, options, num, dmy, dmyhm, badge, confirmDialog, withBusy } from '../dom.js';

export async function render(ctx) {
    ctx.setTitle('Producción');
    const sectors = ctx.can('production:assign') ? await api.get('/sectors') : [];
    setHtml(ctx.root, html`<div class="filters">
        <select data-status>${options(['Pendiente', 'En progreso', 'Completada'], '', { empty: 'Abiertas (pendientes y en progreso)' })}</select>
        ${sectors.length ? html`<select data-sector>${options(sectors, '', { empty: 'Todos los sectores' })}</select>` : html`<span class="muted small">Sector: ${ctx.user.sector?.name || 'sin sector asignado'}</span>`}
        <label class="check"><input type="checkbox" data-mine> Solo las mías</label></div><div data-list></div>`);

    const load = async () => {
        const status = $('[data-status]', ctx.root).value;
        let list = await api.get('/tasks', { status, sector: $('[data-sector]', ctx.root)?.value, mine: $('[data-mine]', ctx.root).checked ? 'true' : '' });
        if (!status) list = list.filter(t => t.status !== 'Completada');
        list.sort((a, b) => (a.priority === 'Urgente' ? -1 : 0) - (b.priority === 'Urgente' ? -1 : 0) || new Date(a.dueDate) - new Date(b.dueDate));
        // Candado de predecesora: una tarea está bloqueada si su predecesora (en esta lista) no está terminada.
        const byId = new Map(list.map(t => [String(t._id), t]));
        const blocker = (t) => (t.predecessor ? byId.get(String(t.predecessor)) : null);
        const locked = (t) => { const p = blocker(t); return p && p.status !== 'Completada' ? p : null; };
        setHtml($('[data-list]', ctx.root), html`<div class="table-wrap"><table><thead><tr><th>OT</th><th>Cliente</th><th>Ítem</th><th>Tarea</th><th>Sector</th><th class="num">Cant.</th>
            <th>Entrega</th><th>Estado</th><th>Responsable</th><th></th></tr></thead><tbody>
            ${list.length ? list.map(t => html`<tr><td class="nowrap"><a href="#/workorders/${t.workOrder}">${t.workOrderNumber}</a>${t.priority && t.priority !== 'Normal' ? html` <span class="badge bad">${t.priority}</span>` : ''}</td>
                <td>${t.clientName}</td><td>${t.itemDescription}</td><td><strong>${t.description}</strong>${t.kind === 'preprod' ? html` <span class="badge info">Pre-prod</span>` : ''}${locked(t) ? html`<div class="small muted">🔒 espera: ${locked(t).description}</div>` : ''}</td>
                <td>${t.sector?.name || (t.kind === 'preprod' ? 'Pre-producción' : '-')}</td><td class="num">${num(t.quantity)}</td>
                <td class="nowrap">${t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'Completada' ? html`<span class="badge bad">${dmy(t.dueDate)}</span>` : dmy(t.dueDate)}</td><td>${badge(t.status)}</td><td>${t.assignedUser?.name || ''}<div class="small muted">${t.startedAt ? dmyhm(t.startedAt) : ''}</div></td>
                <td class="nowrap right">${actions(ctx, t, locked(t))}</td></tr>`)
            : html`<tr><td colspan="10" class="muted">No hay tareas para mostrar.</td></tr>`}</tbody></table></div>`);
    };
    ctx.root.onchange = load;
    ctx.root.onclick = async (e) => {
        const b = e.target.closest('[data-do]');
        if (!b) return;
        const { do: action, id } = b.dataset;
        if (action === 'revert' && !(await confirmDialog('¿Volver la tarea a "Pendiente"?'))) return;
        await withBusy(b, async () => {
            const r = await api.post(`/tasks/${id}/${action}`, action === 'finish' ? { notes: '' } : {});
            toast(action === 'take' ? 'Tarea tomada.' : action === 'finish' ? `Tarea terminada. Avance de la OT: ${r.progress}%` : 'Tarea revertida.', 'ok');
            await load();
        });
    };
    await load();
}

function actions(ctx, t, lockedBy) {
    const out = [];
    if (ctx.can('production:work') && t.status === 'Pendiente') {
        out.push(lockedBy
            ? html`<button class="sm" disabled title="Primero: ${lockedBy.description}">Tomar</button>`
            : html`<button class="sm primary" data-do="take" data-id="${t._id}">Tomar</button>`);
    }
    if (ctx.can('production:work') && t.status === 'En progreso' && (t.assignedUser?._id === ctx.user.id || ctx.can('production:assign'))) out.push(html`<button class="sm primary" data-do="finish" data-id="${t._id}">Finalizar</button>`);
    if (ctx.can('production:assign') && t.status !== 'Pendiente') out.push(html`<button class="sm" data-do="revert" data-id="${t._id}">Revertir</button>`);
    return out;
}
