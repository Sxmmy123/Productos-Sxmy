import {
    deleteProduct,
    escapeHtml,
    formatCode,
    getProducts,
    nextProductCode,
    saveProduct,
    updateProduct,
    uploadProductImage
} from "../../core/data-cache.js?v=2";
import { dateTimeText, formatMoney } from "../../core/data-cache.js?v=2";
import { rememberControls } from "../../core/view-state.js";
import { downloadCsvTemplate, importProductsFromCsv } from "./csv-import.js?v=2";
import { lowStock } from "../../shared/services/sales-domain.js";
import { getPreferences, updatePreferences } from "../configuracion/preferences.js";

let products = [];
let pendingImageProduct = null;
let pendingDeleteProduct = null;
let productView = "table";
let initialized = false;
let appliedPreferences = "";

const productModal = document.getElementById("productModal");
const bulkModal = document.getElementById("bulkModal");
const imageModal = document.getElementById("imageModal");
const deleteProductModal = document.getElementById("deleteProductModal");
const productModalTitle = document.getElementById("productModalTitle");
const openProductModal = document.getElementById("openProductModal");
const openBulkModal = document.getElementById("openBulkModal");
const form = document.getElementById("productForm");
const productId = document.getElementById("productId");
const currentImageUrl = document.getElementById("currentImageUrl");
const codigo = document.getElementById("codigo");
const nombre = document.getElementById("nombre");
const precioCompra = document.getElementById("precioCompra");
const precioVenta = document.getElementById("precioVenta");
const stock = document.getElementById("stock");
const stockMinimo = document.getElementById("stockMinimo");
const onlyLowStock = document.getElementById("onlyLowStock");
const descripcion = document.getElementById("descripcion");
const activo = document.getElementById("activo");
const table = document.getElementById("productsTable");
const tableView = document.getElementById("productsTableView");
const altView = document.getElementById("productsAltView");
const productViewButtons = document.querySelectorAll("[data-product-view]");
const search = document.getElementById("adminSearch");
const adminSort = document.getElementById("adminSort");
const onlyNoImage = document.getElementById("onlyNoImage");
const showActiveProducts = document.getElementById("showActiveProducts");
const showDisabledProducts = document.getElementById("showDisabledProducts");
const showPriceHistory = document.getElementById("showPriceHistory");
const statusBox = document.getElementById("statusBox");
const totalProducts = document.getElementById("totalProducts");
const resetForm = document.getElementById("resetForm");
const bulkCsv = document.getElementById("bulkCsv");
const bulkImages = document.getElementById("bulkImages");
const bulkImport = document.getElementById("bulkImport");
const downloadTemplate = document.getElementById("downloadTemplate");
const bulkStatus = document.getElementById("bulkStatus");
const rowImageInput = document.getElementById("rowImageInput");
const imagePreview = document.getElementById("imagePreview");
const imageModalTitle = document.getElementById("imageModalTitle");
const replaceImage = document.getElementById("replaceImage");
const deleteProductName = document.getElementById("deleteProductName");
const cancelDeleteProduct = document.getElementById("cancelDeleteProduct");
const confirmDeleteProduct = document.getElementById("confirmDeleteProduct");
const productModals = [productModal, bulkModal, imageModal, deleteProductModal];
const modalReturnFocus = new WeakMap();

// Animated module containers establish a containing block for fixed descendants.
productModals.forEach((modal) => {
    document.body.append(modal);
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", modal.querySelector("h2").id);
    modal.tabIndex = -1;
});

function setStatus(message, tone = "info") {
    if (tone === "ok" && /listo/i.test(message)) {
        statusBox.className = "hidden";
        statusBox.textContent = "";
        return;
    }
    const tones = {
        info: "border-[#cfd9df] bg-white text-[#4b5563]",
        ok: "border-[#b8c7cf] bg-[#f7fafb] text-[#374151]",
        warn: "border-[#e0c46c] bg-[#fff9e7] text-[#6f5600]",
        error: "border-[#e4a3a3] bg-[#fff1f1] text-[#8a1f1f]"
    };
    statusBox.className = `mb-4 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`;
    statusBox.textContent = message;
}

