import { initializePreferences, getPreferences, updatePreferences, preferencesStatus } from "./preferences.js";
import { setTheme } from "../../shared/theme/theme.js?v=2";
import { closeSidebar } from "../../core/navigation.js?v=9";

let modal, returnFocus, appliedTheme;
const byId = id => document.getElementById(id);
const fields = {
    settingsTheme: ["general", "theme"], settingsCollapsed: ["general", "sidebarCollapsed"], settingsSounds: ["general", "sounds"], settingsPushbuy: ["general", "pushbuy"],
    settingsProductView: ["products", "view"], settingsProductSort: ["products", "sort"], showActiveProducts: ["products", "showActive"], showDisabledProducts: ["products", "showDisabled"],
    onlyNoImage: ["products", "onlyNoImage"], onlyLowStock: ["products", "onlyLowStock"], showPriceHistory: ["products", "showPriceHistory"]
};

function renderStatus() {
    if (!modal) return;
    const status = preferencesStatus();
    const labels = { local: "Guardado en este dispositivo", syncing: "Sincronizando...", synced: "Configuracion guardada", pending: "Guardado · Pendiente de sincronizar", offline: "Guardado · Sin conexion", permissions: "Guardado local · Firebase requiere permisos" };
    byId("settingsSaveStatus").textContent = status.localSaved ? labels[status.state] : "No se pudo guardar en el dispositivo";
}

function hydrate() {
    if (!modal) return;
    const settings = getPreferences();
    for (const [id, [group, key]] of Object.entries(fields)) {
        const control = byId(id);
        if (control.type === "checkbox") control.checked = settings[group][key];
        else control.value = settings[group][key];
    }
    modal.querySelectorAll('[name="settingsPaper"]').forEach(input => { input.checked = input.value === settings.printing.format; });
    byId("settingsPaperPreview").innerHTML = `<div class="settings-paper-sample" data-format="${settings.printing.format}"><p>PRODUCTOS SXMY<br>NOTA 000001</p><i></i><i></i><i></i><strong>Total 40 Bs</strong></div>`;
    renderStatus();
}

function selectTab(name) {
    modal.querySelectorAll("[data-settings-tab]").forEach(button => {
        const active = button.dataset.settingsTab === name;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
    });
    modal.querySelectorAll("[data-settings-panel]").forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== name; });
    modal.querySelector(".settings-content").scrollTop = 0;
}

function openSettings(tab = "general") {
    returnFocus = document.activeElement;
    closeSidebar();
    hydrate();
    selectTab(["general", "products", "printing"].includes(tab) ? tab : "general");
    if (!modal.open) modal.showModal();
    document.body.classList.add("settings-open");
    byId("settingsClose").focus({ preventScroll: true });
}

export async function initializeSettings({ user, profile }) {
    if (!modal) {
        const response = await fetch(new URL("./view.html", import.meta.url));
        if (!response.ok) throw new Error("No se pudo abrir la configuracion.");
        const template = document.createElement("template");
        template.innerHTML = await response.text();
        document.body.append(template.content);
        modal = byId("userSettingsModal");
        for (const [id, [group, key]] of Object.entries(fields)) {
            byId(id).addEventListener("change", event => updatePreferences({ [group]: { [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value } }));
        }
        modal.querySelectorAll('[name="settingsPaper"]').forEach(input => input.addEventListener("change", () => updatePreferences({ printing: { format: input.value } })));
        modal.querySelectorAll("[data-settings-tab]").forEach(button => button.addEventListener("click", () => selectTab(button.dataset.settingsTab)));
        modal.querySelector('[role="tablist"]').addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = [...modal.querySelectorAll("[data-settings-tab]")], current = tabs.indexOf(document.activeElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault(); selectTab(tabs[next].dataset.settingsTab); tabs[next].focus();
        });
        ["settingsClose", "settingsDone"].forEach(id => byId(id).addEventListener("click", () => modal.close()));
        modal.addEventListener("click", event => {
            if (event.target !== modal) return;
            const rect = modal.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close();
        });
        modal.addEventListener("close", () => {
            document.body.classList.remove("settings-open");
            const previous = returnFocus?.isConnected && !returnFocus.closest("[inert]") && returnFocus.getClientRects().length ? returnFocus : null;
            const fallback = [...document.querySelectorAll("[data-sidebar-toggle]")].find(button => button.getClientRects().length);
            (previous || fallback)?.focus({ preventScroll: true });
        });
        document.addEventListener("click", event => { const button = event.target.closest("[data-open-settings]"); if (button) openSettings(button.dataset.openSettings); });
        document.addEventListener("sxmy:preferences-change", () => {
            const theme = getPreferences().general.theme;
            if (theme !== appliedTheme) { setTheme(theme); appliedTheme = theme; }
            hydrate();
        });
        document.addEventListener("sxmy:preferences-status", renderStatus);
        document.addEventListener("sxmy:module-change", () => { if (modal.open) modal.close(); });
        document.addEventListener("sxmy:theme-change", event => updatePreferences({ general: { theme: event.detail.theme } }));
    }
    byId("settingsOwner").textContent = profile?.nombre || user.email || "Mi usuario";
    initializePreferences(user.uid);
    hydrate();
}
