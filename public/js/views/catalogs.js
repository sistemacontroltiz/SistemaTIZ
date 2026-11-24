// Clientes, proveedores e insumos: listado + formulario con contactos,
// consulta a padrón ARCA, equivalencias de unidades, movimientos y ajuste de stock.
import { api } from '../api.js';
import { html, raw, setHtml, $, $$, modal, toast, showError, readForm, options, money, num, dmy, dmyhm, formatCuit, confirmDialog, withBusy } from '../dom.js';

const IVA = { RI: 'Responsable Inscripto', MT: 'Monotributo', EX: 'Exento', CF: 'Consumidor Final', NR: 'No categorizado' };

const CONFIG = {
    clients: {
        title: 'Clientes', endpoint: '/clients', write: 'clients:write', label: 'cliente',
        columns: [['Razón social', c => html`<strong>${c.name}</strong>${c.tradeName ? html`<div class="small muted">${c.tradeName}</div>` : ''}`],
            ['CUIT', c => formatCuit(c.cuit)], ['IVA', c => IVA[c.ivaCondition]], ['Contacto', c => c.contacts?.[0] ? `${c.contacts[0].name}${c.contacts[0].position ? ` (${c.contacts[0].position})` : ''}` : c.email],
            ['Teléfono', c => c.phone]],
        party: true,
    },
    suppliers: {
        title: 'Proveedores', endpoint: '/suppliers', write: 'suppliers:write', label: 'proveedor',
        columns: [['Razón social', c => html`<strong>${c.name}</strong>`], ['CUIT', c => formatCuit(c.cuit)], ['Rubro', c => c.category],
            ['Contacto', c => c.contacts?.[0]?.name || c.email], ['Teléfono', c => c.phone]],
        party: true,
    },
    products: {
        title: 'Insumos y stock', endpoint: '/products', write: 'catalog:write', label: 'insumo',
        columns: [['Insumo', p => html`<strong>${p.name}</strong>${p.sku ? html` <span class="small muted">${p.sku}</span>` : ''}`], ['Categoría', p => p.category],
            ['Costo', p => html`<span class="nowrap">${money(p.cost)} / ${p.unit}</span>`, 'num'],
            ['Stock', p => (p.isService ? html`<span class="muted">servicio</span>` : html`<span class="${p.stock < p.minStock ? 'badge bad' : ''}">${num(p.stock)} ${p.unit}</span>`), 'num'],
            ['Act. costo', p => dmy(p.costUpdatedAt)]],
    },
};

export async function render(ctx) {
    const cfg = CONFIG[ctx.path];
    ctx.setTitle(cfg.title);
    if (ctx.can(cfg.write)) ctx.setActions(html`<button class="primary" data-action="new">+ Nuevo ${cfg.label}</button>`);
    setHtml(ctx.root, html`<div class="filters"><input type="search" placeholder="Buscar…" data-search>
        <label class="check"><input type="checkbox" data-active checked> Solo activos</label></div><div data-list></div>`);

    // El costo del insumo lo ve quien maneja plata o compras (dueños, comercial, cobranzas, compras/depósito),
    // no un perfil operativo como Producción/Diseño (que solo tiene catalog:read).
    const canCost = ctx.can('quotes:read') || ctx.can('invoices:read') || ctx.can('payments:read') || ctx.can('purchases:read') || ctx.can('catalog:write');
    const columns = cfg.columns.filter(col => canCost || !['Costo', 'Act. costo'].includes(col[0]));

    let rows = [];
    const load = async () => {
        rows = await api.get(cfg.endpoint, { q: $('[data-search]', ctx.root).value, active: $('[data-active]', ctx.root).checked ? 'true' : '', limit: 2000 });
        setHtml($('[data-list]', ctx.root), html`<p class="small muted">${rows.length}${rows.length >= 2000 ? '+ (afiná con el buscador)' : ''} resultado(s)</p><div class="table-wrap"><table><thead><tr>${columns.map(([h, , c]) => html`<th class="${c || ''}">${h}</th>`)}<th></th></tr></thead>
            <tbody>${rows.length ? rows.map(r => html`<tr class="clickable" data-id="${r._id}">${columns.map(([, fn, c]) => html`<td class="${c || ''}">${fn(r)}</td>`)}
                <td class="right nowrap">${r.active === false ? html`<span class="badge bad">Inactivo</span>` : ''}</td></tr>`)
                : html`<tr><td colspan="9" class="muted">Sin resultados.</td></tr>`}</tbody></table></div>`);
    };
    let t;
    ctx.root.oninput = (e) => { if (e.target.matches('[data-search]')) { clearTimeout(t); t = setTimeout(load, 250); } };
    ctx.root.onchange = (e) => { if (e.target.matches('[data-active]')) load(); };
    ctx.root.onclick = (e) => {
        const tr = e.target.closest('tr[data-id]');
        if (tr) openForm(cfg, ctx, rows.find(r => r._id === tr.dataset.id), load);
    };
    $('#topActions').onclick = (e) => { if (e.target.closest('[data-action=new]')) openForm(cfg, ctx, null, load); };
    await load();
}