function errorDetail(error) {
    return error?.code || error?.message || "sin detalle";
}

function openModal(modal) {
    modalReturnFocus.set(modal, document.activeElement);
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.body.classList.add("product-modal-open");
    (modal.querySelector("[data-close-modal], #cancelDeleteProduct") || modal).focus({ preventScroll: true });
}

function closeModal(modal, restoreFocus = true) {
    if (modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.classList.toggle("product-modal-open", productModals.some((item) => !item.classList.contains("hidden")));
    const previous = modalReturnFocus.get(modal);
    if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
    modalReturnFocus.delete(modal);
}

function openDeleteProductModal(product) {
    pendingDeleteProduct = product;
    deleteProductName.textContent = `${product.codigo} - ${product.nombre}`;
    openModal(deleteProductModal);
    confirmDeleteProduct.focus();
}

function closeDeleteProductModal({ restoreFocus = true } = {}) {
    pendingDeleteProduct = null;
    closeModal(deleteProductModal, restoreFocus);
}

function resetProductForm() {
    form.reset();
    productId.value = "";
    currentImageUrl.value = "";
    codigo.value = nextProductCode(products);
    stock.value = "";
    stockMinimo.value = "";
    activo.checked = true;
    productModalTitle.textContent = "Agregar producto";
    form.querySelector("button[type='submit']").textContent = "Guardar";
}

function fillForm(product) {
    productId.value = product.id;
    currentImageUrl.value = product.imagenUrl || "";
    codigo.value = product.codigo;
    nombre.value = product.nombre;
    precioCompra.value = product.precioCompra;
    precioVenta.value = product.precioVenta;
    stock.value = product.stock === "" ? "" : product.stock;
    stockMinimo.value = product.stockMinimo ?? "";
    descripcion.value = product.descripcion;
    activo.checked = product.activo !== false;
    productModalTitle.textContent = "Editar producto";
    form.querySelector("button[type='submit']").textContent = "Actualizar";
    openModal(productModal);
    nombre.focus();
}

function filteredProducts() {
    const query = search.value.trim().toLowerCase();
    const includeActive = showActiveProducts.checked;
    const includeDisabled = showDisabledProducts.checked;
    let data = products.filter((product) => product.activo === false ? includeDisabled : includeActive);
    if (query) {
        data = data.filter((product) =>
            product.codigo.toLowerCase().includes(query) ||
            product.nombre.toLowerCase().includes(query) ||
            product.descripcion.toLowerCase().includes(query)
        );
    }
    if (onlyNoImage.checked) {
        data = data.filter((product) => !product.imagenUrl);
    }
    if (onlyLowStock.checked) data = data.filter(lowStock);

    return sortProducts(data, adminSort.value);
}

function sortProducts(data, sortValue) {
    const sorters = {
        codigo: (a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }),
        "precio-asc": (a, b) => Number(a.precioVenta) - Number(b.precioVenta),
        "precio-desc": (a, b) => Number(b.precioVenta) - Number(a.precioVenta),
        stock: (a, b) => stockValue(b) - stockValue(a),
        nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
        fecha: (a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0)
    };
    return data.sort(sorters[sortValue] || sorters.codigo);
}

function stockValue(product) {
    return product.stock === "" ? Number.MAX_SAFE_INTEGER : Number(product.stock || 0);
}

function productDate(product) {
    if (product.createdAtMillis) return dateTimeText(product.createdAtMillis);
    return "Sin fecha";
}

