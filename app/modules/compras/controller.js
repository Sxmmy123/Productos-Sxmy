import { getProducts, invalidateProducts, escapeHtml, formatMoney } from "../../core/data-cache.js?v=2";
import { interpretPurchaseList, registerPurchase, getPurchasesPage, applyPurchaseInventory, createPurchaseProduct, generatePurchaseProduct, getPurchasePackageMemory } from "../../shared/services/purchase-service.js?v=7";
import { normalizeName, rowAmounts, purchaseSummary, attachInventory, suggestedSalePrice, buildPurchase, isPackage, inventoryUnitPrice, comparisonState, suggestNewSalePrice, purchaseRow, buildInventoryUpdate, candidateProducts, setUnitPrice } from "./domain.js?v=5";
import { rememberPackages, packageCandidates, choosePackage } from "./package-memory.js?v=1";

const el = id => document.getElementById(id);
const money = value => value == null ? "--" : formatMoney(value);
const icon = name => `<svg class="purchase-icon" aria-hidden="true"><use href="assets/icons/compras.svg#${name}"/></svg>`;
const dialogs = ["purchaseMatchDialog", "purchaseConfirmDialog", "purchaseDiscardDialog", "purchaseReinterpretDialog", "purchaseInventoryDialog", "purchaseNewProductDialog"].map(el);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
let rows = [], products = [], userId = "", busy = false, matchId = "", newRowId = "";
let detailsBusy = false, detailsRevision = 0;
const detailRequests = new Map();
let packageMemory = [], packageLoading = null;
const withHistory = values => rememberPackages(values, packageMemory, el("purchaseUsePackageHistory").checked);
const compareRows = values => attachInventory(withHistory(values), products);
let pending = null, pendingInventory = null, pendingNew = null, inventoryPreview = null;
let pages = [], pageIndex = 0, historyBusy = false, historyRevision = 0;
let interpretation = { avisos: [], totalDeclarado: null }, parsedText = "", draftId = crypto.randomUUID();
const frozen = () => Boolean(pending || pendingInventory || pendingNew);
const draftKey = () => `sxmy-purchase-draft:${userId}`;
function status(message, error = false, modal = false) {
    const target = el(modal ? "purchaseConfirmStatus" : "purchaseStatus");
    target.textContent = message || ""; target.dataset.error = String(error);
}
function persist() {
    if (!userId) return;
    try { localStorage.setItem(draftKey(), JSON.stringify({ version: 2, rows, pending, pendingInventory, pendingNew, interpretation, parsedText, draftId, usePackageHistory: el("purchaseUsePackageHistory").checked,
        texto: el("purchaseText").value, proveedor: el("purchaseSupplier").value, fecha: el("purchaseDate").value })); }
    catch { status("No se pudo guardar el borrador. No cierres la pagina.", true); }
}
function restore() {
    el("purchaseDate").value = today();
    try {
        const saved = JSON.parse(localStorage.getItem(draftKey()) || "null");
        if (!saved) return;
        el("purchaseUsePackageHistory").checked = saved.usePackageHistory !== false;
        if (Array.isArray(saved.rows) && saved.rows.length <= 200) rows = saved.rows.filter(row => row && typeof row.id === "string" && typeof row.nombre === "string").map(row => ({ ...row, tipoPrecio: row.tipoPrecio === "unitario" ? "unitario" : "total" }));
        el("purchaseText").value = String(saved.texto || "").slice(0, 16000);
        el("purchaseSupplier").value = String(saved.proveedor || "").slice(0, 160);
        el("purchaseDate").value = saved.fecha || today();
        interpretation = saved.interpretation || interpretation; parsedText = saved.parsedText || "";
        pending = saved.pending?.requestId && saved.pending?.items?.length ? saved.pending : null;
        pendingInventory = saved.pendingInventory?.requestId && saved.pendingInventory?.items?.length ? saved.pendingInventory : null;
        pendingInventory?.items.forEach(item => { item.cambiarVenta ??= Number(item.precioVenta) !== Number(item.expectedVenta); });
        pendingNew = saved.pendingNew?.requestId && saved.pendingNew?.rowId ? saved.pendingNew : null;
        draftId = pending?.requestId || saved.draftId || draftId;
        status(frozen() ? "Hay una operacion pendiente. Confirma el resultado sin volver a crearla." : rows.length ? "Borrador recuperado." : "");
    } catch { status("No se pudo recuperar el borrador.", true); }
}
async function loadPackageMemory(force = false) {
    if (!el("purchaseUsePackageHistory").checked) return;
    if (packageLoading) return packageLoading;
    el("purchasePackageStatus").textContent = "Consultando historial...";
    packageLoading = (async () => {
        try {
            packageMemory = await getPurchasePackageMemory(force);
            el("purchasePackageStatus").textContent = packageMemory.length ? "" : "Sin empaques registrados";
            if (!busy && !frozen()) { rows = compareRows(rows); renderRows(); persist(); }
        } catch { el("purchasePackageStatus").textContent = "Historial no disponible. Puedes escribir las unidades."; }
        finally { packageLoading = null; }
    })();
    return packageLoading;
}
function lock() {
    el("purchaseEditor").querySelectorAll("input, textarea, button, select").forEach(node => { node.disabled = busy || frozen(); });
    el("purchaseRefresh").disabled = busy || frozen();
    el("purchaseReviewSave").disabled = busy || Boolean(pendingInventory || pendingNew) || !rows.some(row => row.incluir);
    el("purchaseReviewSave").textContent = pending ? "Confirmar registro" : "Registrar compra";
    const selected = rows.filter(row => row.incluir && row.actualizar).length;
    el("purchaseApplyInventory").disabled = busy || Boolean(pending) || !(pendingInventory || pendingNew || selected);
    el("purchaseApplyInventory").textContent = pendingNew ? "Confirmar producto" : pendingInventory ? "Confirmar cambios" : `Aplicar al inventario${selected ? ` (${selected})` : ""}`;
    for (const row of rows) {
        const tr = el("purchaseRows").querySelector(`[data-purchase-row="${CSS.escape(row.id)}"]`);
        if (!tr) continue;
        const selected = row.incluir && row.actualizar;
        const sale = tr.querySelector('[data-field="precioVenta"]');
        if (sale) sale.disabled = busy || frozen() || !selected || !row.cambiarVenta;
        const margin = tr.querySelector("[data-margin]");
        if (margin) margin.disabled = busy || frozen() || !selected || !row.cambiarVenta || suggestedSalePrice(row) == null;
        const checkbox = tr.querySelector('[data-field="actualizar"]');
        if (checkbox) checkbox.disabled = busy || frozen() || !row.incluir;
        const create = tr.querySelector("[data-create]");
        if (create) create.disabled = busy || frozen() || !row.incluir || inventoryUnitPrice(row) == null;
        const unitInput = tr.querySelector('[data-field="unitPrice"]');
        if (unitInput) unitInput.disabled = busy || frozen() || Boolean(isPackage(row.unidad) && !row.unidadesPorPaquete);
    }
    dialogs.forEach(dialog => dialog.querySelectorAll("button, input, textarea").forEach(node => { node.disabled = busy; }));
    el("purchaseNewName").readOnly = Boolean(pendingNew) || detailsBusy;
    el("purchaseNewDescription").readOnly = Boolean(pendingNew) || detailsBusy;
    el("purchaseNewSale").readOnly = Boolean(pendingNew);
    el("purchaseConfirmNewProduct").disabled = busy || detailsBusy;
}
function comparison(row) {
    const state = comparisonState(row);
    if (state.kind === "same") return '<span class="purchase-state purchase-same">Sin cambios</span>';
    if (state.kind === "new") return '<span class="purchase-state purchase-new">Producto nuevo</span>';
    if (["match", "package", "incomplete"].includes(state.kind)) return "";
    return `<span class="purchase-state ${state.kind === "up" ? "purchase-rise" : "purchase-fall"}">${state.kind === "up" ? "Subio precio" : "Bajo precio"}</span>`;
}
function inventoryControls(row, index) {
    const state = comparisonState(row);
    if (!row.confirmado) return `<button data-create="${escapeHtml(row.id)}" class="btn-light purchase-create" type="button">Registrar producto</button>`;
    if (!["up", "down"].includes(state.kind)) return "";
    return `<label class="purchase-update-label"><input data-field="actualizar" type="checkbox" ${row.actualizar ? "checked" : ""} aria-label="Actualizar fila ${index + 1}"> Actualizar</label>
        <div class="purchase-sale-options" ${row.actualizar ? "" : "hidden"}><label class="purchase-update-label"><input data-field="cambiarVenta" type="checkbox" role="switch" ${row.cambiarVenta ? "checked" : ""} aria-label="Cambiar precio de venta fila ${index + 1}"> Cambiar precio de venta</label>
        <div class="purchase-sale-controls" ${row.cambiarVenta ? "" : "hidden"}><label class="purchase-sale-label">Venta Bs<input data-field="precioVenta" class="form-field" type="number" min="0" step="0.01" inputmode="decimal" value="${row.precioVenta ?? ""}" aria-label="Precio venta fila ${index + 1}"></label><button data-margin="${escapeHtml(row.id)}" class="purchase-margin" type="button" title="Proponer venta con el margen actual">Sugerir con margen actual</button></div></div>`;
}
function unitMarkup(row, index) {
    const unit = inventoryUnitPrice(row), state = comparisonState(row);
    return `<input data-field="unitPrice" class="form-field purchase-unit-price" type="number" min="0" max="10000000" step="0.01" inputmode="decimal" value="${unit ?? ""}" ${isPackage(row.unidad) && !row.unidadesPorPaquete ? 'disabled placeholder="--"' : ""} aria-label="Compra unitaria fila ${index + 1}">
        ${["up", "down"].includes(state.kind) ? `<span class="purchase-delta ${state.kind === "up" ? "purchase-rise" : "purchase-fall"}">${icon(state.kind === "up" ? "arrow-up" : "arrow-down")}<strong>${state.delta > 0 ? "+" : "-"}${money(Math.abs(state.delta))} Bs</strong></span><small class="purchase-row-unit">Antes ${money(row.expectedCompra)} Bs</small>` : ""}`;
}
function nameMarkup(row, index) {
    const candidates = !row.confirmado ? candidateProducts({ ...row, candidatos: [...(row.candidatos || []), row.empaqueRecordado?.productId].filter(Boolean) }, products) : [];
    const code = row.confirmado ? products.find(product => product.id === row.productId)?.codigo : "";
    return `<div class="purchase-name-heading">${row.confirmado ? `<div class="purchase-product-name">${escapeHtml(row.nombre)}</div>` : `<input data-field="nombre" class="form-field purchase-name-input" value="${escapeHtml(row.nombre)}" maxlength="200" aria-label="Nombre fila ${index + 1}">`}
        <button data-match="${escapeHtml(row.id)}" type="button" class="purchase-match" title="Elegir otro producto" aria-label="Elegir otro producto fila ${index + 1}">${icon("search")}</button></div>
        ${code ? `<small class="purchase-row-unit">Cod. ${escapeHtml(code)}</small>` : ""}
        ${!row.confirmado ? `<div class="purchase-candidates" role="group" aria-label="Especificar producto fila ${index + 1}" ${candidates.length ? "" : "hidden"}>${candidateButtons(candidates)}</div>` : ""}
        ${row.precioCambio ? '<small class="purchase-row-question">Precio de inventario actualizado.</small>' : ""}`;
}
function quantityMarkup(row, index) {
    const candidates = el("purchaseUsePackageHistory").checked && !row.unidadesPorPaquete ? packageCandidates(row, packageMemory) : [];
    return `<input data-field="cantidad" class="form-field" type="number" min="1" max="100000" step="1" inputmode="numeric" value="${row.cantidad ?? ""}" aria-label="Cantidad fila ${index + 1}"><span class="purchase-row-unit">${escapeHtml(row.unidad || "unid.")}</span>${isPackage(row.unidad) ? `<label class="purchase-pack-label">Unid./paquete<input data-field="unidadesPorPaquete" class="form-field" type="number" min="1" max="100000" step="1" inputmode="numeric" value="${row.unidadesPorPaquete ?? ""}" aria-label="Unidades por paquete fila ${index + 1}"></label>
    ${row.empaqueRecordado ? `<span class="purchase-pack-memory" title="${escapeHtml(`${row.empaqueRecordado.nombre} · ${row.empaqueRecordado.fecha}`)}">Del historial <button data-forget-package="${escapeHtml(row.id)}" type="button" title="No usar el dato recordado" aria-label="No usar empaque recordado fila ${index + 1}">${icon("x")}</button></span>` : ""}
    ${candidates.length ? `<div class="purchase-pack-choices" role="group" aria-label="Empaques anteriores fila ${index + 1}">${candidates.map(entry => `<button data-package="${escapeHtml(entry.id)}" type="button" title="${escapeHtml(`${entry.nombre} · ${entry.fecha}`)}">${entry.unidades} unid.${new Set(candidates.map(item => item.identity)).size > 1 ? ` · ${escapeHtml(entry.nombre)}` : ""}</button>`).join("")}</div>` : ""}` : ""}`;
}
const candidateButtons = candidates => candidates.map(product => `<button data-candidate="${escapeHtml(product.id)}" type="button">${escapeHtml(product.nombre)}</button>`).join("");
function updateCell(cell, markup) {
    if (cell.purchaseMarkup === markup) return;
    cell.innerHTML = markup; cell.purchaseMarkup = markup;
}
function refreshRow(row, field) {
    const tr = el("purchaseRows").querySelector(`[data-purchase-row="${CSS.escape(row.id)}"]`);
    const index = rows.indexOf(row);
    if (!["cantidad", "unidadesPorPaquete"].includes(field) || !tr.querySelector('[data-cell="quantity"]').contains(document.activeElement)) updateCell(tr.querySelector('[data-cell="quantity"]'), quantityMarkup(row, index));
    if (field !== "unitPrice" || document.activeElement !== tr.querySelector('[data-field="unitPrice"]')) updateCell(tr.querySelector('[data-cell="unit"]'), unitMarkup(row, index));
    if (field !== "precioVenta") updateCell(tr.querySelector('[data-cell="state"]'), comparison(row) + inventoryControls(row, index));
    const group = tr.querySelector(".purchase-candidates");
    if (field === "nombre" && group) { const candidates = candidateProducts(row, products); updateCell(group, candidateButtons(candidates)); group.hidden = !candidates.length; }
    tr.classList.toggle("purchase-excluded", !row.incluir);
}
function renderRows() {
    el("purchaseRows").innerHTML = rows.map((row, index) => `<tr data-purchase-row="${escapeHtml(row.id)}" class="${row.incluir ? "" : "purchase-excluded"}">
        <td data-label="Incluir"><input data-field="incluir" type="checkbox" ${row.incluir ? "checked" : ""} aria-label="Incluir fila ${index + 1}"><span class="purchase-row-number">${index + 1}</span></td>
        <td class="purchase-name">${nameMarkup(row, index)}</td>
        <td data-label="Cantidad" data-cell="quantity">${quantityMarkup(row, index)}</td>
        <td data-label="Compra unitaria Bs" data-cell="unit">${unitMarkup(row, index)}</td>
        <td data-label="Estado" data-cell="state">${comparison(row)}${inventoryControls(row, index)}</td>
        <td><button data-remove="${escapeHtml(row.id)}" class="purchase-remove" type="button" title="Quitar fila" aria-label="Quitar fila ${index + 1}">${icon("x")}</button></td>
    </tr>`).join("");
    rows.forEach((row, index) => { const tr = el("purchaseRows").rows[index]; tr.querySelector('[data-cell="quantity"]').purchaseMarkup = quantityMarkup(row, index); tr.querySelector('[data-cell="unit"]').purchaseMarkup = unitMarkup(row, index); tr.querySelector('[data-cell="state"]').purchaseMarkup = comparison(row) + inventoryControls(row, index); });
    el("purchaseEmpty").hidden = rows.length > 0;
    el("purchaseRows").closest(".purchase-table-wrap").hidden = !rows.length;
    updateSummary(); lock();
}
function updateSummary() {
    const summary = purchaseSummary(rows), counts = { same: 0, up: 0, down: 0, new: 0 };
    rows.filter(row => row.incluir).forEach(row => { const state = comparisonState(row).kind; if (state in counts) counts[state]++; });
    el("purchaseRowSummary").textContent = `${summary.count} productos${summary.incomplete ? ` · ${summary.incomplete} por completar` : ""}`;
    el("purchaseComparisonSummary").innerHTML = [["same", "Sin cambios"], ["up", "Subio precio"], ["down", "Bajo precio"], ["new", "Producto nuevo"]].filter(([key]) => counts[key]).map(([key, label]) => `<span class="purchase-count purchase-count-${key}">${label} <strong>${counts[key]}</strong></span>`).join("");
    el("purchaseTotalLabel").textContent = summary.incomplete ? "Total parcial" : "Total de compra";
    el("purchaseTotal").textContent = `${money(summary.total)} Bs`;
    el("purchaseSelectedSummary").textContent = summary.updates ? `${summary.updates} cambios seleccionados para inventario` : "Sin cambios pendientes de inventario";
    const warnings = [];
    if (interpretation.totalDeclarado != null && !summary.incomplete && Math.round(interpretation.totalDeclarado * 100) !== Math.round(summary.total * 100)) warnings.push(`Total declarado: ${money(interpretation.totalDeclarado)} Bs. La tabla suma ${money(summary.total)} Bs.`);
    el("purchaseWarnings").hidden = !warnings.length;
    el("purchaseWarnings").innerHTML = warnings.map(message => `<p>${escapeHtml(message)}</p>`).join("");
}
function tab(history) {
    el("purchaseEditor").hidden = history; el("purchaseHistory").hidden = !history;
    el("purchaseNewTab").setAttribute("aria-selected", String(!history)); el("purchaseHistoryTab").setAttribute("aria-selected", String(history));
    el("purchaseHeadingSummary").textContent = history ? `${pages[pageIndex]?.purchases.length || 0} compras en esta pagina` : "Borrador";
}
function historyRecord(purchase) {
    return `<details class="purchase-history-record"><summary><span>${escapeHtml(purchase.fecha)}</span><span>${escapeHtml(purchase.proveedor || "Sin proveedor")}</span><small>${purchase.items.length} productos</small><strong>${money(purchase.total)} Bs</strong><small>${escapeHtml(purchase.registradoPorNombre || "Usuario")}</small></summary>
        <div class="purchase-history-detail"><table class="purchase-snapshot"><thead><tr><th>N</th><th>Producto</th><th>Cant.</th><th>Unit. Bs</th><th>Total Bs</th></tr></thead><tbody>${purchase.items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.nombre)}${item.codigo ? `<small>Cod. ${escapeHtml(item.codigo)}</small>` : ""}</td><td>${item.cantidad}<small>${escapeHtml(item.unidad || "unid.")}${item.unidadesPorPaquete ? ` · ${item.unidadesPorPaquete} unid./paq.` : ""}</small></td><td>${money(item.precioCompra)}</td><td>${money(item.total)}</td></tr>`).join("")}</tbody></table>${purchase.textoOriginal ? `<details><summary>Lista original</summary><pre>${escapeHtml(purchase.textoOriginal)}</pre></details>` : ""}</div></details>`;
}
function renderHistory() {
    const page = pages[pageIndex], search = normalizeName(el("purchaseSearch").value);
    const records = (page?.purchases || []).filter(purchase => !search || normalizeName([purchase.proveedor, purchase.fecha, ...(purchase.items || []).map(item => item.nombre)].join(" ")).includes(search));
    if (!el("purchaseHistory").hidden) el("purchaseHeadingSummary").textContent = `${page?.purchases.length || 0} compras en esta pagina`;
    el("purchaseHistoryList").innerHTML = records.length ? records.map(historyRecord).join("") : '<div class="empty-row">No hay compras en esta pagina.</div>';
    el("purchasePrevious").disabled = historyBusy || pageIndex === 0;
    el("purchaseNext").disabled = historyBusy || !(pages[pageIndex + 1] || page?.hasMore);
    el("purchasePageLabel").textContent = `Pagina ${pageIndex + 1}`;
}
async function loadHistory(reset = false) {
    const revision = ++historyRevision; historyBusy = true;
    if (reset) { pages = []; pageIndex = 0; }
    el("purchaseHistoryStatus").textContent = "Cargando compras..."; renderHistory();
    try {
        const page = await getPurchasesPage(reset ? null : pages.at(-1)?.cursor);
        if (revision !== historyRevision) return;
        pages.push(page); pageIndex = pages.length - 1; el("purchaseHistoryStatus").textContent = "";
    } catch (error) { if (revision === historyRevision) el("purchaseHistoryStatus").textContent = error.message; }
    finally { if (revision === historyRevision) { historyBusy = false; renderHistory(); } }
}
function openMatches(id) { matchId = id; const row = rows.find(row => row.id === id); el("purchaseMatchOriginal").textContent = row.nombreOriginal || row.nombre; el("purchaseMatchSearch").value = ""; renderMatches(); el("purchaseMatchDialog").showModal(); el("purchaseMatchSearch").focus(); }
function renderMatches() {
    const row = rows.find(row => row.id === matchId); if (!row) return;
    const search = normalizeName(el("purchaseMatchSearch").value);
    const list = products.filter(product => !search || normalizeName(product.nombre + product.codigo).includes(search));
    if (!search) list.sort((a, b) => Number((row.candidatos || []).includes(b.id)) - Number((row.candidatos || []).includes(a.id)));
    el("purchaseMatchResults").innerHTML = list.slice(0, 40).map(product => `<button data-choose-product="${escapeHtml(product.id)}" type="button"><small>${escapeHtml(product.codigo)}</small><span>${escapeHtml(product.nombre)}${product.activo === false ? " (deshabilitado)" : ""}</span></button>`).join("") || '<p class="form-message">Sin coincidencias.</p>';
}
function chooseProduct(id, rowId = matchId) {
    const row = rows.find(row => row.id === rowId), product = products.find(product => product.id === id); if (!row || id && !product) return;
    row.nombreOriginal ||= row.nombre;
    Object.assign(row, { productId: product?.id || "", nombre: product?.nombre || row.nombreOriginal, confirmado: Boolean(product), updateChoice: null,
        expectedCompra: product?.precioCompra, expectedVenta: product?.precioVenta, precioVenta: product?.precioVenta ?? "", cambiarVenta: false, precioCambio: false });
    rows = compareRows(rows); el("purchaseMatchDialog").close(); renderRows(); persist();
}
async function interpret(replace = false) {
    if (busy || frozen()) return;
    const texto = el("purchaseText").value.trim(); if (!texto) { status("Pega una lista antes de interpretarla.", true); return; }
    if (rows.length && !replace) { el("purchaseReinterpretDialog").showModal(); return; }
    busy = true; lock(); persist(); status("Interpretando productos y comparando precios...");
    try { const result = await interpretPurchaseList(texto, products); await loadPackageMemory(); interpretation = { avisos: result.avisos || [], totalDeclarado: result.totalDeclarado }; rows = compareRows(result.filas); parsedText = texto; el("purchaseSource").open = false; status("Lista comparada. No se ha modificado el inventario."); }
    catch (error) { status(error.message || "No se pudo interpretar la lista.", true); }
    finally { busy = false; renderRows(); persist(); }
}
function reviewSave() {
    if (busy || pendingInventory || pendingNew) return;
    try {
        const data = pending || buildPurchase({ rows, requestId: draftId, proveedor: el("purchaseSupplier").value, fecha: el("purchaseDate").value, textoOriginal: parsedText || el("purchaseText").value });
        el("purchaseConfirmSummary").textContent = `${data.items.length} productos · ${money(data.items.reduce((sum, row) => sum + Math.round(rowAmounts(row).total * 100), 0) / 100)} Bs. Se guardara solo la lista de compra.`;
        const selected = rows.filter(row => row.incluir && row.actualizar).length;
        el("purchaseConfirmChanges").textContent = selected ? `${selected} cambios de inventario seleccionados no se aplicaran con este boton.` : "No se modificara el inventario.";
        status(pending ? "Se comprobara el registro anterior para evitar duplicados." : "", false, true); el("purchaseConfirmDialog").showModal();
    } catch (error) { status(error.message, true); }
}
const knownFailure = error => ["client/offline", "invalid-argument", "aborted", "failed-precondition", "permission-denied", "unauthenticated"].includes(error.code);
async function save() {
    if (busy) return;
    const wasPending = Boolean(pending);
    try { pending ||= buildPurchase({ rows, requestId: draftId, proveedor: el("purchaseSupplier").value, fecha: el("purchaseDate").value, textoOriginal: parsedText || el("purchaseText").value }); }
    catch (error) { status(error.message, true, true); return; }
    busy = true; persist(); lock(); status("Guardando lista de compra...", false, true);
    try {
        const result = await registerPurchase(pending);
        rows = []; pending = null; parsedText = ""; interpretation = { avisos: [], totalDeclarado: null }; draftId = crypto.randomUUID();
        el("purchaseText").value = ""; el("purchaseSupplier").value = ""; el("purchaseDate").value = today(); el("purchaseSource").open = true; el("purchaseConfirmDialog").close();
        status(`Compra registrada: ${money(result.total)} Bs. El inventario no se modifico.`); persist(); tab(true); await loadHistory(true); await loadPackageMemory(true);
    } catch (error) { if (knownFailure(error) && !wasPending) pending = null; status(error.message, true, true); status(pending ? "Registro sin confirmar. Reintenta la misma compra." : error.message, true); persist(); }
    finally { busy = false; renderRows(); }
}
function reviewInventory() {
    if (busy || pending) return;
    if (pendingNew) return openNewProduct(pendingNew.rowId);
    try {
        inventoryPreview = pendingInventory || buildInventoryUpdate({ rows, requestId: crypto.randomUUID() });
        el("purchaseInventorySummary").textContent = `${inventoryPreview.items.length} productos actualizaran su compra. La venta solo cambia en las filas donde la activaste.`;
        el("purchaseInventoryChanges").innerHTML = inventoryPreview.items.map(row => `<div class="purchase-change-review"><strong>${escapeHtml(row.nombre)}</strong><p>Compra: ${money(row.expectedCompra)} / ${money(inventoryUnitPrice(row))} Bs</p>${row.cambiarVenta ? `<p>Venta: ${money(row.expectedVenta)} / ${money(row.precioVenta)} Bs</p>` : '<p>Venta sin cambios</p>'}</div>`).join("");
        el("purchaseInventoryStatus").textContent = pendingInventory ? "Se comprobara la operacion pendiente." : ""; el("purchaseInventoryDialog").showModal();
    } catch (error) { status(error.message, true); }
}
async function applyInventory() {
    if (busy || !inventoryPreview) return;
    const wasPending = Boolean(pendingInventory); pendingInventory ||= inventoryPreview;
    busy = true; persist(); lock(); el("purchaseInventoryStatus").textContent = "Aplicando cambios al inventario...";
    try {
        const result = await applyPurchaseInventory(pendingInventory);
        const items = pendingInventory.items;
        products = products.map(product => { const item = items.find(item => item.productId === product.id); return item ? { ...product, precioCompra: inventoryUnitPrice(item), precioVenta: item.precioVenta } : product; });
        rows.forEach(row => { const product = products.find(product => product.id === row.productId); if (product && items.some(item => item.productId === product.id)) Object.assign(row, { expectedCompra: product.precioCompra, expectedVenta: product.precioVenta, precioVenta: product.precioVenta, cambiarVenta: false, updateChoice: false, precioCambio: false }); });
        pendingInventory = null; inventoryPreview = null; invalidateProducts(); rows = attachInventory(rows, products); el("purchaseInventoryDialog").close();
        status(`${result.actualizados} precios actualizados. La lista de compra aun no se ha registrado.`);
    } catch (error) { if (knownFailure(error) && (!wasPending || error.code === "aborted")) pendingInventory = null; el("purchaseInventoryStatus").textContent = error.message; status(pendingInventory ? "Cambios sin confirmar. Usa Confirmar cambios para reintentar." : error.message, true); }
    finally { busy = false; renderRows(); persist(); }
}
async function openNewProduct(id) {
    const row = rows.find(row => row.id === id); if (!row || busy || pending || pendingInventory) return;
    const unit = inventoryUnitPrice(row); if (unit == null) return status("Completa cantidad, importe y unidades por paquete.", true);
    newRowId = id; const revision = ++detailsRevision; detailsBusy = false;
    el("purchaseNewName").value = pendingNew?.nombre || row.newDraftName || row.nombre;
    el("purchaseNewDescription").value = pendingNew?.descripcion ?? row.newDraftDescription ?? row.descripcion ?? "";
    el("purchaseNewBuy").value = unit;
    el("purchaseNewSale").value = pendingNew?.precioVenta ?? row.newDraftSale ?? "";
    const suggestion = suggestNewSalePrice(unit, products);
    el("purchaseNewSuggested").textContent = `Sugerido: ${money(suggestion)} Bs`;
    el("purchaseNewSuggested").dataset.value = suggestion ?? "";
    el("purchaseNewStatus").textContent = pendingNew ? "Se comprobara la creacion anterior para evitar duplicados." : "";
    el("purchaseNewProductDialog").showModal(); lock(); el("purchaseNewSale").focus();
    if (pendingNew || row.detallesIA) return;
    detailsBusy = true; lock(); el("purchaseNewStatus").textContent = "Preparando nombre y descripcion con IA...";
    const source = row.nombreOriginal ||= row.nombre;
    let request = detailRequests.get(id);
    if (!request || request.source !== source) { request = { source, promise: generatePurchaseProduct(row.nombre) }; detailRequests.set(id, request); }
    try {
        const details = await request.promise;
        if (!rows.includes(row) || row.confirmado || (row.nombreOriginal || row.nombre) !== source) return;
        Object.assign(row, details, { detallesIA: true });
        persist();
        if (revision === detailsRevision && el("purchaseNewProductDialog").open) {
            el("purchaseNewName").value = row.newDraftName || details.nombre;
            el("purchaseNewDescription").value = row.newDraftDescription ?? details.descripcion;
            el("purchaseNewStatus").textContent = "";
        }
    } catch (error) {
        if (revision === detailsRevision && el("purchaseNewProductDialog").open) el("purchaseNewStatus").textContent = `${error.message} Puedes completar los datos manualmente.`;
    } finally { if (detailRequests.get(id) === request) detailRequests.delete(id); if (revision === detailsRevision) { detailsBusy = false; renderRows(); lock(); } }
}
async function createNewProduct(event) {
    event.preventDefault(); if (busy || detailsBusy) return;
    const row = rows.find(row => row.id === newRowId); if (!row) return;
    const wasPending = Boolean(pendingNew);
    pendingNew ||= { requestId: row.newRequestId ||= crypto.randomUUID(), rowId: row.id, row: purchaseRow(row), nombre: el("purchaseNewName").value.trim(), descripcion: el("purchaseNewDescription").value.trim(), precioVenta: el("purchaseNewSale").value === "" ? "" : Number(el("purchaseNewSale").value) };
    busy = true; persist(); lock(); el("purchaseNewStatus").textContent = "Creando producto...";
    try {
        const result = await createPurchaseProduct(pendingNew);
        const product = { id: result.id, codigo: result.codigo, nombre: pendingNew.nombre, descripcion: pendingNew.descripcion || "", precioCompra: inventoryUnitPrice(pendingNew.row), precioVenta: pendingNew.precioVenta, imagenUrl: "", stock: "", activo: true };
        products = [...products.filter(product => product.id !== result.id), product];
        Object.assign(row, { productId: product.id, confirmado: true, nombreOriginal: row.nombreOriginal || row.nombre, nombre: product.nombre, expectedCompra: product.precioCompra, expectedVenta: product.precioVenta, precioVenta: product.precioVenta, updateChoice: false });
        delete row.empaqueRecordado; row.omitirMemoriaEmpaque = true;
        pendingNew = null; invalidateProducts(); rows = attachInventory(rows, products); el("purchaseNewProductDialog").close(); status(`Producto ${result.codigo} creado sin imagen. La lista de compra aun no se ha registrado.`);
    } catch (error) { if (knownFailure(error) && !wasPending) pendingNew = null; el("purchaseNewStatus").textContent = error.message; status(pendingNew ? "Producto sin confirmar. Usa Confirmar producto para comprobarlo." : error.message, true); }
    finally { busy = false; renderRows(); persist(); }
}
function reset() {
    if (busy || frozen()) return;
    rows = []; parsedText = ""; interpretation = { avisos: [], totalDeclarado: null }; draftId = crypto.randomUUID();
    el("purchaseText").value = ""; el("purchaseSupplier").value = ""; el("purchaseDate").value = today(); el("purchaseSource").open = true;
    el("purchaseDiscardDialog").close(); status(""); renderRows(); persist();
}
el("purchaseRows").addEventListener("input", event => {
    if (busy || frozen()) return;
    const input = event.target.closest("input[data-field]"), row = rows.find(row => row.id === input?.closest("tr")?.dataset.purchaseRow);
    if (!row || input.type === "checkbox") return;
    if (input.dataset.field === "unitPrice") setUnitPrice(row, input.value);
    else row[input.dataset.field] = input.type === "number" ? input.value === "" ? "" : Number(input.value) : input.value;
    if (input.dataset.field === "nombre") { row.nombreOriginal = row.nombre; row.detallesIA = false; row.newDraftName = ""; row.newDraftDescription = ""; }
    if (input.dataset.field === "unidadesPorPaquete") { delete row.empaqueRecordado; row.omitirMemoriaEmpaque = true; }
    Object.assign(row, compareRows([row])[0]);
    refreshRow(row, input.dataset.field); updateSummary(); lock(); persist();
});
el("purchaseRows").addEventListener("change", event => {
    if (busy || frozen()) return;
    const input = event.target.closest("[data-field]"), row = rows.find(row => row.id === input?.closest("tr")?.dataset.purchaseRow); if (!row) return;
    const field = input.dataset.field;
    if (field === "unitPrice") setUnitPrice(row, input.value);
    else row[field] = input.type === "checkbox" ? input.checked : input.type === "number" ? input.value === "" ? "" : Number(input.value) : input.value;
    if (field === "actualizar") { row.updateChoice = input.checked; if (input.checked) rows.forEach(other => { if (other.id !== row.id && other.productId === row.productId) { other.actualizar = false; other.updateChoice = false; } }); }
    if (field === "nombre") { row.nombreOriginal = row.nombre; row.detallesIA = false; row.newDraftName = ""; row.newDraftDescription = ""; }
    if (field === "unidadesPorPaquete") { delete row.empaqueRecordado; row.omitirMemoriaEmpaque = true; }
    if (!["precioVenta", "nombre"].includes(field)) {
        const attached = compareRows([row])[0]; Object.assign(row, attached);
        if (!row.incluir) row.actualizar = false;
    }
    refreshRow(row, field);
    if (field === "actualizar") rows.filter(item => item !== row && item.productId === row.productId).forEach(item => refreshRow(item, field));
    updateSummary(); lock(); persist();
});
el("purchaseRows").addEventListener("click", event => {
    if (busy || frozen()) return;
    const target = event.target.closest("[data-match], [data-remove], [data-margin], [data-create], [data-candidate], [data-package], [data-forget-package]"); if (!target) return;
    if (target.dataset.package) {
        const row = rows.find(row => row.id === target.closest("tr").dataset.purchaseRow), entry = packageCandidates(row, packageMemory).find(item => item.id === target.dataset.package);
        if (entry) Object.assign(row, attachInventory([choosePackage(row, entry)], products)[0]); renderRows(); persist(); return;
    }
    if (target.dataset.forgetPackage) { const row = rows.find(row => row.id === target.dataset.forgetPackage); delete row.empaqueRecordado; row.unidadesPorPaquete = null; row.omitirMemoriaEmpaque = true; Object.assign(row, attachInventory([row], products)[0]); renderRows(); persist(); return; }
    if (target.dataset.candidate) return chooseProduct(target.dataset.candidate, target.closest("tr").dataset.purchaseRow);
    if (target.dataset.match) return openMatches(target.dataset.match);
    if (target.dataset.create) return openNewProduct(target.dataset.create);
    if (target.dataset.remove) rows = rows.filter(row => row.id !== target.dataset.remove);
    if (target.dataset.margin) { const row = rows.find(row => row.id === target.dataset.margin); row.precioVenta = suggestedSalePrice(row); }
    renderRows(); persist();
});
el("purchaseSelectIncreases").addEventListener("click", () => {
    if (busy || frozen()) return;
    const selected = new Set(); rows.forEach(row => { row.actualizar = Boolean(row.incluir && comparisonState(row).kind === "up" && !selected.has(row.productId)); row.updateChoice = row.actualizar; if (row.actualizar) selected.add(row.productId); }); renderRows(); persist();
});
el("purchaseClearUpdates").addEventListener("click", () => { if (!busy && !frozen()) { rows.forEach(row => { row.actualizar = false; row.updateChoice = false; }); renderRows(); persist(); } });
el("purchaseAddRow").addEventListener("click", () => { if (busy || frozen()) return; if (rows.length >= 200) return status("Maximo 200 filas.", true); rows.push({ id: crypto.randomUUID(), nombre: "", cantidad: 1, importe: "", unidad: "unid.", tipoPrecio: "total", incluir: true, actualizar: false }); renderRows(); persist(); });
el("purchaseInterpret").addEventListener("click", () => interpret());
el("purchaseConfirmReinterpret").addEventListener("click", () => { el("purchaseReinterpretDialog").close(); void interpret(true); });
el("purchaseReviewSave").addEventListener("click", reviewSave); el("purchaseConfirmSave").addEventListener("click", save);
el("purchaseApplyInventory").addEventListener("click", reviewInventory); el("purchaseConfirmInventory").addEventListener("click", applyInventory);
el("purchaseNewProductForm").addEventListener("submit", createNewProduct);
el("purchaseNewProductForm").addEventListener("input", () => {
    const row = rows.find(row => row.id === newRowId); if (!row || busy || pendingNew) return;
    if (!detailsBusy) { row.newDraftName = el("purchaseNewName").value; row.newDraftDescription = el("purchaseNewDescription").value; }
    row.newDraftSale = el("purchaseNewSale").value; persist();
});
el("purchaseNewProductDialog").addEventListener("close", () => { detailsRevision++; detailsBusy = false; lock(); });
el("purchaseNewSuggested").addEventListener("click", () => { if (!busy && !pendingNew) { el("purchaseNewSale").value = el("purchaseNewSuggested").dataset.value; el("purchaseNewSale").dispatchEvent(new Event("input", { bubbles: true })); } });
el("purchaseMatchSearch").addEventListener("input", renderMatches);
el("purchaseMatchResults").addEventListener("click", event => { const button = event.target.closest("[data-choose-product]"); if (button) chooseProduct(button.dataset.chooseProduct); });
el("purchaseUnlink").addEventListener("click", () => chooseProduct(""));
el("purchaseDiscard").addEventListener("click", () => { if (!busy && !frozen()) { if (rows.length || el("purchaseText").value) el("purchaseDiscardDialog").showModal(); else reset(); } });
el("purchaseConfirmDiscard").addEventListener("click", reset);
el("purchaseNewTab").addEventListener("click", () => tab(false)); el("purchaseHistoryTab").addEventListener("click", () => { tab(true); if (!pages.length && !historyBusy) void loadHistory(true); });
el("purchaseSearch").addEventListener("input", renderHistory);
el("purchasePrevious").addEventListener("click", () => { if (!historyBusy && pageIndex > 0) { pageIndex--; renderHistory(); } });
el("purchaseNext").addEventListener("click", () => { if (!historyBusy) { if (pages[pageIndex + 1]) { pageIndex++; renderHistory(); } else if (pages[pageIndex]?.hasMore) void loadHistory(); } });
el("purchaseUpload").addEventListener("click", () => el("purchaseFile").click());
el("purchaseFile").addEventListener("change", async () => { const file = el("purchaseFile").files[0]; if (!file || busy || frozen()) return; if (file.size > 64000 || !/\.txt$/i.test(file.name)) return status("Elige un archivo TXT de hasta 16000 caracteres.", true); const text = await file.text(); if (text.length > 16000) return status("Maximo 16000 caracteres.", true); el("purchaseText").value = text; el("purchaseFile").value = ""; persist(); });
["purchaseText", "purchaseSupplier", "purchaseDate"].forEach(id => el(id).addEventListener("input", persist));
el("purchaseUsePackageHistory").addEventListener("change", async () => { if (busy || frozen()) return; rows = compareRows(rows); renderRows(); persist(); if (el("purchaseUsePackageHistory").checked) await loadPackageMemory(); else el("purchasePackageStatus").textContent = ""; });
el("purchaseRefresh").addEventListener("click", async () => { if (busy || frozen()) return; busy = true; lock(); try { invalidateProducts(); products = await getProducts(); await loadPackageMemory(true); rows = compareRows(rows); await loadHistory(true); status("Comparacion actualizada."); } catch (error) { status(error.message, true); } finally { busy = false; renderRows(); persist(); } });
dialogs.forEach(dialog => { dialog.querySelectorAll("[data-close-purchase-dialog]").forEach(button => button.addEventListener("click", () => { if (!busy) dialog.close(); })); dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); }); });
document.addEventListener("sxmy:module-change", event => { if (event.detail.module !== "compras") dialogs.forEach(dialog => dialog.close()); });
window.addEventListener("pagehide", persist); document.addEventListener("sxmy:save-draft", persist);
export async function initialize({ user }) { userId = user.uid; dialogs.forEach(dialog => document.body.append(dialog)); products = await getProducts(); restore(); if (!frozen()) rows = attachInventory(rows, products); renderRows(); tab(false); await loadHistory(true); void loadPackageMemory(); }
export async function refresh() { if (busy || frozen()) return; products = await getProducts(); await loadPackageMemory(); rows = compareRows(rows); renderRows(); persist(); await loadHistory(true); }