function contactRow(c = {}) {
    return html`<tr data-contact><td><input name="c_name" value="${c.name || ''}" placeholder="Nombre" maxlength="120"></td>
        <td><input name="c_position" value="${c.position || ''}" placeholder="Cargo" maxlength="80"></td>
        <td><input name="c_email" type="email" value="${c.email || ''}" maxlength="160"></td>
        <td><input name="c_phone" value="${c.phone || ''}" maxlength="60"></td>
        <td><input type="checkbox" name="c_inv" ${c.receivesInvoices ? raw('checked') : ''} title="Recibe facturas"></td>
        <td><button type="button" class="sm danger" data-remove>✕</button></td></tr>`;
}
function equivRow(e = {}) {
    return html`<tr data-equiv><td><input name="e_unit" value="${e.unit || ''}" placeholder="ej: placa" maxlength="30"></td>
        <td><input name="e_factor" type="number" step="any" min="0" value="${e.factor ?? ''}"></td><td><button type="button" class="sm danger" data-remove>✕</button></td></tr>`;
}

function partyFields(d, cfg) {
    return html`<div class="grid cols-2">
        <div class="field"><label>Razón social *</label><input name="name" required maxlength="200" value="${d.name || ''}"></div>
        <div class="field"><label>Nombre de fantasía</label><input name="tradeName" maxlength="200" value="${d.tradeName || ''}"></div>
        <div class="field"><label>Documento</label><select name="docType">${options(['CUIT', 'DNI', 'SIN'], d.docType || 'CUIT')}</select></div>
        <div class="field"><label>CUIT / DNI</label><div class="row"><input name="cuit" maxlength="13" value="${formatCuit(d.cuit)}" class="spacer">
            <button type="button" class="sm" data-padron title="Traer datos desde ARCA">Consultar ARCA</button></div></div>
        <div class="field"><label>Condición IVA</label><select name="ivaCondition">${options(Object.keys(IVA), d.ivaCondition || 'RI', { label: k => IVA[k] })}</select></div>
        ${cfg.endpoint === '/clients'
        ? html`<div class="field"><label>Plazo de pago (días, vacío = el general)</label><input name="paymentTermDays" type="number" min="0" max="365" data-type="number" value="${d.paymentTermDays ?? ''}"></div>`
        : html`<div class="field"><label>Rubro</label><input name="category" maxlength="80" value="${d.category || ''}"></div>`}
        <div class="field"><label>Domicilio</label><input name="address" maxlength="300" value="${d.address || ''}"></div>
        <div class="field"><label>Localidad</label><input name="city" maxlength="100" value="${d.city || ''}"></div>
        <div class="field"><label>Provincia</label><input name="province" maxlength="100" value="${d.province || ''}"></div>
        <div class="field"><label>Teléfono</label><input name="phone" maxlength="60" value="${d.phone || ''}"></div>
        <div class="field"><label>Email</label><input name="email" type="email" maxlength="160" value="${d.email || ''}"></div>
        <div class="field"><label class="check"><input type="checkbox" name="active" ${d.active === false ? '' : raw('checked')}> Activo</label></div>
    </div>
    <h3>Contactos</h3>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Nombre</th><th>Cargo</th><th>Email</th><th>Teléfono</th><th title="Recibe facturas">Fact.</th><th></th></tr></thead>
    <tbody data-contacts>${(d.contacts || []).map(contactRow)}</tbody></table></div>
    <button type="button" class="sm mt" data-add-contact>+ Contacto</button>
    <div class="field mt"><label>Notas</label><textarea name="notes" maxlength="2000">${d.notes || ''}</textarea></div>`;
}

