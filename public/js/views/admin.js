// Administración: usuarios, roles con permisos editables, empresa y ARCA,
// sectores, tarifas de mano de obra, checklists de calidad y auditoría.
import { api } from '../api.js';
import { html, raw, setHtml, $, $$, modal, toast, showError, readForm, options, money, dmyhm, ymd, badge, confirmDialog, withBusy } from '../dom.js';

const TABS = [
    ['users', 'Usuarios', 'users:admin'], ['roles', 'Roles y permisos', 'users:admin'], ['company', 'Empresa y ARCA', 'settings:admin'],
    ['sectors', 'Sectores', 'settings:admin'], ['labor', 'Mano de obra', 'settings:admin'], ['checklists', 'Checklists de calidad', 'settings:admin'], ['audit', 'Auditoría', 'audit:read'],
];

export async function render(ctx) {
    ctx.setTitle('Administración');
    const tabs = TABS.filter(([, , p]) => ctx.can(p));
    const tab = tabs.find(([k]) => k === ctx.params[0])?.[0] || tabs[0][0];
    setHtml(ctx.root, html`<div class="tabs">${tabs.map(([k, l]) => html`<button type="button" data-goto="${k}" class="${k === tab ? 'active' : ''}">${l}</button>`)}</div><div data-tab></div>`);
    ctx.root.onclick = (e) => { const g = e.target.closest('[data-goto]'); if (g) ctx.navigate(`#/admin/${g.dataset.goto}`); };
    const box = $('[data-tab]', ctx.root);
    const views = {
        users, roles, company, audit,
        sectors: (c, b) => simpleCatalog(c, b, { endpoint: '/sectors', label: 'sector', fields: [['name', 'Nombre'], ['description', 'Descripción']] }),
        labor: (c, b) => laborRates(c, b),
        checklists: (c, b) => checklists(c, b),
    };
    await views[tab](ctx, box);
}

