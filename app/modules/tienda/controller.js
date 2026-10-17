import { escapeHtml, getProducts } from "../../core/data-cache.js?v=2";
import { formatMoney, saveSale as saveSaleRecord } from "../../core/data-cache.js?v=2";
import { closeSidebar as closeStoreMenu } from "../../core/navigation.js?v=9";
import { rememberControls } from "../../core/view-state.js";
import { renderSaleNote, printSaleNote } from "../../shared/sale-note/renderer.js?v=9";
import { availableCatalogLetters, filterCatalogProducts, productHasStock, stockLabel } from "../../shared/catalog/catalog-utils.js?v=3";
import { playCartSound } from "./cart-audio.js";
import { getPreferences, updatePreferences } from "../configuracion/preferences.js";
import {
    clearSaleDraft as clearStoredDraft,
    loadSaleDraft,
    saveSaleDraft as saveStoredDraft
} from "./draft-storage.js";

let products = [];
let cart = [];
let currentUser = null;
let currentProfile = null;
let lastSale = null;
let activeQuickFilter = "all";
let productsLoaded = false;
let storeLoading = true;
let pushbuyEnabled = false;
let authReady = false;
let orderId = crypto.randomUUID();
let pendingSale = null;
let isSaving = false;

const grid = document.getElementById("grid");
const search = document.getElementById("search");
const list = document.getElementById("cartList");
const total = document.getElementById("total");
const clearCart = document.getElementById("clearCart");
const statusBox = document.getElementById("storeStatusBox");
const pushbuyControl = document.getElementById("pushbuyControl");
const pushbuyToggle = document.getElementById("pushbuyToggle");
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
const connectionStatus = document.getElementById("connectionStatus");
const draftStatus = document.getElementById("draftStatus");
const saleModalStatus = document.getElementById("saleModalStatus");
const mobileCheckoutBar = document.getElementById("mobileCheckoutBar");
const mobileCartTotal = document.getElementById("mobileCartTotal");
const mobileCreateNote = document.getElementById("mobileCreateNote");

function updateConnection() {
    connectionStatus.textContent = navigator.onLine ? "Con conexion" : "Sin conexion";
    connectionStatus.dataset.online = String(navigator.onLine);
    renderCart();
}

function saleMessage(message) {
    saleStatus.textContent = message;
    saleModalStatus.textContent = message;
}