function productFields(d) {
    return html`<div class="grid cols-2">
        <div class="field"><label>Nombre *</label><input name="name" required maxlength="200" value="${d.name || ''}"></div>
        <div class="field"><label>Código / SKU</label><input name="sku" maxlength="60" value="${d.sku || ''}"></div>
        <div class="field"><label>Categoría</label><input name="category" maxlength="80" value="${d.category || 'General'}"></div>
        <div class="field"><label>Unidad de stock *</label><input name="unit" required maxlength="30" value="${d.unit || 'unidad'}" placeholder="m2, metro, unidad, litro…"></div>
        <div class="field"><label>Costo por unidad (sin IVA)</label><input name="cost" type="number" step="0.01" min="0" data-type="number" value="${d.cost ?? 0}"></div>
        <div class="field"><label>Stock mínimo</label><input name="minStock" type="number" step="any" min="0" data-type="number" value="${d.minStock ?? 0}"></div>
        <div class="field"><label class="check"><input type="checkbox" name="isService" ${d.isService ? raw('checked') : ''}> Es un servicio / tercerizado (no lleva stock)</label></div>
        <div class="field"><label class="check"><input type="checkbox" name="active" ${d.active === false ? '' : raw('checked')}> Activo</label></div>
    </div>
    <h3>Equivalencias de compra</h3><p class="small muted">Ej.: 1 "placa" = 2,97 m2. Se usan al cargar compras.</p>
    <div class="table-wrap"><table class="lines"><thead><tr><th>Unidad de compra</th><th>Equivale a (unidades de stock)</th><th></th></tr></thead>
    <tbody data-equivs>${(d.equivalences || []).map(equivRow)}</tbody></table></div>
    <button type="button" class="sm mt" data-add-equiv>+ Equivalencia</button>
    ${d._id ? html`<h3>Movimientos de stock</h3><div data-movs class="muted small">Cargando…</div>` : ''}`;
}

