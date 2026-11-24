// Compras: listado, carga manual o asistida con IA, imputación a OT y anulación.
import { api } from '../api.js';
import { html, setHtml, $, $$, modal, toast, showError, readForm, options, money, num, dmy, today, badge, confirmDialog, withBusy } from '../dom.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export async function render(ctx) {
    if (ctx.params[0] === 'new') return form(ctx);
    ctx.setTitle('Compras');
    if (ctx.can('purchases:write')) ctx.setActions(html`<a class="btn primary" href="#/purchases/new">+ Registrar compra</a>`);
    setHtml(ctx.root, html`<div class="filters"><input type="search" placeholder="Proveedor, factura, artículo…" data-q></div><div data-list></div>`);
    let list = [];
    const load = async () => {
        list = await api.get('/purchases', { q: $('[data-q]', ctx.root).value });
        setHtml($('[data-list]', ctx.root), html`<div class="table-wrap"><table><thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Artículos</th>
            <th class="num">Neto</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
            ${list.length ? list.map(p => html`<tr class="clickable" data-id="${p._id}"><td>${p.number}</td><td>${dmy(p.date)}</td><td>${p.supplierName}</td>
            <td>${p.invoiceType} ${p.invoiceNumber}</td><td class="small">${p.items.map(i => i.description).join(', ').slice(0, 90)}</td>
            <td class="num">${money(p.net)}</td><td class="num">${money(p.total)}</td><td>${badge(p.status)}</td></tr>`)
            : html`<tr><td colspan="8" class="muted">Sin compras.</td></tr>`}</tbody></table></div>`);
    };
    let t;
    ctx.root.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
    ctx.root.onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) show(ctx, tr.dataset.id, load); };
    await load();
}

