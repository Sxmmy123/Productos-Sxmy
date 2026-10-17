import { escapeHtml, formatMoney, getSalesPage } from "../../core/data-cache.js?v=2";
import { getUsers } from "../../shared/services/user-service.js";
import { saleDateRange } from "../../shared/services/sales-domain.js";
import { rememberControls } from "../../core/view-state.js";
import { printSaleNote } from "../../shared/sale-note/renderer.js?v=9";

const byId = (id) => document.getElementById(id);
const salesList = byId("salesList"), salesSummary = byId("salesSummary");
const salesSearch = byId("salesSearch"), salesDateFilter = byId("salesDateFilter");
const salesSeller = byId("salesSeller"), salesFrom = byId("salesFrom"), salesTo = byId("salesTo");
const previous = byId("salesPrevious"), next = byId("salesNext");
let pages = [], pageIndex = 0, revision = 0, busy = false, timer;
let sellers = new Map();

function updateSellers(sales = []) {
    const selected = salesSeller.value;
    sales.forEach((sale) => { if (sale.vendedorUid) sellers.set(sale.vendedorUid, sale.vendedorNombre); });
    salesSeller.innerHTML = '<option value="">Todos los vendedores</option>' + [...sellers].map(([uid, name]) =>
        '<option value="' + escapeHtml(uid) + '">' + escapeHtml(name) + '</option>').join("");
    salesSeller.value = selected;
}

function filters() {
    const range = saleDateRange(salesDateFilter.value, salesFrom.value, salesTo.value);
    const text = salesSearch.value.trim().toLowerCase();
    return { ...range, seller: salesSeller.value, number: /^\d{4,}$/.test(text) ? text : "", text };
}

function matches(sale, text) {
    if (!text) return true;
    return [sale.numero, sale.cliente, sale.vendedorNombre, ...sale.items.flatMap((item) => [item.codigo, item.nombre])]
        .some((value) => String(value || "").toLowerCase().includes(text));
}

function renderSales() {
    const page = pages[pageIndex];
    const sales = page?.sales || [];
    const income = sales.reduce((sum, sale) => sum + sale.total, 0);
    salesSummary.textContent = sales.length + " ventas en esta pagina · " + formatMoney(income) + " Bs";
    byId("salesPageLabel").textContent = "Pagina " + (pageIndex + 1);
    previous.disabled = busy || pageIndex === 0;
    next.disabled = busy || (!page?.hasMore && pageIndex === pages.length - 1);
    if (!sales.length) {
        salesList.innerHTML = '<div class="empty-row">No hay coincidencias en esta pagina.' + (page?.hasMore ? ' Continua con Siguiente.' : '') + '</div>';
        return;
    }
    salesList.innerHTML = '<div class="sales-table"><div class="sales-table-head"><span>Nota</span><span>Cliente</span><span>Productos</span><span>Vendedor</span><span>Fecha</span><span>Total</span><span></span></div>' +
        sales.map((sale) => `
            <article class="sale-card" data-sale-card="${escapeHtml(sale.id)}">
                <button class="sale-card-head sales-row-grid" data-sale-toggle="${escapeHtml(sale.id)}" type="button" aria-expanded="false" aria-controls="detail-${escapeHtml(sale.id)}">
                    <span class="sale-number">${escapeHtml(sale.numero || sale.numeroVista || "Sin numero")}</span>
                    <span class="sale-customer">${escapeHtml(sale.cliente)}</span>
                    <span class="sale-count">${sale.items.length} productos</span>
                    <span class="sale-seller">${escapeHtml(sale.vendedorNombre)}</span>
                    <span class="sale-date">${escapeHtml(sale.fechaTexto)}</span>
                    <strong class="sale-amount">${formatMoney(sale.total)} Bs</strong>
                    <span class="sale-chevron" aria-hidden="true">⌄</span>
                </button>
                <div id="detail-${escapeHtml(sale.id)}" class="sale-detail" hidden>
                    <div class="sale-detail-top">
                        <div class="sale-detail-data"><span>Telefono: ${escapeHtml(sale.telefono || "Sin telefono")}</span><span>Direccion: ${escapeHtml(sale.direccion || "Sin direccion")}</span><span>Pago: ${escapeHtml(sale.metodoPago)}</span></div>
                        <button class="btn-light" data-sale-print="${escapeHtml(sale.id)}" type="button">Imprimir</button>
                    </div>
                    <div class="sale-items"><table><thead><tr><th>Cod.</th><th>Producto</th><th>Cant.</th><th>Unitario</th><th>Subtotal</th></tr></thead>
                        <tbody>${sale.items.map((item) => `<tr><td>${escapeHtml(item.codigo)}</td><td>${escapeHtml(item.nombre)}</td><td>${item.cantidad}</td><td>${formatMoney(item.precio)} Bs</td><td>${formatMoney(item.subtotal)} Bs</td></tr>`).join("")}</tbody>
                    </table></div>
                    <div class="sale-totals-line"><span>Subtotal: ${formatMoney(sale.subtotal)} Bs</span><span>Descuento: ${formatMoney(sale.descuento)} Bs</span><strong>Total: ${formatMoney(sale.total)} Bs</strong></div>
                </div>
            </article>`).join("") + "</div>";
}