async function openForm(cfg, ctx, doc, reload) {
    const d = doc ? await api.get(`${cfg.endpoint}/${doc._id}`) : {};
    const editable = ctx.can(cfg.write);
    const isProduct = cfg.endpoint === '/products';
    const footer = html`
        ${d._id && cfg.endpoint === '/clients' && ctx.can('payments:read') ? html`<button type="button" data-statement>Cuenta corriente</button>` : ''}
        ${d._id && isProduct && ctx.can('stock:adjust') && !d.isService ? html`<button type="button" data-adjust>Ajustar stock</button>` : ''}
        <span class="spacer"></span><button type="button" data-close>Cerrar</button>
        ${editable ? html`<button class="primary" type="submit" form="entityForm">Guardar</button>` : ''}`;
    const m = modal({
        title: d._id ? d.name : `Nuevo ${cfg.label}`, wide: true,
        body: html`<form id="entityForm">${isProduct ? productFields(d) : partyFields(d, cfg)}</form>`, footer,
    });
    const form = m.el.querySelector('form');
    if (!editable) $$('input,select,textarea', form).forEach(i => { i.disabled = true; });

    if (isProduct && d._id) {
        api.get(`/products/${d._id}/movements`).then(movs => setHtml($('[data-movs]', m.el), movs.length ? html`<div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Cantidad</th><th class="num">Costo u.</th><th>Referencia</th><th>Usuario</th></tr></thead>
            <tbody>${movs.map(x => html`<tr><td>${dmyhm(x.date)}</td><td>${x.type}</td><td class="num">${num(x.quantity)}</td><td class="num">${money(x.unitCost)}</td>
            <td>${x.workOrder?.number || x.purchase?.number || ''} ${x.note}</td><td>${x.user?.name || ''}</td></tr>`)}</tbody></table></div>` : 'Sin movimientos.')).catch(showError);
    }

    m.el.addEventListener('click', async (e) => {
        if (e.target.closest('[data-remove]')) e.target.closest('tr').remove();
        if (e.target.closest('[data-add-contact]')) $('[data-contacts]', m.el).insertAdjacentHTML('beforeend', String(contactRow()));
        if (e.target.closest('[data-add-equiv]')) $('[data-equivs]', m.el).insertAdjacentHTML('beforeend', String(equivRow()));
        if (e.target.closest('[data-padron]')) {
            const cuit = form.cuit.value.replace(/\D/g, '');
            await withBusy(e.target, async () => {
                const p = await api.get(`/padron/${cuit}`);
                form.name.value = p.name; form.ivaCondition.value = p.ivaCondition;
                form.address.value = p.address; form.city.value = p.city; form.province.value = p.province;
                toast(p.warning ? `Datos traídos. Aviso de ARCA: ${p.warning}` : 'Datos traídos de ARCA.', p.warning ? '' : 'ok');
            });
        }
        if (e.target.closest('[data-statement]')) { m.close(); statement(d); }
        if (e.target.closest('[data-adjust]')) {
            const qty = prompt(`Cantidad a sumar (o restar con signo -) en ${d.unit}:`);
            if (!qty) return;
            const note = await confirmDialog(`Ajustar stock de "${d.name}" en ${qty} ${d.unit}`, { input: 'Motivo del ajuste' });
            if (!note) return;
            try { await api.post(`/products/${d._id}/adjust`, { quantity: Number(qty.replace(',', '.')), note }); toast('Stock ajustado.', 'ok'); m.close(); reload(); } catch (err) { showError(err); }
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = readForm(form);
        for (const k of Object.keys(data)) if (/^[ce]_/.test(k)) delete data[k];
        if (!isProduct) {
            data.cuit = (data.cuit || '').replace(/\D/g, '');
            data.contacts = $$('[data-contact]', form).map(tr => ({
                name: $('[name=c_name]', tr).value.trim(), position: $('[name=c_position]', tr).value.trim(),
                email: $('[name=c_email]', tr).value.trim(), phone: $('[name=c_phone]', tr).value.trim(), receivesInvoices: $('[name=c_inv]', tr).checked,
            })).filter(c => c.name);
            if (cfg.endpoint === '/clients' && data.paymentTermDays === undefined) data.paymentTermDays = null;
        } else {
            data.equivalences = $$('[data-equiv]', form).map(tr => ({ unit: $('[name=e_unit]', tr).value.trim(), factor: Number($('[name=e_factor]', tr).value) }))
                .filter(x => x.unit && x.factor > 0);
        }
        try {
            if (d._id) await api.put(`${cfg.endpoint}/${d._id}`, data); else await api.post(cfg.endpoint, data);
            toast('Guardado.', 'ok');
            m.close();
            reload();
        } catch (err) { showError(err); }
    });
}

export async function statement(client) {
    const st = await api.get(`/clients/${client._id}/statement`);
    modal({
        title: `Cuenta corriente · ${st.client.name}`, wide: true,
        body: html`<div class="row between"><span class="muted">CUIT ${formatCuit(st.client.cuit)}</span><strong>Saldo: ${money(st.balance)}</strong></div>
        <div class="table-wrap mt"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Referencia</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead>
        <tbody>${st.rows.length ? st.rows.map(r => html`<tr><td>${dmy(r.date)}</td><td>${r.type}</td><td>${r.reference}</td>
            <td class="num">${r.debit ? money(r.debit) : ''}</td><td class="num">${r.credit ? money(r.credit) : ''}</td><td class="num">${money(r.balance)}</td></tr>`)
        : html`<tr><td colspan="6" class="muted">Sin movimientos.</td></tr>`}</tbody></table></div>`,
        footer: html`<button type="button" data-print>Imprimir</button><button type="button" data-close>Cerrar</button>`,
        onOpen: (el) => el.querySelector('[data-print]').addEventListener('click', () => window.print()),
    });
}
