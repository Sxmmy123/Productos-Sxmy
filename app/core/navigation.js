import { setupThemeToggle } from "../shared/theme/theme.js?v=2";
import { getPreferences, updatePreferences, preferencesOwner } from "../modules/configuracion/preferences.js";
import { modules, moduleUrl, resolveModule } from "./routes.js?v=5";

const COLLAPSE_KEY = "sxmy-sidebar-collapsed";
const mobileMenu = window.matchMedia("(max-width: 900px)");
const sidebar = document.getElementById("appSidebar");
const toggles = () => [...document.querySelectorAll("[data-sidebar-toggle]")];
const visibleToggle = () => toggles().find((button) => button.getClientRects().length);
const collapse = document.getElementById("sidebarCollapse");
const overlay = document.getElementById("sidebarOverlay");
const workspace = document.querySelector(".admin-main, .store-workspace");
const layout = document.querySelector(".navigation-layout");
const sections = [...document.querySelectorAll(".admin-section")];
const SCROLL_KEY = "sxmy-module-scroll";
let currentModule = null;
const readyModules = new Set();
let accessResolved = false;
let canManageUsers = false;
let positions = {};
try { positions = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || "{}") || {}; } catch { /* Start at the top. */ }

function savePosition() {
    if (!currentModule || !readyModules.has(currentModule)) return;
    positions[currentModule] = window.scrollY;
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(positions)); } catch { /* Keep positions in memory. */ }
}

function restorePosition() {
    const position = Number(positions[currentModule]);
    window.scrollTo({ top: Number.isFinite(position) ? Math.max(0, position) : 0, behavior: "instant" });
}

export function navigationReady(name) {
    if (!sidebar || name !== currentModule) return;
    const firstVisit = !readyModules.has(name);
    readyModules.add(name);
    if (firstVisit) requestAnimationFrame(() => {
        if (name === currentModule) restorePosition();
    });
}

export function setNavigationUser(user, profile) {
    const active = Boolean(user) && profile?.activo !== false;
    const cashier = profile?.rol === "cajero";
    accessResolved = active;
    canManageUsers = active && !cashier;
    document.querySelectorAll("[data-admin-only]").forEach((link) => {
        link.hidden = !active || cashier;
        link.classList.toggle("hidden", link.hidden);
    });
    document.querySelectorAll("[data-navigation-role]").forEach((label) => {
        const role = cashier ? "Cajero" : "Administrador";
        const name = profile?.nombre || user?.email;
        label.textContent = active ? `${role}${name ? ` | ${name}` : ""}` : "Tienda publica";
        label.title = label.textContent;
    });
    if (sidebar) renderRoute();
}

function syncSidebar() {
    const mobile = mobileMenu.matches;
    const open = mobile && document.body.classList.contains("sidebar-open");
    sidebar.inert = mobile && !open;
    sidebar.setAttribute("aria-hidden", String(mobile && !open));
    toggles().forEach((button) => button.setAttribute("aria-expanded", String(open)));
    overlay?.setAttribute("aria-hidden", "true");
    if (workspace) workspace.inert = open;
    if (open) {
        sidebar.setAttribute("role", "dialog");
        sidebar.setAttribute("aria-modal", "true");
    } else {
        sidebar.removeAttribute("role");
        sidebar.removeAttribute("aria-modal");
    }
}

export function closeSidebar({ restoreFocus = false } = {}) {
    if (!sidebar) return;
    const wasOpen = document.body.classList.contains("sidebar-open");
    document.body.classList.remove("sidebar-open");
    syncSidebar();
    if (wasOpen && restoreFocus && mobileMenu.matches) visibleToggle()?.focus({ preventScroll: true });
}

function openSidebar() {
    if (!mobileMenu.matches) return;
    document.body.classList.add("sidebar-open");
    syncSidebar();
    document.getElementById("sidebarClose")?.focus({ preventScroll: true });
}

function setCollapsed(collapsed, persist = false) {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    const label = collapsed ? "Expandir menu" : "Contraer menu";
    collapse?.setAttribute("aria-label", label);
    collapse?.setAttribute("title", label);
    collapse?.setAttribute("aria-expanded", String(!collapsed));
    if (persist) {
        try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* Navigation also works without storage. */ }
        updatePreferences({ general: { sidebarCollapsed: collapsed } });
    }
}

