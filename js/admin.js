import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    deleteProduct,
    escapeHtml,
    formatCode,
    getProducts,
    nextProductCode,
    saveProduct,
    updateProduct,
    uploadProductImage
} from "./product-service.js";
import { dateTimeText, formatMoney, formatSaleNumber, getSales } from "./sales-service.js";
import { setupThemeToggle } from "./theme-service.js";

setupThemeToggle();

let products = [];
let sales = [];
let pendingImageProduct = null;
let pendingDeleteProduct = null;
let productView = localStorage.getItem("sxmy-product-view") || "table";

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
const logout = document.getElementById("logout");
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
const salesList = document.getElementById("salesList");
const salesSummary = document.getElementById("salesSummary");
const salesSearch = document.getElementById("salesSearch");
const salesDateFilter = document.getElementById("salesDateFilter");
const salePrintArea = document.getElementById("salePrintArea");
const metricSales = document.getElementById("metricSales");
const metricIncome = document.getElementById("metricIncome");
const metricUnits = document.getElementById("metricUnits");
const metricToday = document.getElementById("metricToday");
const metricTop = document.getElementById("metricTop");
const topProducts = document.getElementById("topProducts");
const salesByDay = document.getElementById("salesByDay");
const adminTopTitle = document.getElementById("adminTopTitle");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarClose = document.getElementById("sidebarClose");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const sidebarCollapse = document.getElementById("sidebarCollapse");

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
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeModal(modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function openDeleteProductModal(product) {
    pendingDeleteProduct = product;
    deleteProductName.textContent = `${product.codigo} - ${product.nombre}`;
    openModal(deleteProductModal);
    confirmDeleteProduct.focus();
}

function closeDeleteProductModal() {
    pendingDeleteProduct = null;
    closeModal(deleteProductModal);
}

function resetProductForm() {
    form.reset();
    productId.value = "";
    currentImageUrl.value = "";
    codigo.value = nextProductCode(products);
    stock.value = "";
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
    localStorage.setItem("sxmy-product-view", productView);
    renderTable();
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
                        <span>Stock ${escapeHtml(stockText)}</span>
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
                        <span>Stock ${escapeHtml(stockText)}</span>
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
                <td class="px-4 py-3 text-[#374151]">${escapeHtml(stockText)}</td>
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
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo leer productos: ${errorDetail(error)}.`, "error");
    }
}

async function loadSales() {
    try {
        sales = await getSales();
        renderSales();
        renderAnalysis();
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo leer ventas: ${errorDetail(error)}.`, "error");
    }
}

async function loadAll() {
    setStatus("Cargando datos...");
    await Promise.all([loadProducts(), loadSales()]);
    renderAnalysis();
    setStatus("Panel listo.", "ok");
}

function normalizeHeader(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"' && quoted && next === '"') { cell += '"'; index++; }
        else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) { row.push(cell); cell = ""; }
        else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") index++;
            row.push(cell);
            if (row.some((value) => value.trim() !== "")) rows.push(row);
            row = [];
            cell = "";
        } else cell += char;
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map((values) => {
        const item = {};
        headers.forEach((header, index) => { item[header] = values[index]?.trim() || ""; });
        return item;
    });
}

function imageKey(value) {
    return String(value || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildImageMap(files) {
    const map = new Map();
    [...files].forEach((file) => {
        const key = imageKey(file.name);
        if (key) map.set(key, file);
    });
    return map;
}

function productFromCsv(row) {
    return {
        codigo: formatCode(row.codigo || row.code || ""),
        nombre: row.nombre || row.name || "",
        precioCompra: row.preciocompra || row.compra || row.costo || 0,
        precioVenta: row.precioventa || row.venta || row.precio || row.price || 0,
        precioAnterior: "",
        historialPrecios: [],
        stock: row.stock || "",
        descripcion: row.descripcion || row.desc || "",
        imagenUrl: row.imagenurl || "",
        activo: String(row.activo || "true").toLowerCase() !== "false"
    };
}

async function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "utf-8");
    });
}

