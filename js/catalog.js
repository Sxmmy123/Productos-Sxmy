import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { escapeHtml, getProducts, updateProduct } from "./product-service.js";
import { formatMoney, saveSale as saveSaleRecord } from "./sales-service.js";
import { getUserProfile } from "./user-service.js";

let products = [];
let cart = [];
let currentUser = null;
let currentProfile = null;
let lastSale = null;

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

function visibleProducts() {
    const query = search.value.trim().toLowerCase();
    const active = products.filter((product) => product.activo !== false);
    if (!query) return active;
    return active.filter((product) =>
        product.codigo.toLowerCase().includes(query) ||
        product.nombre.toLowerCase().includes(query) ||
        product.descripcion.toLowerCase().includes(query)
    );
}

function renderProducts() {
    const data = visibleProducts();
    productCount.textContent = `${data.length} productos`;
    grid.innerHTML = "";

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
                    <div class="mt-auto flex items-center justify-between gap-3 pt-4">
                        <div class="qty-control">
                            <button class="h-10 w-10 font-bold text-[#374151]" data-cart="remove" data-id="${escapeHtml(product.id)}">-</button>
                            <strong class="min-w-9 text-center text-sm">${qty}</strong>
                            <button class="h-10 w-10 font-bold text-[#374151]" data-cart="add" data-id="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>+</button>
                        </div>
                        <button class="btn-primary px-4 py-2 text-sm" data-cart="add" data-id="${escapeHtml(product.id)}" ${disabled ? "disabled" : ""}>Agregar</button>
                    </div>
        ` : "";

        grid.insertAdjacentHTML("beforeend", `
            <article class="product-card">
                <div class="product-image-shell">
                    ${hasImage
                        ? `<img src="${escapeHtml(product.imagenUrl)}" alt="${escapeHtml(product.nombre)}" class="h-full w-full rounded-lg object-contain" loading="lazy">`
                        : `<div class="grid h-full w-full place-items-center rounded-lg border border-dashed border-[#c5d3d9] bg-[#f7fafb] text-sm font-black text-[#60727d]">Sin imagen</div>`}
                </div>
                <div class="product-card-body">
                    <div class="flex items-start justify-between gap-3">
                        <p class="code-pill">${escapeHtml(product.codigo)}</p>
                        <p class="text-xs font-semibold ${product.stock === "" || product.stock > 0 ? "text-[#146c43]" : "text-[#9f2d2d]"}">${stockLabel(product)}</p>
                    </div>
                    <h3>${escapeHtml(product.nombre)}</h3>
                    <div class="mt-2 flex flex-wrap items-baseline gap-2">
                        <p class="product-price">${formatMoney(product.precioVenta)} Bs</p>
                        ${product.precioAnterior !== "" && product.precioAnterior !== product.precioVenta ? `<span class="text-sm font-bold text-[#84939b] line-through">${formatMoney(product.precioAnterior)} Bs</span>` : ""}
                    </div>
                    <p class="product-desc mt-2 min-h-10 text-sm leading-5 text-[#60727d]">${escapeHtml(product.descripcion)}</p>
                    ${adminControls}
                </div>
            </article>
        `);
    });
}

function emptyState(message) {
    return `<div class="rounded-lg border border-dashed border-[#b8c7cf] bg-white p-8 text-center text-sm text-[#60727d] sm:col-span-2 xl:col-span-3">${escapeHtml(message)}</div>`;
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
    loginLink.classList.toggle("hidden", Boolean(user));
    adminBadge.classList.toggle("hidden", !user);
    adminNav.classList.toggle("hidden", !user);
    adminNav.classList.toggle("flex", Boolean(user));
    adminCheckout.classList.add("hidden");
    saleMode.textContent = "La venta se guardara en Historial.";
    saveSale.disabled = !user || !cart.length;
    openSaleModal.disabled = !user || !cart.length;
    if (!user) cart = [];
    renderProducts();
    renderCart();
}

function openCheckout() {
    if (!currentUser) return;
    adminCheckout.classList.remove("hidden");
    adminCheckout.scrollIntoView({ behavior: "smooth", block: "start" });
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

function clearOrder() {
    cart = [];
    lastSale = null;
    discountAmount.value = "";
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
        customerName.value = "";
        customerAddress.value = "";
        customerPhone.value = "";
        paymentMethod.value = "Efectivo";
        discountAmount.value = "";
        closeModal();
        products = await getProducts();
        renderProducts();
        renderCart();
        saleStatus.textContent = "Nota creada en Historial. Imprimiendo...";
        window.print();
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

async function start() {
    try {
        statusBox.textContent = "Cargando productos...";
        products = await withTimeout(getProducts(), 8000);
        statusBox.classList.add("hidden");
    } catch (error) {
        console.error(error);
        statusBox.textContent = `No se pudo cargar Firestore: ${errorDetail(error)}. Cuando agregues productos y tengas conexion, apareceran aqui.`;
        statusBox.className = "mb-4 rounded-lg border border-[#b8c7cf] bg-[#f7fafb] px-4 py-3 text-sm text-[#4b5563]";
    }
    renderProducts();
    renderCart();
}

search.addEventListener("input", renderProducts);
clearCart.addEventListener("click", () => {
    clearOrder();
});
discountAmount.addEventListener("input", renderCart);
list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart-line]");
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.cartLine === "add") changeCart(id, 1);
    if (button.dataset.cartLine === "remove") changeCart(id, -1);
    if (button.dataset.cartLine === "delete") {
        cart = cart.filter((item) => item.id !== id);
        renderProducts();
        renderCart();
    }
});
cancelOrder.addEventListener("click", clearOrder);
cartToggle.addEventListener("click", openCheckout);
checkoutClose.addEventListener("click", closeCheckout);
openSaleModal.addEventListener("click", openModal);
saleModalClose.addEventListener("click", closeModal);
saleModal.addEventListener("click", (event) => {
    if (event.target === saleModal) closeModal();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
});
grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cart]");
    if (!button || button.disabled) return;
    changeCart(button.dataset.id, button.dataset.cart === "add" ? 1 : -1);
});
saveSale.addEventListener("click", finalizeSale);
printLastSale.addEventListener("click", () => {
    if (!lastSale) return;
    renderSaleNote(lastSale);
    window.print();
});
logout.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "index.html";
});

onAuthStateChanged(auth, setAdminState);
start();
