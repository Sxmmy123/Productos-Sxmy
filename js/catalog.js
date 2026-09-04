import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { escapeHtml, getProducts, updateProduct } from "./product-service.js";
import { formatMoney, formatSaleNumber, saveSale as saveSaleRecord } from "./sales-service.js";
import { getUserProfile } from "./user-service.js";
import { setupThemeToggle } from "./theme-service.js";

setupThemeToggle();

let products = [];
let cart = [];
let currentUser = null;
let currentProfile = null;
let lastSale = null;
let activeQuickFilter = "all";
let audioContext = null;
let productsLoaded = false;
let storeLoading = true;

const SALE_DRAFT_PREFIX = "productos-sxmy-sale-draft:";

const grid = document.getElementById("grid");
const search = document.getElementById("search");
const list = document.getElementById("cartList");
const total = document.getElementById("total");
const productCount = document.getElementById("productCount");
const clearCart = document.getElementById("clearCart");
const statusBox = document.getElementById("statusBox");
const loginLink = document.getElementById("loginLink");
const adminNav = document.getElementById("adminNav");
const adminBadge = document.getElementById("adminBadge");
const logout = document.getElementById("logout");
const storeHeader = document.querySelector(".store-header");
const storeFilterbar = document.querySelector(".store-filterbar");
const storeMenu = document.getElementById("storeMenu");
const storeMenuToggle = document.getElementById("storeMenuToggle");
const saleMode = document.getElementById("saleMode");
const adminCheckout = document.getElementById("adminCheckout");
const cartToggle = document.getElementById("cartToggle");
const cartBadge = document.getElementById("cartBadge");
const checkoutClose = document.getElementById("checkoutClose");
const openSaleModal = document.getElementById("openSaleModal");
const saleModal = document.getElementById("saleModal");
const saleModalClose = document.getElementById("saleModalClose");
const cancelOrder = document.getElementById("cancelOrder");
const customerName = document.getElementById("customerName");
const customerAddress = document.getElementById("customerAddress");
const customerPhone = document.getElementById("customerPhone");
const paymentMethod = document.getElementById("paymentMethod");
const discountAmount = document.getElementById("discountAmount");
const saveSale = document.getElementById("saveSale");
const printLastSale = document.getElementById("printLastSale");
const saleStatus = document.getElementById("saleStatus");
const salePrintArea = document.getElementById("salePrintArea");
const visibleProductCount = document.getElementById("visibleProductCount");
const storeAlphabetFilters = document.getElementById("storeAlphabetFilters");
const salePreviewModal = document.getElementById("salePreviewModal");
const salePreviewClose = document.getElementById("salePreviewClose");
const salePreviewDismiss = document.getElementById("salePreviewDismiss");
const salePreviewPrint = document.getElementById("salePreviewPrint");
const salePreviewContent = document.getElementById("salePreviewContent");
const productDetailModal = document.getElementById("productDetailModal");
const productDetailClose = document.getElementById("productDetailClose");
const productDetailContent = document.getElementById("productDetailContent");
const detailCode = document.getElementById("detailCode");
const detailName = document.getElementById("detailName");

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Tiempo de espera agotado")), ms))
    ]);
}

function errorDetail(error) {
    return error?.code || error?.message || "sin detalle";
}

function stockLabel(product) {
    if (product.stock === "") return "Stock libre";
    if (Number(product.stock) > 0) return `${product.stock} disp.`;
    return "Sin stock";
}

function canAddMore(product) {
    if (product.stock === "") return true;
    const qty = cart.find((item) => item.id === product.id)?.qty || 0;
    return qty < Number(product.stock || 0);
}

function productHasStock(product) {
    return product.stock === "" || Number(product.stock || 0) > 0;
}

function saleDraftKey(userId = currentUser?.uid) {
    return userId ? `${SALE_DRAFT_PREFIX}${userId}` : "";
}

function saveSaleDraft() {
    const key = saleDraftKey();
    if (!key) return;

    const draft = {
        items: cart.map((item) => ({
            id: item.id,
            codigo: item.codigo,
            nombre: item.nombre,
            descripcion: item.descripcion,
            precioVenta: Number(item.precioVenta || 0),
            stock: item.stock,
            activo: item.activo,
            imagenUrl: item.imagenUrl || "",
            qty: Number(item.qty || 0)
        })),
        descuento: discountAmount.value,
        cliente: customerName.value,
        direccion: customerAddress.value,
        telefono: customerPhone.value,
        metodoPago: paymentMethod.value,
        updatedAt: Date.now()
    };

    try {
        localStorage.setItem(key, JSON.stringify(draft));
    } catch (error) {
        console.warn("No se pudo guardar la orden pendiente.", error);
    }
}