function priceHistoryHtml(product) {
    const history = Array.isArray(product.historialPrecios) ? product.historialPrecios.slice(-4).reverse() : [];
    if (!history.length && product.precioAnterior === "") return "";
    const rows = history.map((item) => `
        <li>${escapeHtml(item.fechaTexto || "")}: ${formatMoney(item.anterior)} Bs -> ${formatMoney(item.nuevo)} Bs</li>
    `).join("");
    return `
        <details class="mt-1 text-xs text-[#60727d]">
            <summary class="cursor-pointer font-bold text-[#146c43]">Ver precios</summary>
            <ul class="mt-1 space-y-1">${rows || `<li>Anterior: ${formatMoney(product.precioAnterior)} Bs</li>`}</ul>
        </details>
    `;
}

function updateProductViewButtons() {
    productViewButtons.forEach((button) => {
        const active = button.dataset.productView === productView;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function setProductView(view) {
    productView = ["table", "cards", "compact"].includes(view) ? view : "table";
    updatePreferences({ products: { view: productView } });
    renderTable();
}

function applyProductPreferences() {
    const saved = getPreferences().products;
    const signature = JSON.stringify(saved);
    if (initialized && signature === appliedPreferences) return;
    appliedPreferences = signature;
    productView = saved.view;
    adminSort.value = saved.sort;
    showActiveProducts.checked = saved.showActive;
    showDisabledProducts.checked = saved.showDisabled;
    onlyNoImage.checked = saved.onlyNoImage;
    onlyLowStock.checked = saved.onlyLowStock;
    showPriceHistory.checked = saved.showPriceHistory;
    if (initialized) renderTable();
}

function productImageButton(product) {
    if (product.imagenUrl) {
        return `<button class="image-thumb" data-action="preview-image" data-id="${escapeHtml(product.id)}"><img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}"></button>`;
    }
    return `<button class="btn-light product-image-empty" data-action="image" data-id="${escapeHtml(product.id)}">+ imagen</button>`;
}

function actionIcon(name) {
    const icons = {
        edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        disable: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v8"/><path d="M6.3 5.3a8 8 0 1 0 11.4 0"/></svg>',
        enable: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
        delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>'
    };
    return icons[name] || "";
}

function productActions(product) {
    const isActive = product.activo !== false;
    const toggleText = isActive ? "Deshabilitar producto" : "Habilitar producto";
    const toggleIcon = isActive ? "disable" : "enable";
    return `
        <button class="btn-primary action-icon-button" data-action="edit" data-id="${escapeHtml(product.id)}" type="button" title="Editar producto" aria-label="Editar producto">${actionIcon("edit")}</button>
        <button class="btn-light action-icon-button" data-action="toggle" data-id="${escapeHtml(product.id)}" type="button" title="${toggleText}" aria-label="${toggleText}">${actionIcon(toggleIcon)}</button>
        <button class="btn-danger action-icon-button" data-action="delete" data-id="${escapeHtml(product.id)}" type="button" title="Eliminar producto" aria-label="Eliminar producto">${actionIcon("delete")}</button>
    `;
}

function productPriceBlock(product) {
    const shouldShowHistory = showPriceHistory?.checked;
    return `
        <p class="admin-product-price">${formatMoney(product.precioVenta)} Bs</p>
        ${shouldShowHistory && product.precioAnterior !== "" && product.precioAnterior !== product.precioVenta ? `<p class="admin-product-old-price">${formatMoney(product.precioAnterior)} Bs</p>` : ""}
        ${shouldShowHistory ? priceHistoryHtml(product) : ""}
    `;
}

function renderAlternativeProducts(data) {
    tableView.classList.add("hidden");
    altView.classList.remove("hidden");
    altView.className = productView === "cards" ? "admin-product-grid" : "admin-product-compact";

    altView.innerHTML = data.map((product) => {
        const stockText = product.stock === "" ? "Opcional" : product.stock;
        const statusText = product.activo !== false ? "Habilitado" : "Deshabilitado";

        if (productView === "compact") {
            return `
                <article class="admin-product-line">
                    <div class="admin-product-line-main">
                        ${productImageButton(product)}
                        <div>
                            <p class="admin-product-code">${escapeHtml(product.codigo)}</p>
                            <h3>${escapeHtml(product.nombre)}</h3>
                            <p>${escapeHtml(product.descripcion)}</p>
                        </div>
                    </div>
                    <div class="admin-product-line-meta">
                        <span class="card-buy-price">Compra ${formatMoney(product.precioCompra)} Bs</span>
                        <span class="${lowStock(product) ? "stock-warning" : ""}">Stock ${escapeHtml(stockText)}${lowStock(product) ? " · Bajo" : ""}</span>
                        <span>${productDate(product)}</span>
                    </div>
                    <div class="admin-product-line-total">
                        ${productPriceBlock(product)}
                    </div>
                    <span class="status-pill">${statusText}</span>
                    <div class="admin-product-actions">${productActions(product)}</div>
                </article>
            `;
        }

        return `
            <article class="admin-product-card">
                <div class="admin-product-card-media">
                    ${productImageButton(product)}
                    <span class="status-pill card-media-status">${statusText}</span>
                </div>
                <div class="admin-product-card-body">
                    <div class="admin-product-card-head">
                        <span class="admin-product-code">${escapeHtml(product.codigo)}</span>
                    </div>
                    <h3>${escapeHtml(product.nombre)}</h3>
                    <p>${escapeHtml(product.descripcion)}</p>
                    <div class="admin-product-card-facts">
                        <span class="card-buy-price">Compra ${formatMoney(product.precioCompra)} Bs</span>
                        <span class="${lowStock(product) ? "stock-warning" : ""}">Stock ${escapeHtml(stockText)}${lowStock(product) ? " · Bajo" : ""}</span>
                        <span>${productDate(product)}</span>
                    </div>
                    ${productPriceBlock(product)}
                    <div class="admin-product-actions">${productActions(product)}</div>
                </div>
            </article>
        `;
    }).join("");
}

function renderTable() {
    const data = filteredProducts();
    const activeProducts = products.filter((item) => item.activo !== false);
    const disabledProducts = products.filter((item) => item.activo === false);
    totalProducts.textContent = `${activeProducts.length} activos - ${disabledProducts.length} deshabilitados - ${activeProducts.filter((item) => !item.imagenUrl).length} sin imagen`;
    const lowCount = activeProducts.filter(lowStock).length;
    if (lowCount) totalProducts.textContent += ` - ${lowCount} con stock bajo`;
    table.innerHTML = "";
    altView.innerHTML = "";
    updateProductViewButtons();

    if (!data.length) {
        tableView.classList.remove("hidden");
        altView.classList.add("hidden");
        table.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-sm text-[#60727d]">No hay productos con esos filtros.</td></tr>';
        return;
    }

    if (productView !== "table") {
        renderAlternativeProducts(data);
        return;
    }

    tableView.classList.remove("hidden");
    altView.classList.add("hidden");

    data.forEach((product) => {
        const stockText = product.stock === "" ? "Opcional" : product.stock;
        const imageCell = productImageButton(product);

        table.insertAdjacentHTML("beforeend", `
            <tr class="admin-product-row border-b border-[#d6e0e6] last:border-0">
                <td class="px-4 py-3">${imageCell}</td>
                <td class="px-4 py-3 font-bold text-[#12313f]">${escapeHtml(product.codigo)}</td>
                <td class="min-w-64 px-4 py-3">
                    <p class="font-semibold text-[#111827]">${escapeHtml(product.nombre)}</p>
                    <p class="mt-1 line-clamp-2 text-xs text-[#60727d]">${escapeHtml(product.descripcion)}</p>
                </td>
                <td class="px-4 py-3 text-[#374151]">${formatMoney(product.precioCompra)} Bs</td>
                <td class="px-4 py-3">
                    ${productPriceBlock(product)}
                </td>
                <td class="px-4 py-3 text-[#374151]"><span class="${lowStock(product) ? "stock-warning" : ""}">${escapeHtml(stockText)}${lowStock(product) ? " · Bajo" : ""}</span></td>
                <td class="px-4 py-3 text-xs text-[#60727d]">${productDate(product)}</td>
                <td class="px-4 py-3"><span class="status-pill">${product.activo !== false ? "Habilitado" : "Deshabilitado"}</span></td>
                <td class="px-4 py-3">
                    <div class="admin-product-actions table-actions">${productActions(product)}</div>
                </td>
            </tr>
        `);
    });
}

async function loadProducts() {
    try {
        products = await getProducts();
        renderTable();
        return true;
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo leer productos: ${errorDetail(error)}.`, "error");
        return false;
    }
}

async function importCsvProducts() {
    const file = bulkCsv.files[0];
    if (!file) {
        bulkStatus.textContent = "Selecciona un CSV primero.";
        return;
    }
    bulkImport.disabled = true;
    bulkImport.textContent = "Importando...";
    bulkStatus.textContent = "Leyendo CSV...";
    try {
        const result = await importProductsFromCsv(file, bulkImages.files, (message) => {
            bulkStatus.textContent = message;
        });
        await loadProducts();
        bulkStatus.textContent = `Listo. Importados: ${result.imported}. Omitidos: ${result.skipped}.`;
    } catch (error) {
        console.error(error);
        bulkStatus.textContent = `Error al importar: ${error.message}`;
    } finally {
        bulkImport.disabled = false;
        bulkImport.textContent = "Importar CSV";
    }
}

function pricePayload(existingProduct, newPrice) {
    if (!existingProduct || Number(existingProduct.precioVenta) === Number(newPrice)) {
        return {
            precioAnterior: existingProduct?.precioAnterior ?? "",
            historialPrecios: existingProduct?.historialPrecios || []
        };
    }
    const entry = {
        fechaIso: new Date().toISOString(),
        fechaTexto: dateTimeText(new Date()),
        anterior: Number(existingProduct.precioVenta || 0),
        nuevo: Number(newPrice || 0)
    };
    return {
        precioAnterior: Number(existingProduct.precioVenta || 0),
        historialPrecios: [...(existingProduct.historialPrecios || []), entry].slice(-12)
    };
}


form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!codigo.value.trim() || !nombre.value.trim()) { setStatus("Codigo y nombre son obligatorios.", "warn"); return; }
    const existingProduct = products.find((item) => item.id === productId.value);
    if (products.some((item) => item.id !== productId.value && item.codigo === formatCode(codigo.value))) {
        setStatus("Ya existe un producto con ese codigo.", "warn");
        return;
    }
    const priceData = pricePayload(existingProduct, precioVenta.value);
    try {
        setStatus("Guardando producto...");
        await saveProduct({
            codigo: codigo.value,
            nombre: nombre.value,
            precioCompra: precioCompra.value,
            precioVenta: precioVenta.value,
            stock: stock.value,
            stockMinimo: stockMinimo.value,
            descripcion: descripcion.value,
            imagenUrl: currentImageUrl.value,
            activo: activo.checked,
            createdAt: existingProduct?.createdAt || "",
            ...priceData
        }, productId.value);
        closeModal(productModal);
        await loadProducts();
        setStatus("Producto guardado.", "ok");
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo guardar: ${errorDetail(error)}. Revisa reglas de Firestore.`, "error");
    }
});

async function handleProductAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const product = products.find((item) => item.id === button.dataset.id);
    if (!product) return;

    if (button.dataset.action === "edit") { fillForm(product); return; }
    if (button.dataset.action === "image") { pendingImageProduct = product; rowImageInput.click(); return; }
    if (button.dataset.action === "preview-image") {
        pendingImageProduct = product;
        imageModalTitle.textContent = product.nombre;
        imagePreview.innerHTML = `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}" class="max-h-full max-w-full rounded-lg object-contain">`;
        openModal(imageModal);
        return;
    }
    if (button.dataset.action === "toggle") {
        await updateProduct(product.id, { activo: product.activo === false });
        await loadProducts();
        return;
    }
    if (button.dataset.action === "delete") {
        openDeleteProductModal(product);
    }
}

table.addEventListener("click", handleProductAction);
altView.addEventListener("click", handleProductAction);

cancelDeleteProduct.addEventListener("click", closeDeleteProductModal);
confirmDeleteProduct.addEventListener("click", async () => {
    if (!pendingDeleteProduct) return;
    const product = pendingDeleteProduct;
    confirmDeleteProduct.disabled = true;
    confirmDeleteProduct.textContent = "Eliminando...";
    try {
        await deleteProduct(product.id);
        closeDeleteProductModal();
        await loadProducts();
        setStatus("Producto eliminado.", "ok");
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo eliminar: ${errorDetail(error)}.`, "error");
    } finally {
        confirmDeleteProduct.disabled = false;
        confirmDeleteProduct.textContent = "Eliminar";
    }
});

rowImageInput.addEventListener("change", async () => {
    const file = rowImageInput.files[0];
    if (!file || !pendingImageProduct) return;
    try {
        setStatus("Subiendo imagen " + pendingImageProduct.codigo + "...");
        const imagenUrl = await uploadProductImage(file, pendingImageProduct.codigo);
        await updateProduct(pendingImageProduct.id, { imagenUrl });
        closeModal(imageModal);
        await loadProducts();
        setStatus("Imagen actualizada en el producto " + pendingImageProduct.codigo + ".", "ok");
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo subir la imagen: ${errorDetail(error)}. Revisa Cloudinary o el preset.`, "error");
    } finally {
        rowImageInput.value = "";
        pendingImageProduct = null;
    }
});

