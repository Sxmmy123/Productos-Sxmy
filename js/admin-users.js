import { auth } from "../firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { createCashier, getUserProfile, getUsers, updateUserStatus } from "./user-service.js";
import { formatMoney, getSales } from "./sales-service.js";
import { escapeHtml } from "./product-service.js";

let users = [];
let sales = [];

const statusBox = document.getElementById("statusBox");
const cashierForm = document.getElementById("cashierForm");
const cashierName = document.getElementById("cashierName");
const cashierEmail = document.getElementById("cashierEmail");
const cashierPassword = document.getElementById("cashierPassword");
const usersList = document.getElementById("usersList");
const usersSummary = document.getElementById("usersSummary");
const userSearch = document.getElementById("userSearch");
const logout = document.getElementById("logout");
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

async function loadData() {
    setStatus("Cargando cajeros...");
    try {
        [users, sales] = await Promise.all([getUsers(), getSales()]);
        renderUsers();
        setStatus("Modulo listo.", "ok");
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo cargar: ${errorDetail(error)}.`, "error");
    }
}

function filteredUsers() {
    const query = userSearch.value.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) =>
        user.nombre.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query)
    );
}

function userStats(user) {
    const userSales = sales.filter((sale) =>
        sale.vendedorUid === user.uid ||
        sale.vendedorEmail === user.email
    );
    const total = userSales.reduce((sum, sale) => sum + sale.total, 0);
    const units = userSales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.cantidad, 0), 0);
    const products = new Map();
    userSales.forEach((sale) => {
        sale.items.forEach((item) => {
            const current = products.get(item.codigo) || { nombre: item.nombre, cantidad: 0 };
            current.cantidad += item.cantidad;
            products.set(item.codigo, current);
        });
    });
    const top = [...products.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 3);
    return { count: userSales.length, total, units, top };
}

function renderUsers() {
    const data = filteredUsers();
    usersSummary.textContent = `${users.length} cajeros registrados`;
    usersList.innerHTML = "";

    if (!data.length) {
        usersList.innerHTML = '<div class="rounded-lg border border-dashed border-[#b8c7cf] bg-white p-8 text-center text-sm text-[#60727d]">No hay cajeros.</div>';
        return;
    }

    data.forEach((user) => {
        const stats = userStats(user);
        const topProducts = stats.top.length
            ? stats.top.map((item) => `<span>${escapeHtml(item.nombre)} (${item.cantidad})</span>`).join("")
            : "<span>Sin ventas registradas</span>";
        usersList.insertAdjacentHTML("beforeend", `
            <article class="cashier-card">
                <div class="cashier-main">
                    <div>
                        <h3>${escapeHtml(user.nombre)}</h3>
                        <p>${escapeHtml(user.email)}</p>
                    </div>
                    <span class="${user.activo ? "cashier-active" : "cashier-inactive"}">${user.activo ? "Activo" : "Desactivado"}</span>
                </div>
                <div class="cashier-stats">
                    <div><strong>${stats.count}</strong><span>ventas</span></div>
                    <div><strong>${formatMoney(stats.total)} Bs</strong><span>total vendido</span></div>
                    <div><strong>${stats.units}</strong><span>productos</span></div>
                </div>
                <div class="cashier-products">${topProducts}</div>
                <button class="${user.activo ? "btn-danger" : "btn-light"} px-3 py-2 text-sm" data-user-toggle="${escapeHtml(user.uid)}" data-active="${user.activo}" type="button">
                    ${user.activo ? "Eliminar acceso" : "Activar acceso"}
                </button>
            </article>
        `);
    });
}

cashierForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Creando cajero...");
    try {
        await createCashier({
            nombre: cashierName.value,
            email: cashierEmail.value.trim(),
            password: cashierPassword.value
        });
        cashierForm.reset();
        await loadData();
        setStatus("Cajero creado.", "ok");
    } catch (error) {
        console.error(error);
        setStatus(`No se pudo crear: ${errorDetail(error)}.`, "error");
    }
});

usersList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-user-toggle]");
    if (!button) return;
    const active = button.dataset.active === "true";
    await updateUserStatus(button.dataset.userToggle, !active);
    await loadData();
});

userSearch.addEventListener("input", renderUsers);
logout.addEventListener("click", async () => { await signOut(auth); window.location.href = "login.html"; });
sidebarToggle.addEventListener("click", () => document.body.classList.add("sidebar-open"));
sidebarClose.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
sidebarOverlay.addEventListener("click", () => document.body.classList.remove("sidebar-open"));

onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "login.html"; return; }
    const profile = await getUserProfile(user.uid);
    if (profile?.rol === "cajero") {
        setStatus("Este modulo es solo para el admin principal.", "warn");
        setTimeout(() => { window.location.href = "admin.html"; }, 900);
        return;
    }
    loadData();
});