async function withTimeout(promise, ms) {
    let timeout;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Tiempo de espera agotado")), ms); })
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

function errorDetail(error) {
    return error?.code || error?.message || "sin detalle";
}

function canAddMore(product) {
    if (product.stock === "") return true;
    const qty = cart.find((item) => item.id === product.id)?.qty || 0;
    return qty < Number(product.stock || 0);
}

function applyPushbuyMode(enabled, persist = false) {
    pushbuyEnabled = Boolean(currentUser && enabled);
    document.body.classList.toggle("pushbuy-enabled", pushbuyEnabled);
    pushbuyControl?.classList.toggle("hidden", !currentUser);
    if (pushbuyToggle) {
        pushbuyToggle.checked = pushbuyEnabled;
        pushbuyToggle.setAttribute("aria-checked", String(pushbuyEnabled));
    }
    if (persist && currentUser) updatePreferences({ general: { pushbuy: pushbuyEnabled } });
}

function saveSaleDraft() {
    if (!currentUser) return;
    const draft = {
        requestId: orderId,
        pendingSale,
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

    if (!cart.length && !pendingSale) {
        clearSaleDraft();
        draftStatus.textContent = "";
        return;
    }
    const stored = saveStoredDraft(currentUser.uid, draft);
    draftStatus.textContent = stored ? "Orden guardada en este dispositivo" : "No se pudo guardar el borrador";
    draftStatus.dataset.error = String(!stored);
}

function clearSaleDraft(userId = currentUser?.uid) {
    clearStoredDraft(userId);
}

function restoreSaleDraft(userId) {
    const draft = loadSaleDraft(userId);
    if (!draft) return 0;

    try {
        orderId = draft.requestId || crypto.randomUUID();
        pendingSale = draft.pendingSale || null;

        cart = draft.items.map((savedItem) => {
            const currentProduct = products.find((product) => product.id === savedItem.id);
            if (productsLoaded && !currentProduct && !pendingSale) return null;

            const product = pendingSale ? savedItem : (currentProduct || savedItem);
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
        draftStatus.textContent = pendingSale ? "Venta pendiente de confirmacion" : "Orden recuperada";

        return cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    } catch (error) {
        console.warn("La orden pendiente no se pudo recuperar.", error);
        clearSaleDraft(userId);
        return 0;
    }
}

function productStateClass(product) {
    const states = [];
    if (!product.imagenUrl) states.push("state-no-image");
    if (!productHasStock(product)) states.push("state-out-stock");
    return states.join(" ");
}

function renderStoreFilters() {
    if (!storeAlphabetFilters) return;
    const letters = availableCatalogLetters(products);
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

function renderProducts() {
    // Authentication and products can arrive in either order. Publish the catalog once both are ready.
    if (storeLoading || !authReady) return;
    renderStoreFilters();
    grid.setAttribute("aria-busy", "false");
    grid.removeAttribute("aria-label");

    const data = filterCatalogProducts(products, search.value, activeQuickFilter);
    if (visibleProductCount) visibleProductCount.textContent = `${data.length} productos`;

    if (!products.length) {
        grid.innerHTML = emptyState("Todavia no hay productos. Agrega el primero desde el modulo Productos.");
        return;
    }

    if (!data.length) {
        grid.innerHTML = emptyState("No se encontraron productos.");
        return;
    }

    grid.innerHTML = data.map((product, index) => {
        const qty = cart.find((item) => item.id === product.id)?.qty || 0;
        const hasImage = Boolean(product.imagenUrl);
        const disabled = !canAddMore(product);
        const adminControls = !pushbuyEnabled ? `
                    <div class="product-actions">
                        <div class="qty-control">
                            <button data-cart="add" data-id="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>+</button>
                            <strong class="qty-value">${qty}</strong>
                            <button data-cart="remove" data-id="${escapeHtml(product.id)}">-</button>
                        </div>
                    </div>
        ` : "";

        const pushbuyAttribute = pushbuyEnabled
            ? `data-pushbuy-product="${escapeHtml(product.id)}" role="button" tabindex="0" aria-disabled="${disabled}" aria-label="Agregar ${escapeHtml(product.nombre)} al carrito"`
            : "";
        const pushbuyQuantity = pushbuyEnabled && qty > 0
            ? `<span class="pushbuy-quantity" aria-label="${qty} ${qty === 1 ? "unidad" : "unidades"} en el carrito">${qty}</span>`
            : "";

        return `
            <article data-product-id="${escapeHtml(product.id)}" class="product-card ${pushbuyEnabled ? `pushbuy-card ${disabled ? "pushbuy-maxed" : ""}` : ""} ${productStateClass(product)}" ${pushbuyAttribute}>
                <div class="product-image-shell">
                    <p class="code-pill image-code-pill">${escapeHtml(product.codigo)}</p>
                    ${pushbuyQuantity}
                    ${hasImage
                        ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}" class="h-full w-full rounded-lg object-contain" loading="${index < 3 ? "eager" : "lazy"}" decoding="async">`
                        : `<div class="no-image">Sin imagen</div>`}
                </div>
                <div class="product-card-body">
                    <h3>${escapeHtml(product.nombre)}</h3>
                    <div class="price-stock-row">
                        <p class="product-price">${formatMoney(product.precioVenta)} Bs</p>
                        <p class="stock-pill ${product.stock === "" || product.stock > 0 ? "stock-ok" : "stock-out"}">${stockLabel(product)}</p>
                    </div>
                    <p class="product-desc mt-2 min-h-10 text-sm leading-5 text-[#60727d]">${escapeHtml(product.descripcion)}</p>
                    ${adminControls}
                </div>
            </article>
        `;
    }).join("");
}

function emptyState(message) {
    return `<div class="rounded-lg border border-dashed border-[#b8c7cf] bg-white p-8 text-center text-sm text-[#60727d] sm:col-span-2 xl:col-span-3">${escapeHtml(message)}</div>`;
}

function changeCart(id, direction, { refreshProducts = true } = {}) {
    if (isSaving || pendingSale) return false;
    const product = products.find((item) => item.id === id);
    if (!product) return false;
    const item = cart.find((cartItem) => cartItem.id === id);

    if (direction > 0 && !canAddMore(product)) {
        saleStatus.textContent = "No hay mas stock disponible para ese producto.";
        return false;
    }

    if (!item && direction > 0) cart.push({ ...product, qty: 1 });
    else if (item) {
        item.qty += direction;
        if (item.qty <= 0) cart = cart.filter((cartItem) => cartItem.id !== id);
    }

    playCartSound(direction > 0 ? "add" : "remove");
    saveSaleDraft();
    if (refreshProducts) updateProductQuantities();
    renderCart();
    return true;
}

function updateProductQuantities() {
    const productsById = new Map(products.map((product) => [product.id, product]));
    grid.querySelectorAll("[data-product-id]").forEach((card) => {
        const product = productsById.get(card.dataset.productId);
        if (!product) return;
        const quantity = card.querySelector(".qty-value");
        if (quantity) quantity.textContent = cart.find((item) => item.id === product.id)?.qty || 0;
        const add = card.querySelector('[data-cart="add"]');
        if (add) add.disabled = !canAddMore(product);
        if (pushbuyEnabled) updatePushbuyCardQuantity(card, product);
    });
}

function updatePushbuyCardQuantity(card, product) {
    if (!card || !product) return;
    const qty = cart.find((item) => item.id === product.id)?.qty || 0;
    const imageShell = card.querySelector(".product-image-shell");
    let badge = card.querySelector(".pushbuy-quantity");

    if (!badge && qty > 0 && imageShell) {
        badge = document.createElement("span");
        badge.className = "pushbuy-quantity";
        imageShell.appendChild(badge);
    }
    if (badge && qty === 0) {
        badge.remove();
    } else if (badge) {
        badge.textContent = String(qty);
        badge.setAttribute("aria-label", `${qty} ${qty === 1 ? "unidad" : "unidades"} en el carrito`);
    }

    const maxed = !canAddMore(product);
    card.classList.toggle("pushbuy-maxed", maxed);
    card.setAttribute("aria-disabled", String(maxed));
}

function animatePushbuy(card) {
    if (!card || !cartToggle || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        cartToggle?.classList.add("pushbuy-cart-pulse");
        setTimeout(() => cartToggle?.classList.remove("pushbuy-cart-pulse"), 360);
        return;
    }

    const source = card.querySelector(".product-image-shell") || card;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = cartToggle.getBoundingClientRect();
    if (!sourceRect.width || !targetRect.width) return;

    const flyer = source.cloneNode(true);
    flyer.className = "pushbuy-flyer";
    Object.assign(flyer.style, {
        left: `${sourceRect.left}px`,
        top: `${sourceRect.top}px`,
        width: `${sourceRect.width}px`,
        height: `${sourceRect.height}px`
    });
    document.body.appendChild(flyer);

    const sourceX = sourceRect.left + sourceRect.width / 2;
    const sourceY = sourceRect.top + sourceRect.height / 2;
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;

    requestAnimationFrame(() => {
        flyer.style.transform = `translate3d(${targetX - sourceX}px, ${targetY - sourceY}px, 0) scale(.08) rotate(7deg)`;
        flyer.style.opacity = "0";
        flyer.style.borderRadius = "50%";
    });

    const finish = () => {
        flyer.remove();
        cartToggle.classList.add("pushbuy-cart-pulse");
        setTimeout(() => cartToggle.classList.remove("pushbuy-cart-pulse"), 360);
    };
    flyer.addEventListener("transitionend", finish, { once: true });
    setTimeout(() => flyer.isConnected && finish(), 760);
}

function addProductWithPushbuy(card) {
    const id = card?.dataset.pushbuyProduct;
    const product = products.find((item) => item.id === id);
    if (!product || !canAddMore(product)) {
        saleStatus.textContent = "No hay mas stock disponible para ese producto.";
        return;
    }
    animatePushbuy(card);
    if (changeCart(id, 1, { refreshProducts: false })) updatePushbuyCardQuantity(card, product);
}

function renderCart() {
    list.innerHTML = "";
    let sum = 0;
    const units = cart.reduce((count, item) => count + Number(item.qty || 0), 0);
    const discount = Math.max(0, Math.min(Number(discountAmount.value || 0) || 0, cart.reduce((value, item) => value + (item.qty * item.precioVenta), 0)));

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
                    <button type="button" data-cart-line="remove" data-id="${escapeHtml(item.id)}" aria-label="Restar ${escapeHtml(item.nombre)}">-</button>
                    <button type="button" data-cart-line="add" data-id="${escapeHtml(item.id)}" aria-label="Sumar ${escapeHtml(item.nombre)}">+</button>
                    <button type="button" class="cart-delete" data-cart-line="delete" data-id="${escapeHtml(item.id)}" aria-label="Quitar ${escapeHtml(item.nombre)}">X</button>
                </div>
            </li>
        `);
    });

    total.textContent = formatMoney(Math.max(0, sum - discount));
    cartBadge.textContent = units;
    cartToggle.classList.toggle("has-items", units > 0);
    mobileCartTotal.textContent = `${total.textContent} Bs`;
    const locked = isSaving || Boolean(pendingSale);
    saveSale.disabled = isSaving || !currentUser || !cart.length || !navigator.onLine;
    saveSale.textContent = isSaving ? "Guardando..." : pendingSale ? "Confirmar venta" : "Crear nota";
    openSaleModal.disabled = isSaving || !currentUser || !cart.length;
    mobileCreateNote.disabled = openSaleModal.disabled;
    [customerName, customerPhone, customerAddress, paymentMethod, discountAmount, clearCart, cancelOrder].forEach((field) => { field.disabled = locked; });
    list.querySelectorAll("button").forEach((button) => { button.disabled = locked; });
    grid.querySelectorAll("[data-cart]").forEach((button) => {
        const product = products.find((item) => item.id === button.dataset.id);
        button.disabled = locked || (button.dataset.cart === "add" && product && !canAddMore(product));
    });
}

function setAdminState(user, profile) {
    authReady = true;
    currentUser = user;
    currentProfile = profile;
    rememberControls(user.uid, "tienda", ["search"]);
    applyPushbuyMode(getPreferences().general.pushbuy);
    const restoredUnits = restoreSaleDraft(user.uid);
    cartToggle.classList.remove("hidden");
    document.body.dataset.storeSession = "signed-in";
    saleMode.textContent = restoredUnits > 0
        ? `Orden pendiente recuperada: ${restoredUnits} ${restoredUnits === 1 ? "unidad" : "unidades"}.`
        : "La venta se guardara en Historial.";
    saveSale.disabled = !cart.length;
    openSaleModal.disabled = !cart.length;
}

function openCheckout() {
    if (!currentUser) return;
    closeStoreMenu();
    adminCheckout.classList.remove("hidden");
    document.body.classList.add("checkout-visible");
    mobileCheckoutBar.hidden = false;
    adminCheckout.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeCheckout() {
    adminCheckout.classList.add("hidden");
    document.body.classList.remove("checkout-visible");
    mobileCheckoutBar.hidden = true;
}

function openModal() {
    if (!cart.length) {
        saleStatus.textContent = "Agrega productos antes de crear la nota.";
        return;
    }
    saleModal.classList.remove("hidden");
    saleModal.classList.add("flex");
    renderCart();
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

function clearOrder() {
    if (isSaving || pendingSale) return;
    cart = [];
    orderId = crypto.randomUUID();
    lastSale = null;
    discountAmount.value = "";
    customerName.value = "";
    customerAddress.value = "";
    customerPhone.value = "";
    paymentMethod.value = "Efectivo";
    clearSaleDraft();
    draftStatus.textContent = "";
    printLastSale.disabled = true;
    closeModal();
    updateProductQuantities();
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
        requestId: orderId,
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
    renderSaleNote(sale, salePrintArea);
    salePreviewContent.innerHTML = `
        <div class="sale-preview-canvas">
            ${salePrintArea.innerHTML}
        </div>
    `;
}

function openSalePreview(sale) {
    if (!sale) return;
    renderSalePreview(sale);
    openOverlay(salePreviewModal);
}

async function finalizeSale() {
    if (isSaving) return;
    if (!navigator.onLine) { saleMessage("Sin conexion. La orden sigue guardada; conecta para crear la nota."); return; }
    if (!currentUser) {
        saleStatus.textContent = "Primero inicia sesion como admin.";
        return;
    }
    if (!cart.length) {
        saleStatus.textContent = "Agrega productos antes de guardar.";
        return;
    }

    isSaving = true;
    document.documentElement.dataset.saleSaving = "true";
    saleMessage("Guardando nota de venta...");
    pendingSale ||= buildSalePayload();
    saveSaleDraft();
    renderCart();
    try {
        const seller = currentUser;
        const profile = currentProfile;
        if (currentUser !== seller || profile?.activo === false) throw new Error("La sesion no esta activa");
        const sale = await saveSaleRecord(pendingSale);

        lastSale = sale;
        renderSaleNote(sale, salePrintArea);
        printLastSale.disabled = false;
        cart = [];
        pendingSale = null;
        orderId = crypto.randomUUID();
        clearSaleDraft();
        draftStatus.textContent = "Venta registrada";
        customerName.value = "";
        customerAddress.value = "";
        customerPhone.value = "";
        paymentMethod.value = "Efectivo";
        discountAmount.value = "";
        closeModal();
        saleMessage("Nota creada en Historial. Lista para imprimir.");
        openSalePreview(sale);
        try {
            products = await getProducts();
            renderProducts();
        } catch { saleMessage("Venta registrada. El inventario se actualizara al recuperar la conexion."); }
    } catch (error) {
        console.error(error);
        const uncertain = !navigator.onLine || ["unavailable", "deadline-exceeded", "unknown"].includes(error.code);
        if (!uncertain) pendingSale = null;
        saveSaleDraft();
        saleMessage(uncertain ? "No se pudo confirmar la venta. La orden esta guardada. Reintenta para confirmar sin duplicarla." : `No se pudo registrar: ${error.message || errorDetail(error)}`);
    } finally {
        isSaving = false;
        document.documentElement.dataset.saleSaving = "false";
        renderCart();
    }
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
    if (isSaving || pendingSale) return;
    const button = event.target.closest("[data-cart-line]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.cartLine === "add") changeCart(id, 1);
    if (button.dataset.cartLine === "remove") changeCart(id, -1);
    if (button.dataset.cartLine === "delete") {
        cart = cart.filter((item) => item.id !== id);
        playCartSound("remove");
        saveSaleDraft();
        updateProductQuantities();
        renderCart();
    }
});
cancelOrder.addEventListener("click", clearOrder);
cartToggle.addEventListener("click", openCheckout);
checkoutClose.addEventListener("click", closeCheckout);
pushbuyToggle?.addEventListener("change", () => {
    applyPushbuyMode(pushbuyToggle.checked, true);
    renderProducts();
});
openSaleModal.addEventListener("click", openModal);
mobileCreateNote.addEventListener("click", openModal);
saleModalClose.addEventListener("click", closeModal);
saleModal.addEventListener("click", (event) => {
    if (event.target === saleModal) closeModal();
});
salePreviewModal.addEventListener("click", (event) => {
    if (event.target === salePreviewModal) closePreview();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeModal();
        closePreview();
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
    const pushbuyCard = event.target.closest("[data-pushbuy-product]");
    if (currentUser && pushbuyEnabled && pushbuyCard) {
        addProductWithPushbuy(pushbuyCard);
        return;
    }
});
grid.addEventListener("keydown", (event) => {
    if (!currentUser || !pushbuyEnabled || !["Enter", " "].includes(event.key)) return;
    const card = event.target.closest("[data-pushbuy-product]");
    if (!card) return;
    event.preventDefault();
    addProductWithPushbuy(card);
});
saveSale.addEventListener("click", finalizeSale);
printLastSale.addEventListener("click", () => {
    if (!lastSale) return;
    openSalePreview(lastSale);
});
salePreviewClose.addEventListener("click", closePreview);
salePreviewDismiss.addEventListener("click", closePreview);
salePreviewPrint.addEventListener("click", () => {
    if (lastSale) printSaleNote(lastSale, salePrintArea);
});
window.addEventListener("pagehide", saveSaleDraft);
document.addEventListener("sxmy:save-draft", saveSaleDraft);

document.addEventListener("sxmy:module-change", () => {
    saveSaleDraft();
    closeModal();
    closePreview();
});

export async function initialize({ user, profile }) {
    setAdminState(user, profile);
    await start();
    updateConnection();
}

window.addEventListener("online", updateConnection);
document.addEventListener("sxmy:preferences-change", () => {
    if (!currentUser || pushbuyEnabled === getPreferences().general.pushbuy) return;
    applyPushbuyMode(getPreferences().general.pushbuy);
    if (productsLoaded) renderProducts();
});
window.addEventListener("offline", updateConnection);

export async function refresh() {
    saveSaleDraft();
    await start();
}
