import { createCashier, getUsers, updateUserStatus, updateCashierProfile } from "../../shared/services/user-service.js";
import { formatMoney, getSales } from "../../core/data-cache.js?v=2";
import { escapeHtml } from "../../shared/services/product-service.js";
import { rememberControls } from "../../core/view-state.js";

let users = [];
let sales = [];
let editingUser = null;
let editingBusy = false;
const editModal = document.getElementById("cashierEditModal");
const editForm = document.getElementById("cashierEditForm");
const editName = document.getElementById("cashierEditName");
const editEmail = document.getElementById("cashierEditEmail");
const editStatus = document.getElementById("cashierEditStatus");
const editSave = document.getElementById("cashierEditSave");

const statusBox = document.getElementById("cashiersStatusBox");
const cashierForm = document.getElementById("cashierForm");
const cashierName = document.getElementById("cashierName");
const cashierEmail = document.getElementById("cashierEmail");
const cashierPassword = document.getElementById("cashierPassword");
const usersList = document.getElementById("usersList");
const usersSummary = document.getElementById("usersSummary");
const userSearch = document.getElementById("userSearch");

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

async function loadData() {
    setStatus("Cargando cajeros...");
    try {
        [users, sales] = await Promise.all([getUsers(), getSales()]);
        users = users.filter((user) => user.rol === "cajero");
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
                <div class="cashier-actions">
                    <button class="btn-light" type="button" data-user-edit="${escapeHtml(user.uid)}">Editar</button>
                    <button class="${user.activo ? "btn-danger" : "btn-light"}" data-user-toggle="${escapeHtml(user.uid)}" data-active="${user.activo}" type="button">${user.activo ? "Desactivar" : "Activar acceso"}</button>
                </div>
            </article>
        `);
    });
}

cashierForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = cashierForm.querySelector("button[type='submit']");
    if (submit.disabled) return;
    submit.disabled = true;
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
    } finally {
        submit.disabled = false;
    }
});

usersList.addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-user-edit]");
    if (edit) {
        editingUser = users.find((user) => user.uid === edit.dataset.userEdit);
        if (!editingUser) return;
        editName.value = editingUser.nombre;
        editEmail.value = editingUser.email;
        editStatus.textContent = "";
        editModal.hidden = false;
        editName.focus();
        return;
    }
    const button = event.target.closest("[data-user-toggle]");
    if (!button) return;
    const active = button.dataset.active === "true";
    button.disabled = true;
    try { await updateUserStatus(button.dataset.userToggle, !active); await loadData(); }
    catch (error) { setStatus(error.message || "No se pudo cambiar el acceso.", "error"); button.disabled = false; }
});

function closeEdit() {
    if (editingBusy) return;
    editModal.hidden = true;
    editingUser = null;
}
editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingUser || editingBusy) return;
    editingBusy = true;
    editSave.disabled = true;
    editStatus.textContent = "Guardando...";
    try {
        await updateCashierProfile(editingUser.uid, { nombre: editName.value, email: editEmail.value, expectedEmail: editingUser.email });
        editingBusy = false;
        closeEdit();
        await loadData();
        setStatus("Cajero actualizado.", "ok");
    } catch (error) { editStatus.textContent = error.message || "No se pudo actualizar."; }
    finally { editingBusy = false; editSave.disabled = false; }
});
["cashierEditClose", "cashierEditCancel"].forEach((id) => document.getElementById(id).addEventListener("click", closeEdit));
editModal.addEventListener("click", (event) => { if (event.target === editModal) closeEdit(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeEdit(); });
document.addEventListener("sxmy:module-change", closeEdit);

userSearch.addEventListener("input", renderUsers);
export async function initialize({ user }) {
    rememberControls(user.uid, "cajeros", ["userSearch"]);
    await loadData();
}

export { loadData as refresh };
