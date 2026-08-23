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
import { dateTimeText, formatMoney, getSales } from "./sales-service.js";

let products = [];
let sales = [];
let pendingImageProduct = null;

const productModal = document.getElementById("productModal");
const bulkModal = document.getElementById("bulkModal");
const imageModal = document.getElementById("imageModal");
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
const search = document.getElementById("adminSearch");
const adminSort = document.getElementById("adminSort");
const onlyNoImage = document.getElementById("onlyNoImage");
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
const salesList = document.getElementById("salesList");
const salesSummary = document.getElementById("salesSummary");
const salesSearch = document.getElementById("salesSearch");
const salePrintArea = document.getElementById("salePrintArea");
const metricSales = document.getElementById("metricSales");
const metricIncome = document.getElementById("metricIncome");
const metricUnits = document.getElementById("metricUnits");
const topProducts = document.getElementById("topProducts");
const salesByDay = document.getElementById("salesByDay");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarClose = document.getElementById("sidebarClose");
const sidebarOverlay = document.getElementById("sidebarOverlay");

function setStatus(message, tone = "info") {
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
    let data = [...products];
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

    const sorters = {
        codigo: (a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }),
        "precio-asc": (a, b) => Number(a.precioVenta) - Number(b.precioVenta),
        "precio-desc": (a, b) => Number(b.precioVenta) - Number(a.precioVenta),
        stock: (a, b) => stockValue(b) - stockValue(a),
        nombre: (a, b) => a.nombre.localeCompare(b.nombre, "es"),
        fecha: (a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0)
    };
    return data.sort(sorters[adminSort.value] || sorters.codigo);
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