async function show(ctx, id, reload) {
    const p = await api.get(`/purchases/${id}`);
    const m = modal({
        title: `${p.number} · ${p.supplierName}`, wide: true,
        body: html`<p>${dmy(p.date)} · Factura ${p.invoiceType} ${p.invoiceNumber} · ${badge(p.status)}</p>
        <div class="table-wrap"><table><thead><tr><th>Artículo</th><th>Insumo</th><th class="num">Cant.</th><th class="num">Costo u.</th><th class="num">Total</th><th>Imputado a OT</th></tr></thead>
        <tbody>${p.items.map(i => html`<tr><td>${i.description}</td><td>${i.product?.name || '-'}</td><td class="num">${num(i.quantity)} ${i.unit}</td><td class="num">${money(i.unitCost)}</td>
        <td class="num">${money(i.total)}</td><td>${i.allocations.map(a => `${a.workOrder?.number}: ${money(a.amount)}`).join(', ')}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="4" class="right">Neto</td><td class="num">${money(p.net)}</td><td></td></tr><tr><td colspan="4" class="right">IVA</td><td class="num">${money(p.vat)}</td><td></td></tr>
        <tr><td colspan="4" class="right">Otros impuestos</td><td class="num">${money(p.otherTaxes)}</td><td></td></tr><tr><td colspan="4" class="right">Total</td><td class="num">${money(p.total)}</td><td></td></tr></tfoot></table></div>
        ${p.notes ? html`<p class="mt">${p.notes}</p>` : ''}`,
        footer: html`${ctx.can('purchases:write') && p.status === 'Registrada' ? html`<button class="danger" data-annul>Anular compra</button>` : ''}<button data-close>Cerrar</button>`,
    });
    m.el.querySelector('[data-annul]')?.addEventListener('click', async () => {
        const reason = await confirmDialog('Anular la compra revierte el stock ingresado.', { input: 'Motivo', danger: true, okText: 'Anular' });
        if (!reason) return;
        try { await api.post(`/purchases/${id}/cancel`, { reason }); toast('Compra anulada.', 'ok'); m.close(); reload(); } catch (e) { showError(e); }
    });
}

async function form(ctx) {
    const [suppliers, products, wos] = await Promise.all([
        api.get('/suppliers', { active: 'true', limit: 2000 }), api.get('/products', { active: 'true', limit: 2000 }), api.get('/workorders', { status: 'activas', limit: 500 }),
    ]);
    ctx.setTitle('Registrar compra');
    ctx.setActions(html`<a class="btn" href="#/purchases">Volver</a>`);
    const itemRow = (it = {}) => html`<tr data-row>
        <td><select name="product" data-type="id">${options(products, it.product, { empty: '— sin vincular —' })}</select></td>
        <td><input name="description" required maxlength="300" value="${it.description || ''}"></td>
        <td><input name="quantity" type="number" step="any" min="0.0001" required value="${it.quantity ?? 1}" data-type="number"></td>
        <td><input name="unit" maxlength="30" value="${it.unit || ''}" list="unitsList"></td>
        <td><input name="factor" type="number" step="any" min="0.0001" value="${it.factor ?? 1}" data-type="number" title="Unidades de stock por unidad de compra"></td>
        <td><input name="unitCost" type="number" step="0.01" min="0" required value="${it.unitCost ?? 0}" data-type="number"></td>
        <td class="num" data-total></td>
        <td><select name="woAlloc" data-type="id">${options(wos, '', { empty: '—', label: w => `${w.number} ${w.clientName}` })}</select></td>
        <td><button type="button" class="sm danger" data-del>✕</button></td></tr>`;

    setHtml(ctx.root, html`${ctx.can('purchases:write') ? html`<div class="card row"><strong>Cargar con IA:</strong>
        <input type="file" accept="application/pdf,image/*" data-ai-file class="spacer"><button type="button" data-ai>Leer factura</button>
        <span class="small muted">Completa el formulario para que lo revises; no guarda nada solo.</span></div>` : ''}
        <form id="purForm"><div class="card"><div class="grid cols-4">
        <div class="field"><label>Proveedor *</label><select name="supplier" required>${options(suppliers, '', { empty: 'Elegí proveedor' })}</select></div>
        <div class="field"><label>Fecha *</label><input type="date" name="date" required max="${today()}" value="${today()}"></div>
        <div class="field"><label>Tipo</label><select name="invoiceType">${options(['A', 'B', 'C', 'X', 'Remito'], 'A')}</select></div>
        <div class="field"><label>N° de comprobante</label><input name="invoiceNumber" maxlength="40" placeholder="0001-00001234"></div></div></div>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Insumo del catálogo</th><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Factor</th><th>Costo u. s/IVA</th><th class="num">Total</th><th>Imputar a OT</th><th></th></tr></thead>
        <tbody data-rows>${itemRow()}</tbody></table></div><datalist id="unitsList"></datalist>
        <div class="row between card mt"><button type="button" data-add>+ Ítem</button>
        <div class="grid cols-3"><div class="field"><label>IVA</label><input name="vat" type="number" step="0.01" min="0" value="0" data-type="number"></div>
        <div class="field"><label>Percepciones / otros</label><input name="otherTaxes" type="number" step="0.01" min="0" value="0" data-type="number"></div>
        <div class="field"><label>Total</label><div class="kpi"><strong data-sum>$ 0,00</strong></div></div></div></div>
        <label class="check"><input type="checkbox" name="updateCosts" checked> Actualizar el costo de los insumos del catálogo con esta compra</label>
        <div class="field mt"><label>Notas</label><textarea name="notes" maxlength="1000"></textarea></div>
        <div class="row end"><button class="primary">Registrar compra</button></div></form>`);

    const formEl = $('#purForm');
    const recalc = () => {
        let net = 0;
        for (const tr of $$('[data-row]', formEl)) {
            const t = r2(Number($('[name=quantity]', tr).value) * Number($('[name=unitCost]', tr).value));
            net += t; setHtml($('[data-total]', tr), money(t));
        }
        setHtml($('[data-sum]', formEl), money(net + Number(formEl.vat.value || 0) + Number(formEl.otherTaxes.value || 0)));
    };
    recalc();
    ctx.root.oninput = recalc;
    ctx.root.onchange = (e) => {
        if (e.target.name === 'product' && e.target.value) {
            const p = products.find(x => x._id === e.target.value); const tr = e.target.closest('tr');
            if (!$('[name=description]', tr).value) $('[name=description]', tr).value = p.name;
            $('[name=unit]', tr).value = $('[name=unit]', tr).value || p.unit;
            setHtml($('#unitsList'), [{ unit: p.unit, factor: 1 }, ...p.equivalences].map(x => html`<option value="${x.unit}">${x.factor}</option>`));
        }
        if (e.target.name === 'unit') {
            const tr = e.target.closest('tr'); const p = products.find(x => x._id === $('[name=product]', tr).value);
            const eq = p?.equivalences.find(x => x.unit === e.target.value);
            $('[name=factor]', tr).value = eq ? eq.factor : 1;
        }
        recalc();
    };
    ctx.root.onclick = async (e) => {
        if (e.target.closest('[data-add]')) { $('[data-rows]').insertAdjacentHTML('beforeend', String(itemRow())); recalc(); }
        if (e.target.closest('[data-del]') && $$('[data-row]').length > 1) { e.target.closest('tr').remove(); recalc(); }
        if (e.target.closest('[data-ai]')) {
            const file = $('[data-ai-file]').files[0];
            if (!file) { toast('Elegí el PDF o la foto de la factura.'); return; }
            const fd = new FormData(); fd.append('file', file);
            await withBusy(e.target, async () => {
                const d = await api.upload('/purchases/ai-extract', fd);
                if (d.supplier) formEl.supplier.value = d.supplier._id; else toast(`Proveedor no encontrado (${d.supplierName} ${d.supplierCuit}). Dalo de alta y elegilo.`);
                if (d.date) formEl.date.value = d.date;
                if (d.invoiceType) formEl.invoiceType.value = d.invoiceType;
                formEl.invoiceNumber.value = d.invoiceNumber; formEl.vat.value = d.vat; formEl.otherTaxes.value = d.otherTaxes;
                setHtml($('[data-rows]'), d.items.length ? d.items.map(it => itemRow({ ...it, factor: 1 })) : itemRow());
                recalc();
                toast(`Leídos ${d.items.length} ítem(s). Revisá todo antes de registrar. Total leído: ${money(d.total)}`, 'ok');
            });
        }
    };
    ctx.root.onsubmit = async (e) => {
        e.preventDefault();
        const head = readForm({ elements: $$('[name]', formEl).filter(el => !el.closest('[data-row]')) });
        const items = $$('[data-row]', formEl).map(tr => {
            const r = readForm({ elements: $$('[name]', tr) });
            const total = r2(r.quantity * r.unitCost);
            const allocations = r.woAlloc ? [{ workOrder: r.woAlloc, amount: total }] : [];
            delete r.woAlloc;
            return { ...r, allocations };
        });
        await withBusy(e.submitter, async () => {
            const p = await api.post('/purchases', { ...head, items });
            toast(`Compra ${p.number} registrada.`, 'ok');
            ctx.navigate('#/purchases');
        });
    };
}