// ---------- Usuarios ----------
async function users(ctx, box) {
    const [list, { roles: roleList }, sectors] = await Promise.all([api.get('/users'), api.get('/roles'), api.get('/sectors')]);
    setHtml(box, html`<div class="row end"><button class="primary" data-new>+ Nuevo usuario</button></div>
        <div class="table-wrap mt"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Sector</th><th>Último ingreso</th><th>Estado</th></tr></thead>
        <tbody>${list.map(u => html`<tr class="clickable" data-id="${u._id}"><td>${u.name}</td><td>${u.email}</td><td>${u.role?.label}</td><td>${u.sector?.name || ''}</td>
        <td>${dmyhm(u.lastLoginAt)}</td><td>${u.active ? html`<span class="badge ok">Activo</span>` : html`<span class="badge bad">Inactivo</span>`}${u.mustChangePassword ? html` <span class="badge warn">Debe cambiar clave</span>` : ''}</td></tr>`)}</tbody></table></div>`);
    box.onclick = (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (e.target.closest('[data-new]') || tr) {
            const u = tr ? list.find(x => x._id === tr.dataset.id) : null;
            const m = modal({
                title: u ? u.name : 'Nuevo usuario',
                body: html`<form id="userForm"><div class="grid cols-2">
                    <div class="field"><label>Nombre *</label><input name="name" required minlength="2" maxlength="120" value="${u?.name || ''}"></div>
                    <div class="field"><label>Email *</label><input name="email" type="email" required maxlength="160" value="${u?.email || ''}"></div>
                    <div class="field"><label>Rol *</label><select name="role" required>${options(roleList, u?.role?._id, { label: 'label' })}</select></div>
                    <div class="field"><label>Sector (para producción)</label><select name="sector" data-type="id">${options(sectors, u?.sector?._id, { empty: 'Sin sector' })}</select></div>
                    <div class="field"><label>${u ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña inicial *'}</label><input name="password" type="password" ${u ? '' : raw('required')} minlength="10" autocomplete="new-password" data-type="optional"></div>
                    <div class="field"><label class="check"><input type="checkbox" name="active" ${u?.active === false ? '' : raw('checked')}> Activo</label></div></div>
                    <p class="small muted">Mínimo 10 caracteres con mayúscula, minúscula y número. El usuario deberá cambiarla al ingresar.</p></form>`,
                footer: html`<button data-close>Cancelar</button><button class="primary" form="userForm">Guardar</button>`,
            });
            m.el.querySelector('form').addEventListener('submit', async (ev) => {
                ev.preventDefault();
                const data = readForm(ev.target);
                if (!data.password) delete data.password;
                try { if (u) await api.put(`/users/${u._id}`, data); else await api.post('/users', data); m.close(); toast('Usuario guardado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
            });
        }
    };
}

// ---------- Roles ----------
async function roles(ctx, box) {
    const { roles: list, permissions } = await api.get('/roles');
    const groups = {};
    for (const p of permissions) (groups[p.key.split(':')[0]] ||= []).push(p);
    setHtml(box, html`<div class="alert info">Los permisos se aplican al instante, sin tocar código. El rol Administrador siempre tiene todos.</div>
        <div class="row end"><button class="primary" data-new>+ Nuevo rol</button></div>
        <div class="table-wrap mt"><table><thead><tr><th>Rol</th><th>Clave</th><th class="num">Permisos</th><th></th></tr></thead>
        <tbody>${list.map(r => html`<tr class="clickable" data-id="${r._id}"><td>${r.label}</td><td>${r.key}</td><td class="num">${r.permissions.length}</td><td>${r.system ? html`<span class="badge">sistema</span>` : ''}</td></tr>`)}</tbody></table></div>`);
    box.onclick = async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!e.target.closest('[data-new]') && !tr) return;
        const r = tr ? list.find(x => x._id === tr.dataset.id) : null;
        const m = modal({
            title: r ? `Rol: ${r.label}` : 'Nuevo rol', wide: true,
            body: html`<form id="roleForm"><div class="grid cols-2"><div class="field"><label>Nombre</label><input name="label" required maxlength="60" value="${r?.label || ''}"></div>
                <div class="field"><label>Clave (minúsculas)</label><input name="key" required pattern="[a-z0-9_-]{2,30}" value="${r?.key || ''}" ${r?.system ? raw('readonly') : ''}></div></div>
                <div class="grid cols-3">${Object.entries(groups).map(([g, perms]) => html`<div class="card"><strong>${g}</strong>${perms.map(p => html`<label class="check"><input type="checkbox" name="perm" value="${p.key}"
                ${r?.permissions.includes(p.key) ? raw('checked') : ''} ${r?.key === 'admin' ? raw('disabled') : ''}> ${p.label}</label>`)}</div>`)}</div></form>`,
            footer: html`${r && !r.system ? html`<button class="danger" data-del>Borrar rol</button>` : ''}<span class="spacer"></span><button data-close>Cancelar</button><button class="primary" form="roleForm">Guardar</button>`,
        });
        m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
            if (!(await confirmDialog(`¿Borrar el rol ${r.label}?`, { danger: true }))) return;
            try { await api.del(`/roles/${r._id}`); m.close(); toast('Rol borrado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
        });
        m.el.querySelector('form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const f = ev.target;
            const body = { label: f.label.value.trim(), key: f.key.value.trim(), permissions: $$('[name=perm]:checked', f).map(c => c.value) };
            try { if (r) await api.put(`/roles/${r._id}`, body); else await api.post('/roles', body); m.close(); toast('Rol guardado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
        });
    };
}

// ---------- Empresa y ARCA ----------
async function company(ctx, box) {
    const { settings: s, arca } = await api.get('/settings/company');
    setHtml(box, html`<div class="alert ${arca.configured ? (arca.mode === 'produccion' ? 'ok' : 'warn') : 'bad'}">
        ARCA en modo <strong>${arca.mode}</strong>${arca.cuit ? ` · CUIT del certificado ${arca.cuit}` : ''}. ${arca.problem || (arca.configured ? 'Certificado cargado.' : '')}
        <button class="sm" data-check>Probar conexión</button><div class="small mt">El modo y el certificado se configuran en el archivo .env del servidor (ver guía).</div></div>
        <form class="card" id="coForm"><div class="grid cols-3">
        <div class="field"><label>Razón social</label><input name="businessName" maxlength="200" value="${s.businessName}"></div>
        <div class="field"><label>Nombre de fantasía</label><input name="tradeName" maxlength="200" value="${s.tradeName}"></div>
        <div class="field"><label>CUIT (igual al del certificado)</label><input name="cuit" maxlength="13" value="${s.cuit}"></div>
        <div class="field"><label>Condición IVA</label><select name="ivaCondition">${options([{ v: 'RI', l: 'Responsable Inscripto' }, { v: 'MT', l: 'Monotributo' }, { v: 'EX', l: 'Exento' }], s.ivaCondition, { value: 'v', label: 'l' })}</select></div>
        <div class="field"><label>Ingresos Brutos</label><input name="iibb" maxlength="40" value="${s.iibb}"></div>
        <div class="field"><label>Inicio de actividades</label><input type="date" name="activityStart" value="${ymd(s.activityStart)}"></div>
        <div class="field"><label>Domicilio comercial</label><input name="address" maxlength="300" value="${s.address}"></div>
        <div class="field"><label>Teléfono</label><input name="phone" maxlength="60" value="${s.phone}"></div>
        <div class="field"><label>Email</label><input name="email" type="email" maxlength="160" value="${s.email}"></div>
        <div class="field"><label>Punto de venta ARCA</label><input name="pointOfSale" type="number" min="1" data-type="number" value="${s.pointOfSale}"></div>
        <div class="field"><label>Vigencia de presupuestos (días)</label><input name="quoteValidityDays" type="number" min="1" data-type="number" value="${s.quoteValidityDays}"></div>
        <div class="field"><label>Plazo de pago por defecto (días)</label><input name="defaultPaymentTermDays" type="number" min="0" data-type="number" value="${s.defaultPaymentTermDays}"></div></div>
        <div class="field"><label>Condiciones que se imprimen en los presupuestos</label><textarea name="quoteTerms" maxlength="3000">${s.quoteTerms}</textarea></div>
        <div class="row end"><button class="primary">Guardar</button></div></form>`);
    box.onclick = async (e) => {
        const b = e.target.closest('[data-check]');
        if (b) await withBusy(b, async () => { const r = await api.get('/settings/arca-check'); toast(`ARCA responde: App ${r.dummy?.AppServer} · DB ${r.dummy?.DbServer} · Auth ${r.dummy?.AuthServer}`, 'ok'); });
    };
    box.onsubmit = async (e) => {
        e.preventDefault();
        const data = readForm(e.target);
        if (!data.activityStart) data.activityStart = null;
        await withBusy(e.submitter, async () => { await api.put('/settings/company', data); toast('Datos guardados.', 'ok'); });
    };
}

// ---------- Catálogos simples ----------
async function simpleCatalog(ctx, box, { endpoint, label, fields }) {
    const list = await api.get(endpoint);
    setHtml(box, html`<form class="card row" id="newForm">${fields.map(([n, l]) => html`<input name="${n}" placeholder="${l}" ${n === 'name' ? raw('required') : ''} maxlength="300">`)}
        <button class="primary">Agregar ${label}</button></form>
        <div class="table-wrap"><table><thead><tr>${fields.map(([, l]) => html`<th>${l}</th>`)}<th>Estado</th><th></th></tr></thead>
        <tbody>${list.map(x => html`<tr data-id="${x._id}">${fields.map(([n]) => html`<td><input name="${n}" value="${x[n] || ''}" maxlength="300"></td>`)}
        <td>${x.active === false ? html`<span class="badge bad">Inactivo</span>` : html`<span class="badge ok">Activo</span>`}</td>
        <td class="nowrap"><button class="sm" data-save>Guardar</button> ${x.active !== false ? html`<button class="sm danger" data-off>Desactivar</button>` : html`<button class="sm" data-on>Activar</button>`}</td></tr>`)}</tbody></table></div>`);
    box.onsubmit = async (e) => { e.preventDefault(); await withBusy(e.submitter, async () => { await api.post(endpoint, readForm(e.target)); toast('Agregado.', 'ok'); ctx.reload(); }); };
    box.onclick = async (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (!tr) return;
        const data = Object.fromEntries(fields.map(([n]) => [n, $(`[name=${n}]`, tr).value.trim()]));
        try {
            if (e.target.closest('[data-save]')) { await api.put(`${endpoint}/${tr.dataset.id}`, data); toast('Guardado.', 'ok'); }
            if (e.target.closest('[data-off]')) { await api.del(`${endpoint}/${tr.dataset.id}`); ctx.reload(); }
            if (e.target.closest('[data-on]')) { await api.put(`${endpoint}/${tr.dataset.id}`, { ...data, active: true }); ctx.reload(); }
        } catch (err) { showError(err); }
    };
}

async function laborRates(ctx, box) {
    const [list, sectors] = await Promise.all([api.get('/labor-rates'), api.get('/sectors')]);
    const row = (x = {}) => html`<td><input name="name" required maxlength="120" value="${x.name || ''}" placeholder="Tarea"></td><td><input name="unit" maxlength="30" value="${x.unit || 'hora'}"></td>
        <td><input name="cost" type="number" step="0.01" min="0" required value="${x.cost ?? ''}" data-type="number"></td>
        <td><select name="sector" data-type="id">${options(sectors, x.sector, { empty: 'Sin sector' })}</select></td>`;
    setHtml(box, html`<p class="small muted">Las tarifas se usan en el cotizador. El sector define a quién le llega la tarea de producción cuando se aprueba el presupuesto.</p>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Tarea</th><th>Unidad</th><th>Costo</th><th>Sector</th><th>Estado</th><th></th></tr></thead>
        <tbody>${list.map(x => html`<tr data-id="${x._id}">${row(x)}<td>${x.active === false ? badge('Baja') : ''}</td><td class="nowrap"><button class="sm" data-save>Guardar</button>
        ${x.active !== false ? html`<button class="sm danger" data-off>Desactivar</button>` : ''}</td></tr>`)}
        <tr data-new>${row()}<td></td><td><button class="sm primary" data-add>Agregar</button></td></tr></tbody></table></div>`);
    box.onclick = async (e) => {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const data = readForm({ elements: $$('[name]', tr) });
        try {
            if (e.target.closest('[data-add]')) { await api.post('/labor-rates', data); toast('Agregada.', 'ok'); ctx.reload(); }
            if (e.target.closest('[data-save]')) { await api.put(`/labor-rates/${tr.dataset.id}`, data); toast(`Guardada: ${money(data.cost)}`, 'ok'); }
            if (e.target.closest('[data-off]')) { await api.del(`/labor-rates/${tr.dataset.id}`); ctx.reload(); }
        } catch (err) { showError(err); }
    };
}

async function checklists(ctx, box) {
    const list = await api.get('/quality-templates');
    setHtml(box, html`<div class="row end"><button class="primary" data-new>+ Nuevo checklist</button></div>
        ${list.map(t => html`<div class="card mt"><div class="row between"><strong>${t.name}</strong><span>${t.active === false ? badge('Baja') : ''}<button class="sm" data-edit="${t._id}">Editar</button></span></div>
        <ol class="small">${t.items.map(i => html`<li>${i}</li>`)}</ol></div>`)}`);
    box.onclick = (e) => {
        const id = e.target.closest('[data-edit]')?.dataset.edit;
        if (!id && !e.target.closest('[data-new]')) return;
        const t = list.find(x => x._id === id);
        const m = modal({
            title: t ? t.name : 'Nuevo checklist',
            body: html`<form id="tplForm"><div class="field"><label>Nombre</label><input name="name" required maxlength="120" value="${t?.name || ''}"></div>
                <div class="field"><label>Puntos de control (uno por línea)</label><textarea name="items" required rows="10">${(t?.items || []).join('\n')}</textarea></div>
                <label class="check"><input type="checkbox" name="active" ${t?.active === false ? '' : raw('checked')}> Activo</label></form>`,
            footer: html`<button data-close>Cancelar</button><button class="primary" form="tplForm">Guardar</button>`,
        });
        m.el.querySelector('form').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const f = readForm(ev.target);
            const body = { name: f.name, active: f.active, items: f.items.split('\n').map(s => s.trim()).filter(Boolean) };
            try { if (t) await api.put(`/quality-templates/${t._id}`, body); else await api.post('/quality-templates', body); m.close(); toast('Guardado.', 'ok'); ctx.reload(); } catch (err) { showError(err); }
        });
    };
}

// ---------- Auditoría ----------
async function audit(ctx, box) {
    const rows = await api.get('/audit');
    setHtml(box, html`<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th>IP</th></tr></thead>
        <tbody>${rows.map(r => html`<tr><td class="nowrap">${dmyhm(r.date)}</td><td>${r.userName}</td><td>${r.action}</td><td>${r.summary}</td><td class="small muted">${r.ip}</td></tr>`)}</tbody></table></div>`);
}