function renderRoute({ focus = false } = {}) {
    let target = resolveModule();
    if (!target) return;
    if (accessResolved && modules[target].adminOnly && !canManageUsers) target = "productos";
    const changed = currentModule !== target;
    if (changed && currentModule) savePosition();
    const canonical = moduleUrl(target);
    if (location.hash !== canonical.hash) history.replaceState(history.state, "", canonical.href);
    currentModule = target;
    document.documentElement.dataset.module = target;
    const store = target === "tienda";
    sidebar.classList.toggle("store-sidebar", store);
    layout?.classList.toggle("store-layout", store);
    layout?.classList.toggle("admin-layout", !store);
    document.body.classList.toggle("store-page", store);
    document.body.classList.toggle("staff-store-page", store);
    workspace?.classList.toggle("store-workspace", store);
    workspace?.classList.toggle("admin-main", !store);
    document.querySelectorAll("[data-module-style]").forEach((link) => {
        const active = link.dataset.moduleStyle.split(" ").includes(target);
        link.media = active ? "all" : "not all";
    });
    document.querySelectorAll("[data-store-only]").forEach((element) => { element.hidden = !store; });
    sections.forEach((section) => {
        section.hidden = section.id !== `${target}Section`;
        section.classList.toggle("hidden", section.hidden);
    });
    const title = document.getElementById("adminTopTitle");
    if (title) title.textContent = modules[target].title;
    document.title = `${modules[target].title} - Productos SXMY`;
    sidebar.querySelectorAll(".sidebar-link[href]").forEach((link) => {
        const active = resolveModule(link.href) === target;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    closeSidebar();
    if (!changed) return;
    document.dispatchEvent(new CustomEvent("sxmy:module-change", { detail: { module: target } }));
    if (readyModules.has(target)) requestAnimationFrame(() => {
        if (currentModule === target) restorePosition();
    });
    if (focus) {
        const heading = document.querySelector(`#${target}Section h1`);
        heading?.setAttribute("tabindex", "-1");
        heading?.focus({ preventScroll: true });
    }
}

if (sidebar) {
    history.scrollRestoration = "manual";
    setupThemeToggle();
    toggles().forEach((button) => button.setAttribute("aria-controls", sidebar.id));
    collapse?.setAttribute("aria-controls", sidebar.id);
    let savedCollapsed = false;
    try { savedCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { /* Use the expanded menu. */ }
    setCollapsed(savedCollapsed);
    document.addEventListener("sxmy:preferences-change", () => setCollapsed(getPreferences().general.sidebarCollapsed));
    renderRoute();

    document.addEventListener("click", (event) => {
        if (event.target.closest("[data-sidebar-toggle]")) openSidebar();
    });
    document.getElementById("sidebarClose")?.addEventListener("click", () => closeSidebar({ restoreFocus: true }));
    overlay?.addEventListener("click", () => closeSidebar({ restoreFocus: true }));
    collapse?.addEventListener("click", () => setCollapsed(!document.body.classList.contains("sidebar-collapsed"), true));
    mobileMenu.addEventListener("change", () => closeSidebar());
    window.addEventListener("storage", (event) => {
        if (event.key === COLLAPSE_KEY && !preferencesOwner()) setCollapsed(event.newValue === "1");
    });
    document.addEventListener("click", (event) => {
        const link = event.target.closest("#appSidebar a[href], .admin-topbar a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === "_blank" || link.hasAttribute("download")) return;
        const target = resolveModule(link.href);
        if (!target) return;
        if (target === currentModule) {
            event.preventDefault();
            closeSidebar({ restoreFocus: true });
            return;
        }
        const destination = moduleUrl(target);
        if (destination.pathname === location.pathname && sections.length) {
            event.preventDefault();
            savePosition();
            history.pushState(null, "", destination.href);
            renderRoute({ focus: true });
        } else {
            savePosition();
            closeSidebar();
        }
    });
    window.addEventListener("pagehide", savePosition);
    window.addEventListener("popstate", () => renderRoute());
    window.addEventListener("hashchange", () => renderRoute());
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) renderRoute();
    });
    document.addEventListener("keydown", (event) => {
        if (!mobileMenu.matches || !document.body.classList.contains("sidebar-open")) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeSidebar({ restoreFocus: true });
        }
        if (event.key !== "Tab") return;
        const controls = [...sidebar.querySelectorAll('a[href], button, input, [tabindex="0"]')]
            .filter((element) => !element.disabled && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    });
}