function renderTable() {
    const data = filteredProducts();
    totalProducts.textContent = `${products.length} productos - ${products.filter((item) => !item.imagenUrl).length} sin imagen`;
    table.innerHTML = "";

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-sm text-[#60727d]">No hay productos con esos filtros.</td></tr>';
        return;
    }

    data.forEach((product) => {
        const stockText = product.stock === "" ? "Opcional" : product.stock;
        const toggleText = product.activo !== false ? "Deshabilitar" : "Habilitar";
        const imageCell = product.imagenUrl
            ? `<button class="image-thumb" data-action="preview-image" data-id="${escapeHtml(product.id)}"><img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}"></button>`
            : `<button class="btn-light px-3 py-2 text-xs" data-action="image" data-id="${escapeHtml(product.id)}">+ imagen</button>`;

        table.insertAdjacentHTML("beforeend", `
            <tr class="border-b border-[#d6e0e6] last:border-0 hover:bg-[#f7fafb]">
                <td class="px-4 py-3">${imageCell}</td>
                <td class="px-4 py-3 font-black text-[#12313f]">${escapeHtml(product.codigo)}</td>
                <td class="min-w-64 px-4 py-3">
                    <p class="font-semibold text-[#111827]">${escapeHtml(product.nombre)}</p>
                    <p class="mt-1 line-clamp-2 text-xs text-[#60727d]">${escapeHtml(product.descripcion)}</p>
                </td>
                <td class="px-4 py-3 text-[#374151]">${formatMoney(product.precioCompra)} Bs</td>
                <td class="px-4 py-3">
                    <p class="font-black text-[#111827]">${formatMoney(product.precioVenta)} Bs</p>
                    ${product.precioAnterior !== "" && product.precioAnterior !== product.precioVenta ? `<p class="text-xs font-bold text-[#84939b] line-through">${formatMoney(product.precioAnterior)} Bs</p>` : ""}
                    ${priceHistoryHtml(product)}
                </td>
                <td class="px-4 py-3 text-[#374151]">${escapeHtml(stockText)}</td>
                <td class="px-4 py-3 text-xs text-[#60727d]">${productDate(product)}</td>
                <td class="px-4 py-3"><span class="status-pill">${product.activo !== false ? "Habilitado" : "Deshabilitado"}</span></td>
                <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-2">
                        <button class="btn-primary px-3 py-2 text-xs" data-action="edit" data-id="${escapeHtml(product.id)}">Editar</button>
                        <button class="btn-light px-3 py-2 text-xs" data-action="toggle" data-id="${escapeHtml(product.id)}">${toggleText}</button>
                        <button class="btn-danger px-3 py-2 text-xs" data-action="delete" data-id="${escapeHtml(product.id)}">Eliminar</button>
                    </div>
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
    if (!query) return sales;
    return sales.filter((sale) =>
        sale.cliente.toLowerCase().includes(query) ||
        sale.id.toLowerCase().includes(query) ||
        sale.items.some((item) =>
            item.codigo.toLowerCase().includes(query) ||
            item.nombre.toLowerCase().includes(query)
        )
    );
}

function renderSales() {
    const data = filteredSales();
    const totalIncome = sales.reduce((sum, sale) => sum + sale.total, 0);
    salesSummary.textContent = `${sales.length} ventas registradas - ${formatMoney(totalIncome)} Bs`;
    salesList.innerHTML = "";

    if (!data.length) {
        salesList.innerHTML = '<div class="rounded-lg border border-dashed border-[#b8c7cf] bg-white p-8 text-center text-sm text-[#60727d]">No hay notas de venta.</div>';
        return;
    }

    data.forEach((sale) => {
        salesList.insertAdjacentHTML("beforeend", `
            <article class="sale-card" data-sale-card="${escapeHtml(sale.id)}">
                <button class="sale-card-head" data-sale-toggle="${escapeHtml(sale.id)}" type="button">
                    <div class="sale-main">
                        <span class="sale-date">${escapeHtml(sale.fechaTexto)}</span>
                        <strong>${escapeHtml(sale.cliente || "Cliente")}</strong>
                        <small>Nota ${escapeHtml(sale.numero || sale.id)} - ${sale.items.length} productos - ${escapeHtml(sale.vendedorNombre || "Vendedor")}</small>
                    </div>
                    <div class="sale-side">
                        <span>${formatMoney(sale.total)} Bs</span>
                        <em>Ver detalle</em>
                    </div>
                </button>
                <div class="sale-detail hidden">
                    <div class="sale-detail-top">
                        <div>
                            <strong>Datos de la venta</strong>
                            <p>Telefono: ${escapeHtml(sale.telefono || "Sin telefono")}</p>
                            <p>Direccion: ${escapeHtml(sale.direccion || "Sin direccion")}</p>
                            <p>Pago: ${escapeHtml(sale.metodoPago || "Efectivo")}</p>
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
        `);
    });
}

function renderAnalysis() {
    const income = sales.reduce((sum, sale) => sum + sale.total, 0);
    const units = sales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cantidad, 0), 0);
    metricSales.textContent = sales.length;
    metricIncome.textContent = `${formatMoney(income)} Bs`;
    metricUnits.textContent = units;

    const productMap = new Map();
    const dayMap = new Map();
    sales.forEach((sale) => {
        const day = sale.fechaIso ? sale.fechaIso.slice(0, 10) : "Sin fecha";
        dayMap.set(day, (dayMap.get(day) || 0) + sale.total);
        sale.items.forEach((item) => {
            const key = item.productId || item.codigo || item.nombre;
            const current = productMap.get(key) || { nombre: item.nombre, codigo: item.codigo, cantidad: 0, total: 0 };
            current.cantidad += item.cantidad;
            current.total += item.subtotal;
            productMap.set(key, current);
        });
    });

    topProducts.innerHTML = renderRank([...productMap.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 8), (item) => `${item.cantidad} unid. - ${formatMoney(item.total)} Bs`, "No hay productos vendidos.");
    salesByDay.innerHTML = renderRank([...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([day, total]) => ({ nombre: day, codigo: "", total })), (item) => `${formatMoney(item.total)} Bs`, "No hay ventas por dia.");
}

function renderRank(items, rightText, emptyText) {
    if (!items.length) return `<p class="rounded-lg border border-dashed border-[#b8c7cf] bg-[#f7fafb] p-4 text-sm text-[#60727d]">${emptyText}</p>`;
    return items.map((item, index) => `
        <div class="rank-row">
            <span>${index + 1}</span>
            <div>
                <strong>${escapeHtml(item.nombre)}</strong>
                ${item.codigo ? `<small>${escapeHtml(item.codigo)}</small>` : ""}
            </div>
            <em>${rightText(item)}</em>
        </div>
    `).join("");
}

function renderSaleNote(sale) {
    const subtotal = Number(sale.subtotal || sale.total || 0);
    const discount = Number(sale.descuento || 0);
    const noteNumber = String(sale.numero || sale.id || "0001-000000").toUpperCase();
    const fecha = escapeHtml(sale.fechaTexto || "");
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
                    <p><strong>Cliente:</strong><span>${escapeHtml(sale.cliente || "")}</span></p>
                    <p><strong>Direccion:</strong><span>${escapeHtml(sale.direccion || "")}</span></p>
                    <p><strong>Telefono:</strong><span>${escapeHtml(sale.telefono || "")}</span></p>
                </div>
                <div class="note-cart-icon">CARRITO</div>
            </section>
            <table class="note-table">
                <thead><tr><th>CANT.</th><th>DETALLE</th><th>P. UNITARIO</th><th>SUBTOTAL</th></tr></thead>
                <tbody>
                    ${sale.items.map((item) => `
                        <tr>
                            <td>${item.cantidad}</td>
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
                <div><strong>NUMERO CELULAR</strong><span>77755897</span></div>
                <div><strong>UBICACION</strong><span>Caranavi<br>Frente Colegio Kennedy</span></div>
                <div><strong>PRODUCTOS SXMY</strong><span>Tecnologia, creatividad y soluciones en un solo lugar.</span></div>
            </footer>
        </div>
    `;
}

function showSection(name) {
    const target = ["productos", "historial", "analisis"].includes(name) ? name : "productos";
    document.querySelectorAll(".admin-section").forEach((section) => section.classList.add("hidden"));
    document.getElementById(`${target}Section`).classList.remove("hidden");
    document.querySelectorAll("[data-section-target]").forEach((button) => button.classList.toggle("active", button.dataset.sectionTarget === target));
    if (location.hash !== `#${target}`) history.replaceState(null, "", `#${target}`);
    closeSidebar();
}

function openSidebar() {
    document.body.classList.add("sidebar-open");
}

function closeSidebar() {
    document.body.classList.remove("sidebar-open");
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

table.addEventListener("click", async (event) => {
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
        if (!confirm(`Eliminar ${product.nombre}?`)) return;
        await deleteProduct(product.id);
        await loadProducts();
        setStatus("Producto eliminado.", "ok");
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
salesSearch.addEventListener("input", renderSales);
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
    window.print();
});

document.querySelectorAll("[data-section-target]").forEach((button) => {
    button.addEventListener("click", () => showSection(button.dataset.sectionTarget));
});
sidebarToggle.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarOverlay.addEventListener("click", closeSidebar);
window.addEventListener("hashchange", () => showSection(location.hash.replace("#", "")));
document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
        closeModal(productModal);
        closeModal(bulkModal);
        closeModal(imageModal);
    });
});
[productModal, bulkModal, imageModal].forEach((modal) => {
    modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(modal); });
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal(productModal);
        closeModal(bulkModal);
        closeModal(imageModal);
    }
});

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    showSection(location.hash.replace("#", ""));
    loadAll();
});