async function loadPage(reset = false) {
    const token = ++revision;
    busy = true;
    byId("historyStatus").textContent = "Cargando ventas...";
    if (reset) { pages = []; pageIndex = 0; }
    renderSales();
    try {
        const criteria = filters();
        let cursor = reset ? null : pages.at(-1)?.cursor;
        let result;
        const found = [];
        // Search within bounded batches so a long history never blocks the screen.
        for (let batch = 0; batch < 4; batch++) {
            result = await getSalesPage({ ...criteria, cursor, pageSize: 25 });
            if (token !== revision) return;
            updateSellers(result.sales);
            found.push(...result.sales.filter((sale) => criteria.number || matches(sale, criteria.text)));
            cursor = result.cursor;
            if (found.length || !result.hasMore || !criteria.text) break;
        }
        pages.push({ ...result, sales: found });
        pageIndex = pages.length - 1;
        byId("historyStatus").textContent = "";
    } catch (error) {
        if (token !== revision) return;
        byId("historyStatus").textContent = error.code === "failed-precondition"
            ? "Este filtro necesita un indice de Firestore. Consulta firebase/firestore.indexes.json."
            : (error.message || "No se pudo cargar el historial.");
    } finally {
        if (token === revision) { busy = false; renderSales(); }
    }
}

salesSearch.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => loadPage(true), 300); });
[salesDateFilter, salesSeller, salesFrom, salesTo].forEach((field) => field.addEventListener("change", () => {
    byId("salesCustomDates").hidden = salesDateFilter.value !== "custom";
    loadPage(true);
}));
previous.addEventListener("click", () => { if (!busy && pageIndex > 0) { pageIndex--; renderSales(); } });
next.addEventListener("click", () => {
    if (busy) return;
    if (pageIndex < pages.length - 1) { pageIndex++; renderSales(); }
    else loadPage();
});
salesList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-sale-toggle]");
    if (toggle) {
        const detail = byId(toggle.getAttribute("aria-controls"));
        detail.hidden = !detail.hidden;
        toggle.setAttribute("aria-expanded", String(!detail.hidden));
        return;
    }
    const button = event.target.closest("[data-sale-print]");
    const sale = pages[pageIndex]?.sales.find((item) => item.id === button?.dataset.salePrint);
    if (sale) printSaleNote(sale, byId("salePrintArea"));
});

export async function initialize({ user }) {
    sellers.set(user.uid, user.email || "Mi usuario");
    try { (await getUsers()).forEach((user) => sellers.set(user.uid, user.nombre)); } catch { /* Sellers are also collected from visible sales. */ }
    updateSellers();
    rememberControls(user.uid, "historial", ["salesSearch", "salesDateFilter", "salesSeller", "salesFrom", "salesTo"]);
    byId("salesCustomDates").hidden = salesDateFilter.value !== "custom";
    await loadPage(true);
}
export const refresh = () => loadPage(true);
