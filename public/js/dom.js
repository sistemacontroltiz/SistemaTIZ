// Utilidades de interfaz. `html` escapa automáticamente todo lo que se interpola,
// así un dato con <script> se muestra como texto y no se ejecuta (anti-XSS).
class SafeHtml { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new SafeHtml(String(s ?? ''));

export function esc(v) {
    return String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
}
function piece(v) {
    if (v instanceof SafeHtml) return v.s;
    if (Array.isArray(v)) return v.map(piece).join('');
    if (v === false || v === null || v === undefined) return '';
    return esc(v);
}
export function html(strings, ...values) {
    let out = strings[0];
    values.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
    return new SafeHtml(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function setHtml(el, content) { el.innerHTML = piece(content); }

// ---------- Formatos ----------
const nf = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => `$ ${nf.format(Number(n || 0))}`;
export const num = (n, d = 2) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: d }).format(Number(n || 0));
export function ymd(d) {
    if (!d) return '';
    const dt = new Date(d);
    return new Date(dt.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}
export const dmy = (d) => (d ? ymd(d).split('-').reverse().join('/') : '');
export const dmyhm = (d) => (d ? `${dmy(d)} ${new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : '');
// Duración legible entre dos fechas (ej.: "2 d 5 h", "3 h 20 min", "45 min").
export function durHuman(from, to) {
    if (!from || !to) return '—';
    let ms = new Date(to) - new Date(from);
    if (ms < 0) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
    const d = Math.floor(h / 24), hr = h % 24;
    return hr ? `${d} d ${hr} h` : `${d} d`;
}
export const today = () => ymd(new Date());
export const addDays = (n) => ymd(new Date(Date.now() + n * 86400000));
export const formatCuit = (c) => (c && c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c || '');

const BADGES = {
    ok: ['Aprobado', 'Autorizada', 'Completada', 'Realizada', 'Entregada', 'Facturada', 'Vigente', 'Registrada', 'Lista para entrega', 'Cobrado'],
    warn: ['Enviado', 'Pendiente', 'En progreso', 'Parcial', 'Programada', 'Calidad', 'Error', 'Reprogramada'],
    bad: ['Rechazado', 'Rechazada', 'Vencido', 'Baja', 'Anulada', 'Anulado', 'Cancelada'],
    info: ['Producción', 'Diseño', 'Colocación', 'Borrador', 'Sin facturar'],
};
export function badge(text) {
    const cls = Object.entries(BADGES).find(([, list]) => list.includes(text))?.[0] || '';
    return html`<span class="badge ${cls}">${text}</span>`;
}
const LIGHT_LABEL = { 'en-termino': 'En término', proxima: 'Vence pronto', vencida: 'Vencida', cumplida: 'Cumplida', 'cumplida-tarde': 'Cumplida tarde', baja: 'Baja' };
export const light = (l) => html`<span class="nowrap"><span class="dot ${l}"></span>${LIGHT_LABEL[l] || l}</span>`;

// ---------- Avisos ----------
export function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'bad' ? 7000 : 3500);
}
export function showError(err) {
    const extra = err?.details?.errors?.length ? `\n${err.details.errors.join('\n')}` : '';
    toast(`${err?.message || err}${extra}`, 'bad');
}

// ---------- Modal ----------
export function modal({ title, body, footer, wide = false, onOpen }) {
    const dlg = document.createElement('dialog');
    if (wide) dlg.classList.add('wide');
    setHtml(dlg, html`<div class="dlg-head"><h2 class="mb0">${title}</h2><button type="button" data-close aria-label="Cerrar">✕</button></div>
        <div class="dlg-body">${body}</div>${footer ? html`<div class="dlg-foot">${footer}</div>` : ''}`);
    document.body.appendChild(dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.showModal();
    onOpen?.(dlg);
    return { el: dlg, close };
}

export function confirmDialog(message, { okText = 'Confirmar', danger = false, input } = {}) {
    return new Promise((resolve) => {
        const m = modal({
            title: 'Confirmar',
            body: html`<p>${message}</p>${input ? html`<div class="field"><label>${input}</label><textarea data-reason maxlength="500"></textarea></div>` : ''}`,
            footer: html`<button type="button" data-close>Cancelar</button><button type="button" class="${danger ? 'danger' : 'primary'}" data-ok>${okText}</button>`,
        });
        m.el.querySelector('[data-ok]').addEventListener('click', () => {
            const reason = m.el.querySelector('[data-reason]')?.value.trim();
            if (input && !reason) { toast('Completá el motivo.', 'bad'); return; }
            m.close();
            resolve(input ? reason : true);
        });
        m.el.addEventListener('close', () => resolve(false));
    });
}

// ---------- Formularios ----------
// Lee un formulario respetando data-type="number|bool|id" en cada campo.
export function readForm(form) {
    const out = {};
    for (const el of form.elements) {
        if (!el.name || el.disabled) continue;
        const t = el.dataset.type;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.multiple) v = [...el.selectedOptions].map(o => o.value);
        else v = el.value.trim();
        if (t === 'number') v = v === '' ? undefined : Number(v);
        if (t === 'id' && v === '') v = null;
        if (t === 'optional' && v === '') v = undefined;
        out[el.name] = v;
    }
    return out;
}

export function options(list, selected, { value = '_id', label = 'name', empty } = {}) {
    return html`${empty !== undefined ? html`<option value="">${empty}</option>` : ''}${list.map(o => {
        const isStr = typeof o !== 'object';
        const v = isStr ? o : o[value];
        const l = typeof label === 'function' ? label(o) : (isStr ? o : o[label]);
        return html`<option value="${v}" ${String(v) === String(selected ?? '') ? raw('selected') : ''}>${l}</option>`;
    })}`;
}

export async function withBusy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { showError(e); return undefined; } finally { if (btn) btn.disabled = false; }
}