async function importCsvProducts() {
    const file = bulkCsv.files[0];
    if (!file) { bulkStatus.textContent = "Selecciona un CSV primero."; return; }
    bulkImport.disabled = true;
    bulkImport.textContent = "Importando...";
    bulkStatus.textContent = "Leyendo CSV...";
    try {
        const rows = parseCsv(await readTextFile(file));
        const imageMap = buildImageMap(bulkImages.files || []);
        let imported = 0;
        let skipped = 0;
        for (const row of rows) {
            const product = productFromCsv(row);
            if (!product.codigo || !product.nombre || !product.precioVenta) { skipped++; continue; }
            const requestedImage = row.imagenarchivo || row.archivoimagen || row.imagen || "";
            const matchedImage = imageMap.get(imageKey(requestedImage)) || imageMap.get(imageKey(product.codigo));
            if (matchedImage) {
                bulkStatus.textContent = "Subiendo imagen " + product.codigo + "...";
                product.imagenUrl = await uploadProductImage(matchedImage, product.codigo);
            }
            bulkStatus.textContent = "Guardando " + product.codigo + "...";
            await saveProduct(product);
            imported++;
        }
        await loadProducts();
        bulkStatus.textContent = "Listo. Importados: " + imported + ". Omitidos: " + skipped + ".";
    } catch (error) {
        console.error(error);
        bulkStatus.textContent = "Error al importar: " + error.message;
    } finally {
        bulkImport.disabled = false;
        bulkImport.textContent = "Importar CSV";
    }
}