search.addEventListener("input", renderTable);
adminSort.addEventListener("change", () => { updatePreferences({ products: { sort: adminSort.value } }); renderTable(); });
onlyNoImage.addEventListener("change", renderTable);
showActiveProducts.addEventListener("change", renderTable);
showDisabledProducts.addEventListener("change", renderTable);
onlyLowStock.addEventListener("change", renderTable);
showPriceHistory.addEventListener("change", renderTable);
productViewButtons.forEach((button) => button.addEventListener("click", () => setProductView(button.dataset.productView)));
resetForm.addEventListener("click", resetProductForm);
openProductModal.addEventListener("click", () => { resetProductForm(); openModal(productModal); nombre.focus(); });
openBulkModal.addEventListener("click", () => openModal(bulkModal));
replaceImage.addEventListener("click", () => rowImageInput.click());
bulkImport.addEventListener("click", importCsvProducts);
downloadTemplate.addEventListener("click", downloadCsvTemplate);

productModals.forEach((modal) => {
    modal.querySelectorAll("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", () => closeModal(modal));
    });
    modal.addEventListener("click", (event) => {
        if (event.target !== modal) return;
        if (modal === deleteProductModal) closeDeleteProductModal();
        else closeModal(modal);
    });
});
document.addEventListener("keydown", (event) => {
    const modal = productModals.find((item) => !item.classList.contains("hidden"));
    if (!modal) return;
    if (event.key === "Escape") {
        event.preventDefault();
        if (modal === deleteProductModal) closeDeleteProductModal();
        else closeModal(modal);
    } else if (event.key === "Tab") {
        const controls = [...modal.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
            .filter((item) => !item.disabled && item.tabIndex >= 0 && item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); modal.focus({ preventScroll: true }); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
    }
});

document.addEventListener("sxmy:module-change", () => {
    [productModal, bulkModal, imageModal].forEach((modal) => closeModal(modal, false));
    closeDeleteProductModal({ restoreFocus: false });
    document.querySelectorAll(".product-options-menu[open]").forEach((menu) => { menu.open = false; });
});

export async function initialize({ user }) {
    rememberControls(user.uid, "productos", ["adminSearch"]);
    applyProductPreferences();
    initialized = true;
    await loadProducts();
}

document.addEventListener("sxmy:preferences-change", applyProductPreferences);

export { loadProducts as refresh };