function clearSaleDraft(userId = currentUser?.uid) {
    const key = saleDraftKey(userId);
    if (!key) return;
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.warn("No se pudo limpiar la orden pendiente.", error);
    }
}

function restoreSaleDraft(userId) {
    const key = saleDraftKey(userId);
    if (!key) return 0;

    try {
        const draft = JSON.parse(localStorage.getItem(key) || "null");
        if (!draft || !Array.isArray(draft.items)) return 0;

        cart = draft.items.map((savedItem) => {
            const currentProduct = products.find((product) => product.id === savedItem.id);
            if (productsLoaded && !currentProduct) return null;

            const product = currentProduct || savedItem;
            if (product.activo === false) return null;

            const requestedQty = Math.max(0, Math.floor(Number(savedItem.qty || 0)));
            const qty = product.stock === ""
                ? requestedQty
                : Math.min(requestedQty, Math.max(0, Number(product.stock || 0)));

            return qty > 0 ? { ...product, qty } : null;
        }).filter(Boolean);

        discountAmount.value = draft.descuento ?? "";
        customerName.value = draft.cliente ?? "";
        customerAddress.value = draft.direccion ?? "";
        customerPhone.value = draft.telefono ?? "";
        paymentMethod.value = draft.metodoPago === "Transferencia" ? "Transferencia" : "Efectivo";

        return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    } catch (error) {
        console.warn("La orden pendiente no se pudo recuperar.", error);
        clearSaleDraft(userId);
        return 0;
    }
}

function playCartSound(type) {
    try {
        audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const now = audioContext.currentTime;
        const isAdd = type === "add";

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(isAdd ? 720 : 340, now);
        oscillator.frequency.exponentialRampToValueAtTime(isAdd ? 920 : 260, now + .08);
        gain.gain.setValueAtTime(.001, now);
        gain.gain.exponentialRampToValueAtTime(isAdd ? .08 : .065, now + .012);
        gain.gain.exponentialRampToValueAtTime(.001, now + .12);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + .13);
    } catch {
        // El navegador puede bloquear audio en algunos modos; la venta no debe detenerse por eso.
    }
}

function productStateClass(product) {
    const states = [];
    if (!product.imagenUrl) states.push("state-no-image");
    if (!productHasStock(product)) states.push("state-out-stock");
    return states.join(" ");
}

function productInitial(product) {
    const initial = String(product.nombre || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .charAt(0)
        .toUpperCase();
    return /^[A-Z]$/.test(initial) ? initial : "#";
}

function availableStoreLetters() {
    return [...new Set(products
        .filter((product) => product.activo !== false)
        .map(productInitial))]
        .sort((a, b) => {
            if (a === "#") return 1;
            if (b === "#") return -1;
            return a.localeCompare(b);
        });
}

function renderStoreFilters() {
    if (!storeAlphabetFilters) return;
    const letters = availableStoreLetters();
    if (activeQuickFilter !== "all" && !letters.includes(activeQuickFilter)) {
        activeQuickFilter = "all";
    }
    storeAlphabetFilters.innerHTML = `
        <button class="store-filter-chip ${activeQuickFilter === "all" ? "active" : ""}" data-store-filter="all" type="button" aria-pressed="${activeQuickFilter === "all"}">Todos</button>
        ${letters.map((letter) => `
            <button class="store-filter-chip store-letter-chip ${activeQuickFilter === letter ? "active" : ""}" data-store-filter="${letter}" type="button" aria-pressed="${activeQuickFilter === letter}">${letter}</button>
        `).join("")}
    `;
}

function visibleProducts() {
    const query = search.value.trim().toLowerCase();
    let data = products.filter((product) => product.activo !== false);
    if (query) {
        data = data.filter((product) =>
            product.codigo.toLowerCase().includes(query) ||
            product.nombre.toLowerCase().includes(query) ||
            product.descripcion.toLowerCase().includes(query)
        );
    }
    if (activeQuickFilter !== "all") data = data.filter((product) => productInitial(product) === activeQuickFilter);
    data = [...data].sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));
    return data;
}