function downloadCsvTemplate() {
    const csv = [
        "codigo,nombre,precioCompra,precioVenta,stock,descripcion,imagenArchivo,imagenUrl,activo",
        "001,Arduino UNO,75,95,,Placa Arduino Uno con cable,001.jpg,,true",
        "002,Motor DC 9V,6.5,14,20,Motor para proyectos escolares,002.jpg,,true"
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-productos.csv";
    link.click();
    URL.revokeObjectURL(url);
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

function filteredSales() {
    const query = salesSearch.value.trim().toLowerCase();
    return sales.filter((sale) => {
        const matchesQuery = !query ||
            sale.cliente.toLowerCase().includes(query) ||
            sale.id.toLowerCase().includes(query) ||
            sale.items.some((item) =>
                item.codigo.toLowerCase().includes(query) ||
                item.nombre.toLowerCase().includes(query)
            );
        return matchesQuery && matchesSaleDate(sale);
    });
}

function matchesSaleDate(sale) {
    const mode = salesDateFilter?.value || "all";
    if (mode === "all") return true;
    const saleDate = sale.fechaOrden ? new Date(sale.fechaOrden) : new Date(sale.fechaIso || 0);
    if (Number.isNaN(saleDate.getTime())) return false;

    const now = new Date();
    if (mode === "today") return sameDay(saleDate, now);
    if (mode === "week") {
        const weekStart = new Date(now);
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        return saleDate >= weekStart;
    }
    if (mode === "month") {
        return saleDate.getFullYear() === now.getFullYear() && saleDate.getMonth() === now.getMonth();
    }
    return true;
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function renderSales() {
    const data = filteredSales();
    const filteredIncome = data.reduce((sum, sale) => sum + sale.total, 0);
    salesSummary.textContent = `${data.length} ventas mostradas - ${formatMoney(filteredIncome)} Bs`;
    salesList.innerHTML = "";

    if (!data.length) {
        salesList.innerHTML = '<div class="empty-row">No hay notas de venta.</div>';
        return;
    }

    salesList.innerHTML = `
        <div class="sales-table">
            <div class="sales-table-head">
                <span>Nota</span>
                <span>Cliente</span>
                <span>Productos</span>
                <span>Vendedor</span>
                <span>Creado</span>
                <span>Total</span>
                <span>Accion</span>
            </div>
            <div class="sales-table-body">
                ${data.map((sale) => `
                    <article class="sale-card" data-sale-card="${escapeHtml(sale.id)}">
                        <button class="sale-card-head sales-row-grid" data-sale-toggle="${escapeHtml(sale.id)}" type="button">
                            <span class="sale-number">${escapeHtml(formatSaleNumber(sale.numero || sale.numeroVista))}</span>
                            <span class="sale-customer">${escapeHtml(sale.cliente || "Cliente")}</span>
                            <span class="sale-muted">${sale.items.length} productos</span>
                            <span class="sale-muted">${escapeHtml(sale.vendedorNombre || "Vendedor")}</span>
                            <span class="sale-muted">${escapeHtml(sale.fechaTexto)}</span>
                            <strong>${formatMoney(sale.total)} Bs</strong>
                            <em>Ver</em>
                        </button>
                        <div class="sale-detail hidden">
                            <div class="sale-detail-top">
                                <div class="sale-detail-data">
                                    <span>Telefono: ${escapeHtml(sale.telefono || "Sin telefono")}</span>
                                    <span>Direccion: ${escapeHtml(sale.direccion || "Sin direccion")}</span>
                                    <span>Pago: ${escapeHtml(sale.metodoPago || "Efectivo")}</span>
                                </div>
                                <button class="btn-light px-3 py-2 text-sm" data-sale-print="${escapeHtml(sale.id)}" type="button">Imprimir</button>
                            </div>
                            <div class="sale-items">
                                <table>
                                    <thead>
                                        <tr><th>Cod.</th><th>Producto</th><th>Cant.</th><th>Unit.</th><th>Subtotal</th></tr>
                                    </thead>
                                    <tbody>
                                        ${sale.items.map((item) => `
                                            <tr>
                                                <td>${escapeHtml(item.codigo)}</td>
                                                <td>${escapeHtml(item.nombre)}</td>
                                                <td>${item.cantidad}</td>
                                                <td>${formatMoney(item.precio)} Bs</td>
                                                <td>${formatMoney(item.subtotal)} Bs</td>
                                            </tr>
                                        `).join("")}
                                    </tbody>
                                </table>
                            </div>
                            <div class="sale-totals-line">
                                <span>Subtotal: ${formatMoney(sale.subtotal || sale.total)} Bs</span>
                                <span>Descuento: ${formatMoney(sale.descuento || 0)} Bs</span>
                                <strong>Total: ${formatMoney(sale.total)} Bs</strong>
                            </div>
                        </div>
                    </article>
                `).join("")}
            </div>
        </div>
    `;
}

function renderAnalysis() {
    const income = sales.reduce((sum, sale) => sum + sale.total, 0);
    const units = sales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cantidad, 0), 0);
    const todayIncome = sales
        .filter((sale) => sameDay(new Date(sale.fechaOrden || sale.fechaIso || 0), new Date()))
        .reduce((sum, sale) => sum + sale.total, 0);
    metricSales.textContent = sales.length;
    metricIncome.textContent = `${formatMoney(income)} Bs`;
    metricUnits.textContent = units;

    const productMap = new Map();
    const dayMap = new Map();
    const findProductForSaleItem = (item) => products.find((product) =>
        product.id === item.productId ||
        product.codigo === item.codigo ||
        product.nombre === item.nombre
    );
    sales.forEach((sale) => {
        const day = sale.fechaIso ? sale.fechaIso.slice(0, 10) : "Sin fecha";
        dayMap.set(day, (dayMap.get(day) || 0) + sale.total);
        sale.items.forEach((item) => {
            const key = item.productId || item.codigo || item.nombre;
            const product = findProductForSaleItem(item);
            const current = productMap.get(key) || {
                nombre: item.nombre,
                codigo: item.codigo,
                cantidad: 0,
                total: 0,
                imagenUrl: product?.imagenUrl || ""
            };
            if (!current.imagenUrl && product?.imagenUrl) current.imagenUrl = product.imagenUrl;
            current.cantidad += item.cantidad;
            current.total += item.subtotal;
            productMap.set(key, current);
        });
    });

    const rankedProducts = [...productMap.values()].sort((a, b) => b.cantidad - a.cantidad);
    metricToday.textContent = `${formatMoney(todayIncome)} Bs`;
    metricTop.textContent = rankedProducts[0]?.nombre || "Sin ventas";
    topProducts.innerHTML = renderRank(rankedProducts.slice(0, 8), (item) => `${item.cantidad} unid. - ${formatMoney(item.total)} Bs`, "No hay productos vendidos.", true);
    salesByDay.innerHTML = renderRank([...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([day, total]) => ({ nombre: day, codigo: "", total })), (item) => `${formatMoney(item.total)} Bs`, "No hay ventas por dia.");
}

function renderRank(items, rightText, emptyText, showMedia = false) {
    if (!items.length) return `<p class="rounded-lg border border-dashed border-[#b8c7cf] bg-[#f7fafb] p-4 text-sm text-[#60727d]">${emptyText}</p>`;
    const values = items.map((item) => Number(item.cantidad ?? item.total ?? 0));
    const maxValue = Math.max(...values, 1);
    if (showMedia) {
        return `
            <div class="analysis-leaderboard">
                <div class="analysis-leader-head">
                    <span>Nro.</span>
                    <span>Imagen</span>
                    <span>Producto / cantidad / total</span>
                    <span>%</span>
                </div>
                ${items.map((item, index) => {
                    const rankValue = Math.max(6, (Number(item.cantidad ?? item.total ?? 0) / maxValue) * 100);
                    const media = item.imagenUrl
                        ? `<img class="analysis-leader-image" src="${escapeHtml(item.imagenUrl)}" alt="${escapeHtml(item.nombre)}">`
                        : `<span class="analysis-leader-code">${escapeHtml(item.codigo || "--")}</span>`;
                    return `
                        <article class="analysis-leader-row" style="--rank:${rankValue}%">
                            <span class="analysis-leader-number">${index + 1}</span>
                            <div class="analysis-leader-media">${media}</div>
                            <div class="analysis-leader-track">
                                <i class="analysis-leader-fill" aria-hidden="true"></i>
                                <strong class="analysis-leader-name">${escapeHtml(item.nombre)}</strong>
                                <span class="analysis-leader-units">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h15l-1.6 7.2a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.8H3"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>
                                    ${Number(item.cantidad || 0)} unid.
                                </span>
                                <em class="analysis-leader-total">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h8.5a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 8V5"/><path d="M7 15v4"/><path d="M12 8V5"/><path d="M12 15v4"/></svg>
                                    ${formatMoney(item.total)} Bs
                                </em>
                            </div>
                            <span class="analysis-leader-percent">${Math.round(rankValue)}%</span>
                        </article>
                    `;
                }).join("")}
            </div>
        `;
    }
    if (!showMedia) {
        return `
            <div class="analysis-leaderboard analysis-dayboard">
                <div class="analysis-leader-head">
                    <span>Nro.</span>
                    <span>Dia</span>
                    <span>Ventas del dia</span>
                    <span>%</span>
                </div>
                ${items.map((item, index) => {
                    const rankValue = Math.max(6, (Number(item.total ?? item.cantidad ?? 0) / maxValue) * 100);
                    return `
                        <article class="analysis-leader-row" style="--rank:${rankValue}%">
                            <span class="analysis-leader-number">${index + 1}</span>
                            <div class="analysis-leader-media"><span class="analysis-day-token">Dia</span></div>
                            <div class="analysis-leader-track">
                                <i class="analysis-leader-fill" aria-hidden="true"></i>
                                <strong class="analysis-leader-name">${escapeHtml(item.nombre)}</strong>
                                <span class="analysis-leader-units">Ventas</span>
                                <em class="analysis-leader-total">${rightText(item)}</em>
                            </div>
                            <span class="analysis-leader-percent">${Math.round(rankValue)}%</span>
                        </article>
                    `;
                }).join("")}
            </div>
        `;
    }
    const listClass = showMedia ? "rank-list rank-list-products" : "rank-list rank-list-days";
    return `
        <div class="${listClass}">
            <div class="rank-list-head">
                ${showMedia ? `
                    <span>N°</span>
                    <span>Imagen</span>
                    <span>Producto / cantidad / total</span>
                    <span>%</span>
                ` : `
                    <span>#</span>
                    <span>Dia</span>
                    <span>Total</span>
                `}
            </div>
            ${items.map((item, index) => {
                const rankValue = Math.max(5, (Number(item.cantidad ?? item.total ?? 0) / maxValue) * 100);
                const media = showMedia
                    ? item.imagenUrl
                        ? `<img class="rank-product-image" src="${escapeHtml(item.imagenUrl)}" alt="${escapeHtml(item.nombre)}">`
                        : `<span class="rank-product-code">${escapeHtml(item.codigo || "--")}</span>`
                    : "";
                if (showMedia) {
                    return `
                        <div class="rank-row has-media" style="--rank:${rankValue}%">
                            <div class="rank-content rank-product-row">
                                <span class="rank-index">${index + 1}</span>
                                ${media}
                                <div class="rank-data-bar">
                                    <i aria-hidden="true"></i>
                                    <strong>${escapeHtml(item.nombre)}</strong>
                                    <span class="rank-data-units">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h15l-1.6 7.2a2 2 0 0 1-2 1.6H9.1a2 2 0 0 1-2-1.7L5.8 4.8H3"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>
                                        ${Number(item.cantidad || 0)} unid.
                                    </span>
                                    <em class="rank-data-total">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h8.5a3.5 3.5 0 0 1 0 7H7z"/><path d="M7 8V5"/><path d="M7 15v4"/><path d="M12 8V5"/><path d="M12 15v4"/></svg>
                                        ${formatMoney(item.total)} Bs
                                    </em>
                                </div>
                                <span class="rank-percent">${Math.round(rankValue)}%</span>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="rank-row" style="--rank:${rankValue}%">
                        <div class="rank-content">
                            <span class="rank-index">${index + 1}</span>
                            <div class="rank-product-info">
                                <strong>${escapeHtml(item.nombre)}</strong>
                                <small>Ventas registradas</small>
                            </div>
                            <em>${rightText(item)}</em>
                        </div>
                        <i class="rank-bar" aria-hidden="true"></i>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function noteFieldHtml(value, options = {}) {
    const raw = String(value || "").trim();
    const text = options.hideDefaultClient && raw.toLowerCase() === "cliente" ? "" : raw;
    return `<span class="${text ? "" : "is-empty"}">${escapeHtml(text)}</span>`;
}

function renderSaleNote(sale) {
    const subtotal = Number(sale.subtotal || sale.total || 0);
    const discount = Number(sale.descuento || 0);
    const noteNumber = formatSaleNumber(sale.numero || sale.numeroVista);
    const fecha = escapeHtml(sale.fechaTexto || "");
    const items = Array.isArray(sale.items) ? sale.items : [];
    salePrintArea.classList.remove("hidden");
    salePrintArea.innerHTML = `
        <div class="note-page">
            <header class="note-hero">
                <div class="note-logo"><span>S</span><strong>PRODUCTOS<br>SXMY</strong></div>
                <div class="note-brand">
                    <h1><span>PRODUCTOS</span> SXMY</h1>
                    <p>ELECTRONICA - ROBOTICA - ACCESORIOS</p>
                    <em>Calidad que impulsa tus ideas</em>
                </div>
                <div class="note-box">
                    <h2>NOTA DE VENTA</h2>
                    <p><strong>N DE NOTA:</strong> <span>${escapeHtml(noteNumber)}</span></p>
                    <p><strong>FECHA:</strong> ${fecha}</p>
                </div>
            </header>
            <p class="note-thanks">Gracias por su compra!</p>
            <section class="note-client">
                <div class="note-client-lines">
                    <p><strong>Cliente:</strong>${noteFieldHtml(sale.cliente, { hideDefaultClient: true })}</p>
                    <p><strong>Direccion:</strong>${noteFieldHtml(sale.direccion)}</p>
                    <p><strong>Telefono:</strong>${noteFieldHtml(sale.telefono)}</p>
                </div>
            </section>
            <table class="note-table">
                <thead><tr><th>N</th><th>CODIGO</th><th>CANT.</th><th>DETALLE</th><th>P. UNITARIO</th><th>SUBTOTAL</th></tr></thead>
                <tbody>
                    ${items.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${escapeHtml(item.codigo || "")}</td>
                            <td>${escapeHtml(String(item.cantidad || ""))}</td>
                            <td>${escapeHtml(item.nombre)}</td>
                            <td>${formatMoney(item.precio)} Bs</td>
                            <td>${formatMoney(item.subtotal)} Bs</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            <section class="note-summary">
                <div class="note-payment">
                    <h3>METODO DE PAGO</h3>
                    <p><span>${sale.metodoPago === "Efectivo" ? "X" : ""}</span> Efectivo</p>
                    <p><span>${sale.metodoPago === "Transferencia" ? "X" : ""}</span> Transferencia</p>
                </div>
                <div class="note-totals">
                    <p><strong>SUBTOTAL:</strong><span>${formatMoney(subtotal)} Bs</span></p>
                    <p><strong>DESCUENTO:</strong><span>${formatMoney(discount)} Bs</span></p>
                    <p class="note-pay"><strong>TOTAL A PAGAR:</strong><span>${formatMoney(sale.total)} Bs</span></p>
                </div>
            </section>
            <p class="note-script">Gracias por confiar en Productos Sxmy!</p>
            <footer class="note-footer">
                <div class="note-footer-item">
                    <span class="note-footer-icon note-whatsapp-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="img"><path d="M12.04 2.5a9.35 9.35 0 0 0-7.94 14.28L3 21.5l4.84-1.07A9.36 9.36 0 1 0 12.04 2.5Zm0 1.75a7.61 7.61 0 0 1 6.44 11.7 7.58 7.58 0 0 1-9.9 2.73l-.3-.16-2.8.62.63-2.72-.18-.31a7.6 7.6 0 0 1 6.11-11.86Zm-3.3 3.82c-.15 0-.4.06-.61.29-.21.23-.8.78-.8 1.9s.82 2.2.93 2.35c.12.15 1.58 2.54 3.9 3.45 1.93.76 2.33.61 2.75.57.42-.04 1.35-.55 1.54-1.08.19-.53.19-.99.13-1.08-.06-.1-.21-.15-.44-.27-.23-.11-1.35-.67-1.56-.74-.21-.08-.36-.12-.52.11-.15.23-.6.74-.73.89-.13.15-.27.17-.5.06-.23-.12-.97-.36-1.84-1.14-.68-.61-1.14-1.36-1.27-1.59-.13-.23-.01-.35.1-.47.1-.1.23-.27.34-.4.11-.13.15-.23.23-.38.08-.15.04-.29-.02-.4-.06-.11-.52-1.25-.71-1.71-.19-.44-.38-.38-.52-.39h-.45Z"/></svg>
                    </span>
                    <div><strong>NUMERO CELULAR</strong><span>77755897</span></div>
                </div>
                <div class="note-footer-item">
                    <span class="note-footer-icon note-location-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="img"><path d="M12 2.75a7.1 7.1 0 0 0-7.1 7.1c0 4.68 5.76 10.63 6.01 10.88a1.52 1.52 0 0 0 2.18 0c.25-.25 6.01-6.2 6.01-10.88A7.1 7.1 0 0 0 12 2.75Zm0 9.6a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>
                    </span>
                    <div><strong>UBICACION</strong><span>Caranavi<br>Frente Colegio Kennedy</span></div>
                </div>
                <div class="note-footer-item"><div><strong>PRODUCTOS SXMY</strong><span>Tecnologia, creatividad y soluciones en un solo lugar.</span></div></div>
            </footer>
        </div>
    `;
}

function showSection(name) {
    const target = ["productos", "historial", "analisis"].includes(name) ? name : "productos";
    const titles = {
        productos: "Productos",
        historial: "Historial",
        analisis: "Analisis"
    };
    document.querySelectorAll(".admin-section").forEach((section) => section.classList.add("hidden"));
    document.getElementById(`${target}Section`).classList.remove("hidden");
    document.querySelectorAll("[data-section-target]").forEach((button) => button.classList.toggle("active", button.dataset.sectionTarget === target));
    if (adminTopTitle) adminTopTitle.textContent = titles[target];
    if (location.hash !== `#${target}`) history.replaceState(null, "", `#${target}`);
    closeSidebar();
}

function openSidebar() {
    document.body.classList.add("sidebar-open");
}

function closeSidebar() {
    document.body.classList.remove("sidebar-open");
}

function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("sxmy-sidebar-collapsed", collapsed ? "1" : "0");
    sidebarCollapse?.setAttribute("aria-label", collapsed ? "Expandir menu" : "Contraer menu");
    sidebarCollapse?.setAttribute("title", collapsed ? "Expandir menu" : "Contraer menu");
}

function initSidebarCollapse() {
    const collapsed = localStorage.getItem("sxmy-sidebar-collapsed") === "1";
    setSidebarCollapsed(collapsed);
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!codigo.value.trim() || !nombre.value.trim()) { setStatus("Codigo y nombre son obligatorios.", "warn"); return; }
    const existingProduct = products.find((item) => item.id === productId.value);
    const priceData = pricePayload(existingProduct, precioVenta.value);
    try {
        setStatus("Guardando producto...");
        await saveProduct({
            codigo: codigo.value,
            nombre: nombre.value,
            precioCompra: precioCompra.value,
            precioVenta: precioVenta.value,
            stock: stock.value,
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
adminSort.addEventListener("change", renderTable);
onlyNoImage.addEventListener("change", renderTable);
showActiveProducts.addEventListener("change", renderTable);
showDisabledProducts.addEventListener("change", renderTable);
showPriceHistory.addEventListener("change", renderTable);
productViewButtons.forEach((button) => button.addEventListener("click", () => setProductView(button.dataset.productView)));
salesSearch.addEventListener("input", renderSales);
salesDateFilter?.addEventListener("change", renderSales);
resetForm.addEventListener("click", resetProductForm);
openProductModal.addEventListener("click", () => { resetProductForm(); openModal(productModal); nombre.focus(); });
openBulkModal.addEventListener("click", () => openModal(bulkModal));
replaceImage.addEventListener("click", () => rowImageInput.click());
bulkImport.addEventListener("click", importCsvProducts);
downloadTemplate.addEventListener("click", downloadCsvTemplate);
logout.addEventListener("click", async () => { await signOut(auth); window.location.href = "login.html"; });
salesList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-sale-toggle]");
    if (toggle) {
        const card = toggle.closest("[data-sale-card]");
        const detail = card?.querySelector(".sale-detail");
        if (detail) {
            detail.classList.toggle("hidden");
            card.classList.toggle("sale-open", !detail.classList.contains("hidden"));
        }
        return;
    }
    const button = event.target.closest("[data-sale-print]");
    if (!button) return;
    const sale = sales.find((item) => item.id === button.dataset.salePrint);
    if (!sale) return;
    renderSaleNote(sale);
    requestAnimationFrame(() => window.print());
});

document.querySelectorAll("[data-section-target]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.sectionTarget));
});
sidebarToggle.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);
sidebarCollapse?.addEventListener("click", () => setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed")));
initSidebarCollapse();
window.addEventListener("hashchange", () => showSection(location.hash.replace("#", "")));
document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
        closeModal(productModal);
        closeModal(bulkModal);
        closeModal(imageModal);
        closeDeleteProductModal();
    });
});
[productModal, bulkModal, imageModal, deleteProductModal].forEach((modal) => {
    modal.addEventListener("click", (event) => {
        if (event.target !== modal) return;
        if (modal === deleteProductModal) closeDeleteProductModal();
        else closeModal(modal);
    });
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal(productModal);
        closeModal(bulkModal);
        closeModal(imageModal);
        closeDeleteProductModal();
    }
});

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    showSection(location.hash.replace("#", ""));
    loadAll();
});
