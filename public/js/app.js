// Arranque: sesión, menú según permisos y navegación por #ruta.
import { api } from './api.js';
import { $, html, setHtml, showError, modal, toast, readForm } from './dom.js';

const MENU = [
    { group: 'General' },
    { path: 'dashboard', label: 'Inicio e indicadores', perm: ['dashboard:read'], view: () => import('./views/dashboard.js') },
    { group: 'Comercial' },
    { path: 'quotes', label: 'Presupuestos', perm: ['quotes:read'], view: () => import('./views/quotes.js') },
    { path: 'clients', label: 'Clientes', perm: ['clients:read'], view: () => import('./views/catalogs.js') },
    { group: 'Operaciones' },
    { path: 'workorders', label: 'Órdenes de trabajo', perm: ['workorders:read'], view: () => import('./views/workorders.js') },
    { path: 'production', label: 'Producción', perm: ['production:read'], view: () => import('./views/production.js') },
    { path: 'quality', label: 'Control de calidad', perm: ['quality:read'], view: () => import('./views/quality.js') },
    { path: 'installations', label: 'Colocaciones', perm: ['installations:read', 'installations:own'], view: () => import('./views/installations.js') },
    { group: 'Compras y stock' },
    { path: 'purchases', label: 'Compras', perm: ['purchases:read'], view: () => import('./views/purchases.js') },
    { path: 'products', label: 'Insumos y stock', perm: ['catalog:read'], view: () => import('./views/catalogs.js') },
    { path: 'suppliers', label: 'Proveedores', perm: ['suppliers:read'], view: () => import('./views/catalogs.js') },
    { group: 'Administración' },
    { path: 'invoices', label: 'Facturación ARCA', perm: ['invoices:read'], view: () => import('./views/invoices.js') },
    { path: 'payments', label: 'Cobranzas', perm: ['payments:read'], view: () => import('./views/payments.js') },
    { group: 'Sistema' },
    { path: 'admin', label: 'Usuarios, roles y configuración', perm: ['users:admin', 'settings:admin', 'audit:read'], view: () => import('./views/admin.js') },
];

const state = { user: null, perms: new Set() };
export const can = (...p) => p.some(x => state.perms.has(x));

function buildMenu() {
    const items = [];
    let pendingGroup = null;
    for (const m of MENU) {
        if (m.group) { pendingGroup = m.group; continue; }
        if (!can(...m.perm)) continue;
        if (pendingGroup) { items.push(html`<li class="group">${pendingGroup}</li>`); pendingGroup = null; }
        items.push(html`<li><a href="#/${m.path}" data-path="${m.path}">${m.label}</a></li>`);
    }
    setHtml($('#menu'), items);
}

function parseHash() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
    return { path: parts[0] || '', parts };
}

async function route() {
    const { path, parts } = parseHash();
    const entry = MENU.find(m => m.path === path && can(...m.perm)) || MENU.find(m => m.path && can(...m.perm));
    if (!entry) { setHtml($('#view'), html`<div class="card">Tu usuario no tiene módulos habilitados.</div>`); return; }
    if (entry.path !== path) { location.hash = `#/${entry.path}`; return; }
    document.querySelectorAll('#menu a').forEach(a => a.classList.toggle('active', a.dataset.path === path));
    $('#sidebar').classList.remove('open');

    const root = $('#view');
    for (const ev of ['onclick', 'onsubmit', 'oninput', 'onchange']) root[ev] = null; // limpia handlers de la vista anterior
    $('#topActions').onclick = null;
    setHtml(root, html`<div class="card muted">Cargando…</div>`);
    setHtml($('#topActions'), '');
    const ctx = {
        root, path, parts, params: parts.slice(1), user: state.user, can,
        setTitle: (t) => { $('#title').textContent = t; document.title = `${t} · TIZ`; },
        setActions: (h) => setHtml($('#topActions'), h),
        navigate: (to) => { location.hash = to; },
        reload: () => route(),
    };
    try {
        const mod = await entry.view();
        await mod.render(ctx);
    } catch (e) {
        showError(e);
        setHtml(root, html`<div class="alert bad">${e.message}</div>`);
    }
}

function passwordDialog(forced) {
    const m = modal({
        title: forced ? 'Elegí una contraseña nueva' : 'Cambiar contraseña',
        body: html`${forced ? html`<div class="alert info">Por seguridad tenés que cambiar la contraseña inicial.</div>` : ''}
            <form id="pwdForm">
            <div class="field"><label>Contraseña actual</label><input type="password" name="currentPassword" required autocomplete="current-password"></div>
            <div class="field"><label>Nueva contraseña (mín. 10 caracteres, con mayúscula, minúscula y número)</label><input type="password" name="newPassword" required minlength="10" autocomplete="new-password"></div>
            <div class="field"><label>Repetir nueva contraseña</label><input type="password" name="repeat" required autocomplete="new-password"></div>
            </form>`,
        footer: html`${forced ? '' : html`<button type="button" data-close>Cancelar</button>`}<button class="primary" type="submit" form="pwdForm">Guardar</button>`,
    });
    if (forced) m.el.querySelector('[data-close]').remove();
    m.el.addEventListener('cancel', (e) => { if (forced) e.preventDefault(); }, true);
    m.el.querySelector('#pwdForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = readForm(e.target);
        if (f.newPassword !== f.repeat) { toast('Las contraseñas no coinciden.', 'bad'); return; }
        try {
            await api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
            toast('Contraseña actualizada.', 'ok');
            m.close();
            state.user.mustChangePassword = false;
        } catch (err) { showError(err); }
    });
}

async function boot() {
    let me;
    try { me = await api.get('/auth/me'); } catch { window.location.replace('/'); return; }
    state.user = me.user;
    state.perms = new Set(me.user.permissions);
    $('#whoName').textContent = me.user.name;
    $('#whoRole').textContent = `${me.user.role.label}${me.user.sector ? ` · ${me.user.sector.name}` : ''}`;
    buildMenu();

    const extra = document.createElement('ul');
    extra.className = 'menu';
    setHtml(extra, html`<li class="group">Mi cuenta</li><li><a href="#" data-pwd>Cambiar contraseña</a></li><li><a href="#" data-logout>Cerrar sesión</a></li>`);
    $('#sidebar nav').appendChild(extra);
    extra.addEventListener('click', async (e) => {
        if (e.target.closest('[data-pwd]')) { e.preventDefault(); passwordDialog(false); }
        if (e.target.closest('[data-logout]')) {
            e.preventDefault();
            await api.post('/auth/logout').catch(() => {});
            window.location.replace('/');
        }
    });
    $('#menuToggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    window.addEventListener('hashchange', route);
    await route();
    if (me.user.mustChangePassword) passwordDialog(true);
}

document.addEventListener('DOMContentLoaded', boot);
