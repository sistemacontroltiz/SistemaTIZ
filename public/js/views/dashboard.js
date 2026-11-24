// Inicio: indicadores para quien tiene estadísticas; accesos rápidos para el resto.
import { api } from '../api.js';
import { html, setHtml, $, money, num, dmy, addDays, today, light, badge } from '../dom.js';

const STATUS_ORDER = ['Pendiente', 'Diseño', 'Producción', 'Calidad', 'Colocación', 'Lista para entrega'];

export async function render(ctx) {
    ctx.setTitle(`Hola, ${ctx.user.name.split(' ')[0]}`);
    if (!ctx.can('stats:read')) return quick(ctx);
    setHtml(ctx.root, html`<div class="filters"><label class="mb0">Período</label><input type="date" data-from value="${addDays(-30)}"><input type="date" data-to value="${today()}"></div><div data-body></div>`);
    const load = async () => {
        const s = await api.get('/stats/summary', { from: $('[data-from]', ctx.root).value, to: `${$('[data-to]', ctx.root).value}T23:59:59` });
        setHtml($('[data-body]', ctx.root), body(s));
    };
    ctx.root.onchange = load;
    await load();
}

function kpi(label, value, sub = '') {
    return html`<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function bars(entries) {
    const max = Math.max(1, ...entries.map(([, v]) => v));
    const W = 420; const h = 24;
    return html`<svg class="bars" viewBox="0 0 ${W} ${entries.length * h}" width="100%" role="img" aria-label="Gráfico">
        ${entries.map(([label, v], i) => html`<text x="0" y="${i * h + 15}">${label}</text><rect class="bar" x="130" y="${i * h + 5}" height="12" width="${Math.max(2, (v / max) * (W - 180))}"></rect>
        <text x="${W - 40}" y="${i * h + 15}">${v}</text>`)}</svg>`;
}

function body(s) {
    const c = s.commercial; const o = s.operations; const b = s.billing;
    return html`
        <h2>Comercial</h2><div class="grid cols-4">
            ${kpi('Presupuestos emitidos', c.quotes, money(c.quotedAmount))}
            ${kpi('Aprobados', c.approved, money(c.approvedAmount))}
            ${kpi('Tasa de aprobación', c.conversionPct === null ? '-' : `${c.conversionPct}%`, 'sobre aprobados + rechazados')}
            ${kpi('Pendientes de respuesta', c.pending)}</div>
        <h2 class="mt">Producción y entregas</h2><div class="grid cols-4">
            ${kpi('OT activas', o.active, html`<span class="dot vencida"></span>${o.lights.vencida || 0} vencidas · <span class="dot proxima"></span>${o.lights.proxima || 0} por vencer`)}
            ${kpi('Entregadas en el período', o.delivered)}
            ${kpi('Entregas a tiempo', o.onTimePct === null ? '-' : `${o.onTimePct}%`)}
            ${kpi('Colocaciones próximos 7 días', o.installationsNext7Days, `Tareas abiertas: ${(o.openTasks.Pendiente || 0) + (o.openTasks['En progreso'] || 0)}`)}</div>
        <div class="grid cols-2 mt"><div class="card"><h2>OT activas por estado</h2>${bars(STATUS_ORDER.map(st => [st, o.byStatus[st] || 0]))}</div>
            <div class="card"><h2>OT vencidas</h2>${o.overdue.length ? html`<table><tbody>${o.overdue.map(w => html`<tr><td><a href="#/workorders/${w._id}">${w.number}</a></td><td>${w.clientName}</td>
            <td>${badge(w.status)}</td><td>${dmy(w.dueDate)}</td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguna. ${light('en-termino')}</p>`}</div></div>
        <h2 class="mt">Facturación y cobranza</h2><div class="grid cols-4">
            ${kpi('Facturado (neto de NC)', money(b.invoicedTotal), `Neto gravado ${money(b.invoicedNet)}`)}
            ${kpi('Cobrado', money(b.collected), `+ retenciones ${money(b.withholdings)}`)}
            ${kpi('Por cobrar', money(b.receivable), 'facturas emitidas impagas')}
            ${kpi('Saldo de obra por cobrar', money(b.workReceivable), 'valor OT − cobrado (incluye sin facturar)')}
            ${kpi('Vencido', money(b.overdue))}</div>
        <div class="grid cols-2 mt"><div class="card"><h2>Mayores deudores</h2>${b.topDebtors.length ? html`<table><tbody>${b.topDebtors.map(d => html`<tr><td>${d.clientName}</td><td class="num">${money(d.balance)}</td>
            <td class="num">${d.overdue ? html`<span class="badge bad">${money(d.overdue)} vencido</span>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin saldos.</p>`}</div>
            <div class="card"><h2>Mejores clientes (aprobado)</h2>${s.topClients.length ? html`<table><tbody>${s.topClients.map(t => html`<tr><td>${t.name}</td><td class="num">${money(t.total)}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin datos.</p>`}</div></div>
        <div class="card mt"><h2>Margen previsto vs. real (OT entregadas)</h2>${s.margins.length ? html`<div class="table-wrap"><table><thead><tr><th>OT</th><th>Cliente</th><th class="num">Neto</th>
            <th class="num">Costo previsto</th><th class="num">Costo real</th><th class="num">Margen previsto</th><th class="num">Margen real</th></tr></thead>
            <tbody>${s.margins.map(m => html`<tr><td>${m.number}</td><td>${m.clientName}</td><td class="num">${money(m.net)}</td><td class="num">${money(m.plannedCost)}</td><td class="num">${money(m.realCost)}</td>
            <td class="num">${m.plannedMarginPct ?? '-'}%</td><td class="num">${m.realMarginPct === null ? html`<span class="muted">sin costos cargados</span>` : html`<span class="${m.realMarginPct < m.plannedMarginPct ? 'badge bad' : 'badge ok'}">${m.realMarginPct}%</span>`}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">No hay OT entregadas en el período.</p>`}</div>
        ${s.lowStock.length ? html`<div class="card"><h2>Insumos bajo stock mínimo</h2><table><tbody>${s.lowStock.map(p => html`<tr><td>${p.name}</td><td class="num">${num(p.stock)} / ${num(p.minStock)} ${p.unit}</td></tr>`)}</tbody></table></div>` : ''}`;
}

async function quick(ctx) {
    const blocks = [];
    if (ctx.can('production:read')) {
        const tasks = await api.get('/tasks');
        const open = tasks.filter(t => t.status !== 'Completada');
        blocks.push(html`<div class="kpi"><div class="label">Tareas abiertas de tu sector</div><div class="value">${open.length}</div>
            <div class="sub">${open.filter(t => t.status === 'En progreso').length} en progreso · <a href="#/production">Ir a producción</a></div></div>`);
    }
    if (ctx.can('installations:own', 'installations:read')) {
        const list = await api.get('/installations', { status: 'Programada', from: today(), to: `${addDays(7)}T23:59:59` });
        blocks.push(html`<div class="kpi"><div class="label">Colocaciones próximos 7 días</div><div class="value">${list.length}</div><div class="sub"><a href="#/installations">Ver agenda</a></div></div>`);
    }
    if (ctx.can('quality:read')) {
        const pending = await api.get('/quality/pending');
        blocks.push(html`<div class="kpi"><div class="label">OT esperando control de calidad</div><div class="value">${pending.length}</div><div class="sub"><a href="#/quality">Ir a calidad</a></div></div>`);
    }
    if (ctx.can('purchases:read')) blocks.push(html`<div class="kpi"><div class="label">Compras</div><div class="value">→</div><div class="sub"><a href="#/purchases/new">Registrar compra</a></div></div>`);
    setHtml(ctx.root, blocks.length ? html`<div class="grid cols-3">${blocks}</div>` : html`<div class="card">Elegí una opción del menú.</div>`);
}
