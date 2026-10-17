import { escapeHtml, getProducts } from "../../shared/services/product-service.js";
import { setupThemeToggle } from "../../shared/theme/theme.js?v=2";
import { availableCatalogLetters, filterCatalogProducts, formatCatalogMoney, productHasStock, stockLabel } from "../../shared/catalog/catalog-utils.js?v=3";

setupThemeToggle();

let products = [];
let activeInitial = "all";
const grid = document.getElementById("grid");
const search = document.getElementById("search");
const productCount = document.getElementById("productCount");
const visibleProductCount = document.getElementById("visibleProductCount");
const filters = document.getElementById("storeAlphabetFilters");
const statusBox = document.getElementById("statusBox");
const detailModal = document.getElementById("productDetailModal");
const detailClose = document.getElementById("productDetailClose");
const detailContent = document.getElementById("productDetailContent");
const detailCode = document.getElementById("detailCode");
const detailName = document.getElementById("detailName");

function withTimeout(promise, milliseconds) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Tiempo de espera agotado")), milliseconds); })
    ]).finally(() => clearTimeout(timer));
}

function renderFilters() {
    const letters = availableCatalogLetters(products);
    if (activeInitial !== "all" && !letters.includes(activeInitial)) activeInitial = "all";
    filters.innerHTML = ["all", ...letters].map((letter) => {
        const active = letter === activeInitial;
        return `<button class="store-filter-chip ${letter === "all" ? "" : "store-letter-chip"} ${active ? "active" : ""}" data-store-filter="${letter}" type="button" aria-pressed="${active}">${letter === "all" ? "Todos" : letter}</button>`;
    }).join("");
}

function renderProducts() {
    renderFilters();
    const activeProducts = products.filter((product) => product.activo !== false);
    const visible = filterCatalogProducts(products, search.value, activeInitial);
    productCount.textContent = `${activeProducts.length} productos`;
    visibleProductCount.textContent = `${visible.length} visibles`;
    grid.setAttribute("aria-busy", "false");
    grid.removeAttribute("aria-label");
    if (!visible.length) {
        grid.innerHTML = `<div class="public-empty">${products.length ? "No se encontraron productos." : "Todavia no hay productos disponibles."}</div>`;
        return;
    }
    grid.innerHTML = visible.map((product, index) => `
        <article class="product-card public-product-card ${!product.imagenUrl ? "state-no-image" : ""} ${!productHasStock(product) ? "state-out-stock" : ""}" data-detail-product="${escapeHtml(product.id)}" tabindex="0" role="button" aria-label="Ver ${escapeHtml(product.nombre)}">
            <div class="product-image-shell">
                <span class="code-pill image-code-pill">${escapeHtml(product.codigo)}</span>
                ${product.imagenUrl
                    ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}" loading="${index < 3 ? "eager" : "lazy"}" decoding="async">`
                    : '<div class="no-image">Sin imagen</div>'}
            </div>
            <div class="product-card-body">
                <h2>${escapeHtml(product.nombre)}</h2>
                <div class="price-stock-row">
                    <p class="product-price">${formatCatalogMoney(product.precioVenta)} Bs</p>
                    <span class="stock-pill ${productHasStock(product) ? "stock-ok" : "stock-out"}">${stockLabel(product)}</span>
                </div>
                <p class="product-desc">${escapeHtml(product.descripcion || "Sin descripcion")}</p>
                <span class="product-detail-link">Ver detalle</span>
            </div>
        </article>
    `).join("");
}

function closeDetail() {
    detailModal.classList.add("hidden");
    detailModal.classList.remove("flex");
}

function openDetail(id) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    detailCode.textContent = product.codigo || "Producto";
    detailName.textContent = product.nombre || "Detalle";
    detailContent.innerHTML = `
        <button class="product-detail-image" data-close-product-detail type="button" aria-label="Cerrar detalle">
            ${product.imagenUrl ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}">` : '<span class="no-image">Sin imagen</span>'}
        </button>
        <div class="product-detail-copy">
            <div><span>Precio</span><strong>${formatCatalogMoney(product.precioVenta)} Bs</strong></div>
            <div><span>Stock</span><strong>${stockLabel(product)}</strong></div>
            <p>${escapeHtml(product.descripcion || "Sin descripcion")}</p>
        </div>`;
    detailModal.classList.remove("hidden");
    detailModal.classList.add("flex");
    detailClose.focus();
}

grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-detail-product]");
    if (card) openDetail(card.dataset.detailProduct);
});
grid.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const card = event.target.closest("[data-detail-product]");
    if (!card) return;
    event.preventDefault();
    openDetail(card.dataset.detailProduct);
});
search.addEventListener("input", renderProducts);
filters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-store-filter]");
    if (!button) return;
    activeInitial = button.dataset.storeFilter;
    renderProducts();
});
detailClose.addEventListener("click", closeDetail);
detailModal.addEventListener("click", (event) => {
    if (event.target === detailModal || event.target.closest("[data-close-product-detail]")) closeDetail();
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDetail(); });

try {
    products = await withTimeout(getProducts(), 8000);
    renderProducts();
} catch (error) {
    console.error(error);
    grid.innerHTML = '<div class="public-empty">No se pudo cargar el catalogo. Revisa tu conexion e intenta nuevamente.</div>';
    grid.setAttribute("aria-busy", "false");
    productCount.textContent = "Sin conexion";
    visibleProductCount.textContent = "0 visibles";
    statusBox.textContent = "No se pudo conectar con el catalogo.";
    statusBox.classList.remove("hidden");
}
