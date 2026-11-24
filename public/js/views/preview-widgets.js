// MAQUETA VISUAL (vista previa). Muestra cómo quedarían los adjuntos en Google Drive
// y el cálculo con IA en el presupuesto, SIN conectar nada: no sube archivos, no llama
// a ningún servicio. Es solo para enseñar el flujo. La lógica real se agrega después.
import { html, raw } from '../dom.js';

const driveIcon = raw(`<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="prev-icon">
<path fill="#1aa260" d="M7.7 3.5 1.3 14.7l3.2 5.6 6.4-11.2z"/><path fill="#4285f4" d="M16.3 3.5H7.7l6.4 11.2h8.6z"/><path fill="#ffba00" d="m22.7 14.7-4.3-7.4-6.9 12.1h8.1z"/></svg>`);

const previewBadge = html`<span class="badge warn" title="Todavía no está conectado">Vista previa</span>`;

// Bloque de adjuntos (presupuesto / OT / colocación).
export function attachmentsBlock(scope = 'obra') {
    return html`<div class="card" data-prev-attachments>
        <div class="row between"><h2 class="mb0">${driveIcon} Adjuntos en Google Drive ${previewBadge}</h2></div>
        <p class="small muted">Así se verá la carga de archivos y fotos a la carpeta de la obra en Drive. (Maqueta: no sube nada todavía.)</p>
        <div class="row">
            <label class="btn sm"><input type="file" data-prev-file multiple hidden> Adjuntar archivo</label>
            <button type="button" class="btn sm" data-prev-share>Compartir carpeta con el cliente</button>
        </div>
        <div class="small muted mt">Carpeta de la obra en Drive:</div>
        <ul class="small prev-tree">
            <li>${driveIcon} Obra / ${scope === 'presupuesto' ? html`<strong>Presupuesto</strong>` : 'Presupuesto'}</li>
            <li>${driveIcon} Obra / ${scope === 'OT' ? html`<strong>Producción</strong>` : 'Producción'}</li>
            <li>${driveIcon} Obra / ${scope === 'colocación' ? html`<strong>Colocación</strong>` : 'Colocación'}</li>
        </ul>
        <div data-prev-filelist class="small"></div>
        <div data-prev-link class="alert info small hidden mt"></div>
    </div>`;
}

// Bloque de IA en el presupuesto: foto del lugar + medidas que carga el vendedor
// → la IA propondría materiales y un render. Acá es todo de ejemplo.
export function aiPhotoBlock() {
    return html`<div class="card" data-prev-ai>
        <div class="row between"><h2 class="mb0">Fotos del lugar y cálculo con IA ${previewBadge}</h2></div>
        <p class="small muted">El vendedor sube la foto del lugar y carga las medidas. La IA propone materiales y un render para revisar. (Maqueta: resultados de ejemplo.)</p>
        <div class="grid cols-2">
            <div><label class="btn sm"><input type="file" accept="image/*" data-prev-photo hidden> Subir foto del lugar</label>
                <div data-prev-photo-view class="mt"></div></div>
            <div class="grid cols-3">
                <div class="field"><label>Ancho (m)</label><input type="number" step="0.01" data-prev-m value="3"></div>
                <div class="field"><label>Alto (m)</label><input type="number" step="0.01" data-prev-m value="2"></div>
                <div class="field"><label>Cantidad</label><input type="number" step="1" data-prev-m value="1"></div>
            </div>
        </div>
        <div class="row mt">
            <button type="button" class="btn sm primary" data-prev-ai-calc>Calcular materiales</button>
            <button type="button" class="btn sm" data-prev-ai-render>Generar render</button>
        </div>
        <div data-prev-ai-materials class="hidden mt"></div>
        <div data-prev-ai-render-out class="hidden mt"></div>
    </div>`;
}

// ---- Interacciones locales (sin red). Se instala un único manejador. ----
let installed = false;
export function installPreviewHandlers() {
    if (installed) return;
    installed = true;

    document.addEventListener('change', (e) => {
        const file = e.target.closest('[data-prev-file]');
        if (file) {
            e.stopPropagation();
            const names = [...file.files].map(f => f.name);
            const box = file.closest('[data-prev-attachments]').querySelector('[data-prev-filelist]');
            box.innerHTML = names.length
                ? `<div class="alert ok mt">Se subirían a Drive: ${names.map(n => n.replace(/[<>&]/g, '')).join(', ')} <em>(maqueta: no se sube)</em></div>` : '';
        }
        const photo = e.target.closest('[data-prev-photo]');
        if (photo && photo.files[0]) {
            e.stopPropagation();
            const view = photo.closest('[data-prev-ai]').querySelector('[data-prev-photo-view]');
            const url = URL.createObjectURL(photo.files[0]);
            view.innerHTML = `<img src="${url}" alt="foto del lugar" class="prev-photo">`;
        }
    }, true);

    document.addEventListener('click', (e) => {
        const share = e.target.closest('[data-prev-share]');
        if (share) {
            e.preventDefault(); e.stopPropagation();
            const box = share.closest('[data-prev-attachments]').querySelector('[data-prev-link]');
            box.classList.remove('hidden');
            box.innerHTML = 'Link de ejemplo para el cliente: <code>https://drive.google.com/drive/folders/XXXXXXXX</code> <em>(se generará al conectar Drive)</em>';
        }
        const calc = e.target.closest('[data-prev-ai-calc]');
        if (calc) {
            e.preventDefault(); e.stopPropagation();
            const card = calc.closest('[data-prev-ai]');
            const m = [...card.querySelectorAll('[data-prev-m]')].map(i => Number(i.value) || 0);
            const area = (m[0] * m[1] * (m[2] || 1)).toFixed(2);
            const out = card.querySelector('[data-prev-ai-materials]');
            out.classList.remove('hidden');
            out.innerHTML = `<div class="alert info small">Propuesta de la IA (ejemplo) para ${m[0]}×${m[1]} m, ${m[2] || 1} u · superficie ${area} m²:</div>
                <div class="table-wrap"><table><thead><tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th></tr></thead><tbody>
                <tr><td>Lona front 13 oz</td><td class="num">${area}</td><td>m²</td></tr>
                <tr><td>Caño estructural 40x40</td><td class="num">${((m[0] + m[1]) * 2 * (m[2] || 1)).toFixed(1)}</td><td>m</td></tr>
                <tr><td>Ojalillos</td><td class="num">${Math.ceil(area) * 2}</td><td>u</td></tr></tbody></table></div>
                <div class="small muted">Vista previa: la IA real tomaría tus medidas y tu catálogo. Siempre lo revisás antes de cargar.</div>`;
        }
        const render = e.target.closest('[data-prev-ai-render]');
        if (render) {
            e.preventDefault(); e.stopPropagation();
            const card = render.closest('[data-prev-ai]');
            const out = card.querySelector('[data-prev-ai-render-out]');
            out.classList.remove('hidden');
            out.innerHTML = `<div class="alert info small">Render de ejemplo: así se vería el cartel puesto en el lugar.</div>
                <img src="/img/render-ejemplo.png" alt="Render de ejemplo del cartel en el lugar" class="prev-photo" loading="lazy">`;
        }
    }, true);
}
