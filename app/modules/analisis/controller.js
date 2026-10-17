import { escapeHtml, formatMoney, getProducts, getSales } from "../../core/data-cache.js?v=2";
import { localDateKey, saleDateRange, summarizeSales } from "../../shared/services/sales-domain.js";
import { rememberControls } from "../../core/view-state.js";

const el = (id) => document.getElementById(id);
let revision = 0;
const dateFilter = el("analysisDateFilter"), from = el("analysisFrom"), to = el("analysisTo");

function renderRank(items, media = false) {
    if (!items.length) return '<div class="empty-row">Sin ventas en este periodo.</div>';
    const max = Math.max(1, ...items.map((item) => media ? item.cantidad : item.total));
    return '<div class="analysis-leaderboard">' + items.slice(0, media ? 10 : 14).map((item, index) => {
        const percent = ((media ? item.cantidad : item.total) / max) * 100;
        const image = media && item.imagenUrl
            ? '<img class="analysis-leader-image" loading="lazy" src="' + escapeHtml(item.imagenUrl) + '" alt="">'
            : '<span class="analysis-leader-code">' + escapeHtml(media ? item.codigo || "--" : item.nombre.slice(8)) + '</span>';
        const name = media || item.nombre === "Sin fecha" ? item.nombre : new Date(item.nombre + "T12:00:00").toLocaleDateString("es-BO", { weekday: "short", day: "numeric", month: "short" });
        return `<article class="analysis-leader-row" style="--rank:${percent}%">
            <span class="analysis-leader-number">${index + 1}</span>
            <div class="analysis-leader-media">${image}${media ? '<small>' + escapeHtml(item.codigo || "") + '</small>' : ''}</div>
            <div class="analysis-leader-track">
                <i class="analysis-leader-fill" aria-hidden="true"></i>
                <strong class="analysis-leader-name">${escapeHtml(name)}</strong>
                <div class="analysis-leader-values">${media ? '<span class="analysis-leader-units">' + item.cantidad + ' unid.</span>' : ''}
                    <span class="analysis-leader-total">${formatMoney(item.total)} Bs</span>
                </div>
            </div>
            <span class="analysis-leader-percent">${Math.round(percent)}%</span>
        </article>`;
    }).join("") + "</div>";
}

async function loadAnalysis() {
    const token = ++revision;
    el("analysisStatus").textContent = "Calculando...";
    try {
        const range = saleDateRange(dateFilter.value, from.value, to.value);
        if (dateFilter.value === "custom" && (!range.start || !range.end)) throw new Error("Selecciona ambas fechas para comparar periodos.");
        let previous = Promise.resolve([]);
        if (range.start && range.end) {
            const duration = range.end - range.start;
            previous = getSales({ start: new Date(range.start - duration), end: range.start });
        }
        const [products, sales, previousSales] = await Promise.all([getProducts(), getSales(dateFilter.value === "all" ? {} : range), previous]);
        if (token !== revision) return;
        const summary = summarizeSales(sales, products), earlier = summarizeSales(previousSales);
        el("metricSales").textContent = sales.length;
        el("metricIncome").textContent = formatMoney(summary.income) + " Bs";
        el("metricUnits").textContent = summary.units;
        el("metricCash").textContent = formatMoney(summary.cash) + " Bs";
        el("metricTransfer").textContent = formatMoney(summary.transfer) + " Bs";
        el("metricTop").textContent = summary.products[0]?.nombre || "Sin ventas";
        el("metricToday").textContent = formatMoney(summary.days.find((day) => day.nombre === localDateKey(new Date()))?.total || 0) + " Bs";
        el("metricComparison").textContent = dateFilter.value === "all" ? "--" : earlier.income
            ? ((summary.income - earlier.income) / earlier.income * 100).toFixed(1) + "%"
            : "Sin ventas previas";
        el("analysisPeriod").textContent = range.start && range.end
            ? range.start.toLocaleDateString("es-BO") + " - " + new Date(range.end - 1).toLocaleDateString("es-BO")
            : "Todas las fechas";
        el("topProducts").innerHTML = renderRank(summary.products, true);
        el("salesByDay").innerHTML = renderRank(summary.days);
        el("analysisStatus").textContent = "";
    } catch (error) {
        if (token === revision) el("analysisStatus").textContent = error.message || "No se pudo cargar el analisis.";
    }
}

[dateFilter, from, to].forEach((field) => field.addEventListener("change", () => {
    el("analysisCustomDates").hidden = dateFilter.value !== "custom";
    loadAnalysis();
}));
export async function initialize({ user }) {
    rememberControls(user.uid, "analisis", ["analysisDateFilter", "analysisFrom", "analysisTo"]);
    el("analysisCustomDates").hidden = dateFilter.value !== "custom";
    await loadAnalysis();
}
export { loadAnalysis as refresh };