function updateStoreFilterButtons() {
    document.querySelectorAll("[data-store-filter]").forEach((button) => {
        const active = button.dataset.storeFilter === activeQuickFilter;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function renderProducts() {
    renderStoreFilters();
    requestAnimationFrame(updateStoreHeaderSpace);
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", String(storeLoading));

    if (storeLoading) {
        productCount.textContent = "Cargando...";
        if (visibleProductCount) visibleProductCount.textContent = "Cargando...";
        grid.innerHTML = storeLoadingState();
        return;
    }

    const data = visibleProducts();
    productCount.textContent = `${data.length} productos`;
    if (visibleProductCount) visibleProductCount.textContent = `${data.length} productos`;
    updateStoreFilterButtons();

    if (!products.length) {
        grid.innerHTML = emptyState("Todavia no hay productos. Entra por Login y agrega el primero.");
        return;
    }

    if (!data.length) {
        grid.innerHTML = emptyState("No se encontraron productos.");
        return;
    }

    data.forEach((product) => {
        const qty = cart.find((item) => item.id === product.id)?.qty || 0;
        const hasImage = Boolean(product.imagenUrl);
        const disabled = !canAddMore(product);
        const adminControls = currentUser ? `
                    <div class="product-actions">
                        <div class="qty-control">
                            <button data-cart="add" data-id="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>+</button>
                            <strong class="qty-value">${qty}</strong>
                            <button data-cart="remove" data-id="${escapeHtml(product.id)}">-</button>
                        </div>
                    </div>
        ` : "";

        const detailAttribute = currentUser ? "" : `data-detail-product="${escapeHtml(product.id)}"`;
        const detailButton = currentUser ? "" : `<button class="product-detail-link" data-detail-product="${escapeHtml(product.id)}" type="button">Ver detalle</button>`;

        grid.insertAdjacentHTML("beforeend", `
            <article class="product-card ${productStateClass(product)}" ${detailAttribute}>
                <div class="product-image-shell">
                    <p class="code-pill image-code-pill">${escapeHtml(product.codigo)}</p>
                    ${hasImage
                        ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}" class="h-full w-full rounded-lg object-contain" loading="lazy">`
                        : `<div class="no-image">Sin imagen</div>`}
                </div>
                <div class="product-card-body">
                    <h3>${escapeHtml(product.nombre)}</h3>
                    <div class="price-stock-row">
                        <p class="product-price">${formatMoney(product.precioVenta)} Bs</p>
                        <p class="stock-pill ${product.stock === "" || product.stock > 0 ? "stock-ok" : "stock-out"}">${stockLabel(product)}</p>
                    </div>
                    <p class="product-desc mt-2 min-h-10 text-sm leading-5 text-[#60727d]">${escapeHtml(product.descripcion)}</p>
                    ${detailButton}
                    ${adminControls}
                </div>
            </article>
        `);
    });
}

function emptyState(message) {
    return `<div class="rounded-lg border border-dashed border-[#b8c7cf] bg-white p-8 text-center text-sm text-[#60727d] sm:col-span-2 xl:col-span-3">${escapeHtml(message)}</div>`;
}

function storeLoadingState() {
    return Array.from({ length: 6 }, () => `
        <article class="product-card product-skeleton" aria-hidden="true">
            <div class="product-image-shell skeleton-block"></div>
            <div class="product-card-body">
                <span class="skeleton-line skeleton-name"></span>
                <span class="skeleton-line skeleton-price"></span>
                <span class="skeleton-line skeleton-short"></span>
            </div>
        </article>
    `).join("");
}

function changeCart(id, direction) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    const item = cart.find((cartItem) => cartItem.id === id);

    if (direction > 0 && !canAddMore(product)) {
        saleStatus.textContent = "No hay mas stock disponible para ese producto.";
        return;
    }

    if (!item && direction > 0) cart.push({ ...product, qty: 1 });
    else if (item) {
        item.qty += direction;
        if (item.qty <= 0) cart = cart.filter((cartItem) => cartItem.id !== id);
    }

    playCartSound(direction > 0 ? "add" : "remove");
    saveSaleDraft();
    renderProducts();
    renderCart();
}

function renderCart() {
    list.innerHTML = "";
    let sum = 0;
    const units = cart.reduce((count, item) => count + Number(item.qty || 0), 0);
    const discount = Math.min(Number(discountAmount.value || 0), cart.reduce((value, item) => value + (item.qty * item.precioVenta), 0));

    if (!cart.length) {
        list.innerHTML = '<li class="rounded-lg border border-dashed border-[#b8c7cf] bg-[#f7fafb] px-3 py-4 text-center text-sm text-[#60727d]">Carrito vacio</li>';
    }

    cart.forEach((item) => {
        const subtotal = item.qty * item.precioVenta;
        sum += subtotal;
        list.insertAdjacentHTML("beforeend", `
            <li class="cart-line">
                <span class="cart-product">${escapeHtml(item.nombre)}</span>
                <span class="cart-unit">${item.qty} unid.</span>
                <strong class="cart-subtotal">${formatMoney(subtotal)} Bs</strong>
                <div class="cart-line-actions">
                    <button type="button" data-cart-line="remove" data-id="${escapeHtml(item.id)}">-</button>
                    <button type="button" data-cart-line="add" data-id="${escapeHtml(item.id)}">+</button>
                    <button type="button" class="cart-delete" data-cart-line="delete" data-id="${escapeHtml(item.id)}">X</button>
                </div>
            </li>
        `);
    });

    total.textContent = formatMoney(Math.max(0, sum - discount));
    cartBadge.textContent = units;
    cartToggle.classList.toggle("has-items", units > 0);
    saveSale.disabled = !currentUser || !cart.length;
    openSaleModal.disabled = !currentUser || !cart.length;
}

async function setAdminState(user) {
    currentUser = user;
    currentProfile = user ? await getUserProfile(user.uid) : null;
    const restoredUnits = user ? restoreSaleDraft(user.uid) : 0;
    loginLink.classList.toggle("hidden", Boolean(user));
    adminBadge.classList.toggle("hidden", !user);
    adminNav.classList.toggle("hidden", !user);
    adminNav.classList.toggle("flex", Boolean(user));
    cartToggle.classList.toggle("hidden", !user);
    closeStoreMenu();
    adminCheckout.classList.add("hidden");
    saleMode.textContent = restoredUnits > 0
        ? `Orden pendiente recuperada: ${restoredUnits} ${restoredUnits === 1 ? "unidad" : "unidades"}.`
        : "La venta se guardara en Historial.";
    saveSale.disabled = !user || !cart.length;
    openSaleModal.disabled = !user || !cart.length;
    if (!user) cart = [];
    renderProducts();
    renderCart();
}

function openCheckout() {
    if (!currentUser) return;
    closeStoreMenu();
    adminCheckout.classList.remove("hidden");
    adminCheckout.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeStoreMenu() {
    storeMenu?.classList.remove("is-open");
    storeMenuToggle?.setAttribute("aria-expanded", "false");
}

function updateStoreHeaderSpace() {
    if (!storeHeader) return;
    const headerHeight = Math.ceil(storeHeader.getBoundingClientRect().height);
    const filterHeight = storeFilterbar ? Math.ceil(storeFilterbar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--store-mobile-header-space", `${headerHeight}px`);
    document.documentElement.style.setProperty("--store-mobile-filter-space", `${filterHeight}px`);
}

function closeCheckout() {
    adminCheckout.classList.add("hidden");
}

function openModal() {
    if (!cart.length) {
        saleStatus.textContent = "Agrega productos antes de crear la nota.";
        return;
    }
    saleModal.classList.remove("hidden");
    saleModal.classList.add("flex");
    customerName.focus();
}

function closeModal() {
    saleModal.classList.add("hidden");
    saleModal.classList.remove("flex");
}

function openOverlay(modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function closeOverlay(modal) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function closePreview() {
    closeOverlay(salePreviewModal);
}

function closeProductDetail() {
    closeOverlay(productDetailModal);
}

function clearOrder() {
    cart = [];
    lastSale = null;
    discountAmount.value = "";
    customerName.value = "";
    customerAddress.value = "";
    customerPhone.value = "";
    paymentMethod.value = "Efectivo";
    clearSaleDraft();
    printLastSale.disabled = true;
    closeModal();
    renderProducts();
    renderCart();
    saleStatus.textContent = "Orden cancelada.";
}

function buildSalePayload() {
    const items = cart.map((item) => ({
        productId: item.id,
        codigo: item.codigo,
        nombre: item.nombre,
        precio: Number(item.precioVenta || 0),
        cantidad: Number(item.qty || 0),
        subtotal: Number(item.qty || 0) * Number(item.precioVenta || 0)
    }));
    return {
        cliente: customerName.value.trim() || "Cliente",
        direccion: customerAddress.value.trim(),
        telefono: customerPhone.value.trim(),
        metodoPago: paymentMethod.value,
        descuento: Number(discountAmount.value || 0),
        vendedorUid: currentUser?.uid || "",
        vendedorNombre: currentProfile?.nombre || currentUser?.email || "Vendedor",
        vendedorEmail: currentUser?.email || "",
        items,
        total: items.reduce((sum, item) => sum + item.subtotal, 0)
    };
}

function renderSalePreview(sale) {
    const subtotal = Number(sale.subtotal || sale.total || 0);
    const discount = Number(sale.descuento || 0);
    renderSaleNote(sale);
    salePreviewContent.innerHTML = `
        <div class="sale-preview-canvas">
            ${salePrintArea.innerHTML}
        </div>
        <div class="sale-preview-summary">
            <div>
                <span>Nota</span>
                <strong>${escapeHtml(formatSaleNumber(sale.numero || sale.numeroVista))}</strong>
            </div>
            <div>
                <span>Cliente</span>
                <strong>${escapeHtml(sale.cliente || "Cliente")}</strong>
            </div>
            <div>
                <span>Total</span>
                <strong>${formatMoney(sale.total)} Bs</strong>
            </div>
        </div>
        <div class="sale-preview-list">
            ${sale.items.map((item) => `
                <div class="sale-preview-item">
                    <span>${escapeHtml(item.codigo)}</span>
                    <strong>${escapeHtml(item.nombre)}</strong>
                    <em>${item.cantidad} x ${formatMoney(item.precio)} Bs</em>
                    <b>${formatMoney(item.subtotal)} Bs</b>
                </div>
            `).join("")}
        </div>
        <div class="sale-preview-totals">
            <span>Subtotal: ${formatMoney(subtotal)} Bs</span>
            <span>Descuento: ${formatMoney(discount)} Bs</span>
            <strong>Total: ${formatMoney(sale.total)} Bs</strong>
        </div>
    `;
}

function openSalePreview(sale) {
    if (!sale) return;
    renderSaleNote(sale);
    renderSalePreview(sale);
    openOverlay(salePreviewModal);
}

function printSale(sale) {
    if (!sale) return;
    renderSaleNote(sale);
    requestAnimationFrame(() => window.print());
}

function noteFieldHtml(value, options = {}) {
    const raw = String(value || "").trim();
    const text = options.hideDefaultClient && raw.toLowerCase() === "cliente" ? "" : raw;
    return `<span class="${text ? "" : "is-empty"}">${escapeHtml(text)}</span>`;
}

function openProductDetail(id) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    detailCode.textContent = product.codigo || "Producto";
    detailName.textContent = product.nombre || "Detalle";
    const hasImage = Boolean(product.imagenUrl);
    productDetailContent.innerHTML = `
        <div class="product-detail-image" data-close-product-detail title="Tocar para cerrar">
            ${hasImage
                ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}">`
                : `<div class="no-image">Sin imagen</div>`}
        </div>
        <div class="product-detail-info">
            <div>
                <span>Precio</span>
                <strong>${formatMoney(product.precioVenta)} Bs</strong>
            </div>
            <div>
                <span>Stock</span>
                <strong>${stockLabel(product)}</strong>
            </div>
            <p>${escapeHtml(product.descripcion || "Sin descripcion")}</p>
        </div>
    `;
    openOverlay(productDetailModal);
}

async function finalizeSale() {
    if (!currentUser) {
        saleStatus.textContent = "Primero inicia sesion como admin.";
        return;
    }
    if (!cart.length) {
        saleStatus.textContent = "Agrega productos antes de guardar.";
        return;
    }

    saveSale.disabled = true;
    saleStatus.textContent = "Guardando nota de venta...";
    try {
        const sale = await saveSaleRecord(buildSalePayload());
        await Promise.all(cart
            .filter((item) => item.stock !== "")
            .map((item) => updateProduct(item.id, { stock: Math.max(0, Number(item.stock || 0) - Number(item.qty || 0)) })));

        lastSale = sale;
        renderSaleNote(sale);
        printLastSale.disabled = false;
        cart = [];
        clearSaleDraft();
        customerName.value = "";
        customerAddress.value = "";
        customerPhone.value = "";
        paymentMethod.value = "Efectivo";
        discountAmount.value = "";
        closeModal();
        products = await getProducts();
        renderProducts();
        renderCart();
        saleStatus.textContent = "Nota creada en Historial. Lista para imprimir.";
        openSalePreview(sale);
    } catch (error) {
        console.error(error);
        saleStatus.textContent = `No se pudo guardar la venta: ${errorDetail(error)}.`;
    } finally {
        renderCart();
    }
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

async function start() {
    try {
        statusBox.classList.add("hidden");
        renderProducts();
        products = await withTimeout(getProducts(), 8000);
        productsLoaded = true;
        if (currentUser) restoreSaleDraft(currentUser.uid);
    } catch (error) {
        console.error(error);
        statusBox.textContent = `No se pudo cargar Firestore: ${errorDetail(error)}. Cuando agregues productos y tengas conexion, apareceran aqui.`;
        statusBox.className = "mb-4 rounded-lg border border-[#b8c7cf] bg-[#f7fafb] px-4 py-3 text-sm text-[#4b5563]";
    }
    storeLoading = false;
    renderProducts();
    renderCart();
}

search.addEventListener("input", renderProducts);
window.addEventListener("load", updateStoreHeaderSpace);
window.addEventListener("resize", updateStoreHeaderSpace);
storeAlphabetFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-store-filter]");
    if (!button) return;
    activeQuickFilter = button.dataset.storeFilter || "all";
    renderProducts();
});
clearCart.addEventListener("click", () => {
    clearOrder();
});
discountAmount.addEventListener("input", () => {
    saveSaleDraft();
    renderCart();
});
[customerName, customerAddress, customerPhone].forEach((field) => {
    field.addEventListener("input", saveSaleDraft);
});
paymentMethod.addEventListener("change", saveSaleDraft);
list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-line]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.cartLine === "add") changeCart(id, 1);
    if (button.dataset.cartLine === "remove") changeCart(id, -1);
    if (button.dataset.cartLine === "delete") {
        cart = cart.filter((item) => item.id !== id);
        playCartSound("remove");
        saveSaleDraft();
        renderProducts();
        renderCart();
    }
});
cancelOrder.addEventListener("click", clearOrder);
cartToggle.addEventListener("click", openCheckout);
checkoutClose.addEventListener("click", closeCheckout);
storeMenuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !storeMenu?.classList.contains("is-open");
    storeMenu?.classList.toggle("is-open", open);
    storeMenuToggle.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
    if (!storeMenu?.classList.contains("is-open")) return;
    if (event.target.closest("#storeMenu") || event.target.closest("#storeMenuToggle")) return;
    closeStoreMenu();
});
storeMenu?.addEventListener("click", (event) => {
    if (event.target.closest("a") || event.target.closest("#logout")) closeStoreMenu();
});
openSaleModal.addEventListener("click", openModal);
saleModalClose.addEventListener("click", closeModal);
saleModal.addEventListener("click", (event) => {
    if (event.target === saleModal) closeModal();
});
salePreviewModal.addEventListener("click", (event) => {
    if (event.target === salePreviewModal) closePreview();
});
productDetailModal.addEventListener("click", (event) => {
    if (event.target === productDetailModal) closeProductDetail();
    if (event.target.closest("[data-close-product-detail]")) closeProductDetail();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal();
        closePreview();
        closeProductDetail();
        closeStoreMenu();
    }
});
grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart]");
    if (button) {
        if (button.disabled) return;
        changeCart(button.dataset.id, button.dataset.cart === "add" ? 1 : -1);
        return;
    }
    if (currentUser) return;
    const card = event.target.closest("[data-detail-product]");
    if (card) openProductDetail(card.dataset.detailProduct);
});
saveSale.addEventListener("click", finalizeSale);
printLastSale.addEventListener("click", () => {
    if (!lastSale) return;
    openSalePreview(lastSale);
});
salePreviewClose.addEventListener("click", closePreview);
salePreviewDismiss.addEventListener("click", closePreview);
salePreviewPrint.addEventListener("click", () => printSale(lastSale));
productDetailClose.addEventListener("click", closeProductDetail);
window.addEventListener("pagehide", saveSaleDraft);
logout.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
});

onAuthStateChanged(auth, setAdminState);
start();
