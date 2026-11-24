// Control de calidad con checklists: pendientes, realizar control e historial.
import { api } from '../api.js';
import { html, setHtml, $, $$, toast, options, dmy, dmyhm, badge, withBusy } from '../dom.js';

const kpi = (label, value, sub = '') => html`<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

export async function render(ctx) {
    if (ctx.params[0] === 'check') return checkForm(ctx, ctx.params[1]);
    ctx.setTitle('Control de calidad');
    const [pending, history, stats] = await Promise.all([api.get('/quality/pending'), api.get('/quality'), api.get('/quality/stats')]);
    setHtml(ctx.root, html`<div class="card"><h2>Resumen de calidad</h2>
        <div class="grid cols-4">
            ${kpi('Controles', stats.total)}
            ${kpi('% de rechazo', `${stats.rejectionPct}%`, `${stats.rejected} de ${stats.total}`)}
            ${kpi('Reprocesos con pérdida', stats.reworkLoss, 'rechazos sin reutilizar material')}
            ${kpi('Aprobados', stats.approved)}
        </div>
        <div class="grid cols-2 mt">
            <div><h3>Rechazos por inspector</h3><div class="table-wrap"><table><thead><tr><th>Inspector</th><th class="num">Controles</th><th class="num">Rechazos</th><th class="num">%</th></tr></thead>
            <tbody>${stats.inspectors.length ? stats.inspectors.map(i => html`<tr><td>${i.inspector}</td><td class="num">${i.total}</td><td class="num">${i.rejected}</td><td class="num">${i.pct}%</td></tr>`) : html`<tr><td colspan="4" class="muted">Sin datos.</td></tr>`}</tbody></table></div></div>
            <div><h3>OT con más reprocesos</h3><div class="table-wrap"><table><thead><tr><th>OT</th><th class="num">Rechazos</th><th class="num">Con pérdida</th></tr></thead>
            <tbody>${stats.topReprocess.length ? stats.topReprocess.map(w => html`<tr><td><a href="#/workorders/${w.workOrder}">${w.woNumber}</a></td><td class="num">${w.rejects}</td><td class="num">${w.lossRejects}</td></tr>`) : html`<tr><td colspan="3" class="muted">Sin reprocesos.</td></tr>`}</tbody></table></div></div>
        </div></div>
        <div class="card"><h2>Pendientes de control (${pending.length})</h2>
        ${pending.length ? html`<div class="table-wrap"><table><thead><tr><th>OT</th><th>Cliente</th><th>Título</th><th>Entrega</th><th></th></tr></thead>
        <tbody>${pending.map(w => html`<tr><td><a href="#/workorders/${w._id}">${w.number}</a></td><td>${w.clientName}</td><td>${w.title}</td><td>${dmy(w.dueDate)}</td>
        <td class="right">${ctx.can('quality:write') ? html`<a class="btn sm primary" href="#/quality/check/${w._id}">Controlar</a>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">No hay OT en estado Calidad.</p>`}</div>
        <div class="card"><h2>Últimos controles</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>OT</th><th>Checklist</th><th>Resultado</th><th>Inspector</th><th>Fallas</th></tr></thead>
        <tbody>${history.length ? history.map(c => html`<tr><td>${dmyhm(c.date)}</td><td><a href="#/workorders/${c.workOrder}">${c.workOrderNumber}</a></td><td>${c.templateName}</td>
        <td>${badge(c.result)}</td><td>${c.inspectorName}</td><td class="small">${c.results.filter(r => !r.ok).map(r => `${r.item}: ${r.note}`).join(' · ')}</td></tr>`)
        : html`<tr><td colspan="6" class="muted">Sin controles.</td></tr>`}</tbody></table></div></div>`);
}

async function checkForm(ctx, woId) {
    const [w, templates] = await Promise.all([api.get(`/workorders/${woId}`), api.get('/quality-templates', { active: 'true' })]);
    ctx.setTitle(`Control de calidad · ${w.number}`);
    ctx.setActions(html`<a class="btn" href="#/quality">Volver</a>`);
    setHtml(ctx.root, html`<div class="card"><strong>${w.clientName}</strong> · ${w.title} · ${badge(w.status)}
        <ul class="small">${w.items.map(i => html`<li>${i.quantity} × ${i.description}</li>`)}</ul></div>
        <form class="card" id="qcForm"><div class="field"><label>Checklist</label><select name="template">${options(templates, templates[0]?._id, { empty: 'Control libre' })}</select></div>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Punto de control</th><th>OK</th><th>Observación (obligatoria si falla)</th></tr></thead><tbody data-items></tbody></table></div>
        <button type="button" class="sm mt" data-add>+ Punto adicional</button>
        <div class="field mt"><label>Observaciones generales</label><textarea name="observations" maxlength="2000"></textarea></div>
        <div class="field hidden" data-reuse><label>Si se rechaza: ¿el material se puede reutilizar?</label>
            <div class="row"><label class="mb0"><input type="radio" name="materialReusable" value="si"> Sí, se reutiliza (no es otro consumo)</label>
            <label class="mb0"><input type="radio" name="materialReusable" value="no"> No, hay que rehacer con material nuevo (pérdida)</label></div></div>
        <div class="field"><label>Fotos del trabajo terminado (opcional)</label><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></div>
        <div class="row end"><span class="muted small">Si algún punto falla, la OT vuelve a Producción.</span><button class="primary">Registrar control</button></div></form>`);

    const row = (item) => html`<tr data-row><td><input name="item" value="${item}" required maxlength="300"></td><td><input type="checkbox" name="ok"></td>
        <td><input name="note" maxlength="500"></td></tr>`;
    const fill = () => {
        const t = templates.find(x => x._id === $('[name=template]', ctx.root).value);
        setHtml($('[data-items]', ctx.root), (t?.items || ['Trabajo terminado según OT']).map(row));
        toggleReuse();
    };
    // El bloque de reutilización solo aparece si hay algún punto sin tildar (se va a rechazar).
    const toggleReuse = () => {
        const anyFail = $$('[data-row]', ctx.root).some(tr => !$('[name=ok]', tr).checked);
        $('[data-reuse]', ctx.root).classList.toggle('hidden', !anyFail);
    };
    fill();
    ctx.root.onchange = (e) => { if (e.target.name === 'template') fill(); if (e.target.name === 'ok') toggleReuse(); };
    ctx.root.onclick = (e) => { if (e.target.closest('[data-add]')) { $('[data-items]', ctx.root).insertAdjacentHTML('beforeend', String(row(''))); toggleReuse(); } };
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const results = $$('[data-row]', e.target).map(tr => ({ item: $('[name=item]', tr).value.trim(), ok: $('[name=ok]', tr).checked, note: $('[name=note]', tr).value.trim() })).filter(r => r.item);
        const missing = results.find(r => !r.ok && !r.note);
        if (missing) { toast(`Agregá una observación en "${missing.item}".`, 'bad'); return; }
        const willReject = results.some(r => !r.ok);
        const materialReusable = (e.target.querySelector('[name=materialReusable]:checked') || {}).value;
        if (willReject && !materialReusable) { toast('Indicá si el material se puede reutilizar.', 'bad'); return; }
        await withBusy(e.submitter, async () => {
            const c = await api.post('/quality', { workOrder: woId, template: e.target.template.value || null, results, observations: e.target.observations.value, ...(willReject ? { materialReusable } : {}) });
            const files = e.target.photos.files;
            if (files.length) {
                const fd = new FormData();
                for (const f of files) fd.append('photos', f);
                try { await api.upload(`/quality/${c._id}/photos`, fd); }
                catch { toast('El control se guardó, pero falló la subida de alguna foto.', 'bad'); }
            }
            toast(`Control ${c.result.toLowerCase()}.`, c.result === 'Aprobado' ? 'ok' : 'bad');
            ctx.navigate(`#/workorders/${woId}`);
        });
    };
}
