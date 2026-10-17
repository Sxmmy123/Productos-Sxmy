import { auth } from "../shared/firebase/firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getUserProfile } from "../shared/services/user-service.js";
import { navigationReady, setNavigationUser } from "./navigation.js?v=9";
import { initializeSettings } from "../modules/configuracion/controller.js?v=2";
import { loginDestination, resolveModule } from "./routes.js?v=5";
import { dataExpired, dataVersion } from "./data-cache.js?v=2";

const modules = {
    productos: {
        viewVersion: 2,
        load: () => import("../modules/productos/controller.js?v=5"),
        resources: ["products"],
        ready: "#productsTable"
    },
    historial: {
        load: () => import("../modules/historial/controller.js?v=11"),
        resources: ["sales"],
        paged: true,
        ready: "#salesList"
    },
    analisis: {
        load: () => import("../modules/analisis/controller.js?v=3"),
        resources: ["products", "sales"],
        ready: "#topProducts"
    },
    tienda: {
        load: () => import("../modules/tienda/controller.js?v=12"),
        resources: ["products"],
        ready: "#grid"
    },
    compras: {
        viewVersion: 6,
        load: () => import("../modules/compras/controller.js?v=7"),
        resources: ["products"],
        paged: true,
        ready: "#purchaseEditor"
    },
    cajeros: {
        load: () => import("../modules/cajeros/controller.js?v=3"),
        resources: ["sales"],
        ready: "#cashierForm"
    }
};
const instances = new Map();
const status = document.getElementById("moduleStatus");
const retry = document.getElementById("retryModule");
let session = null;
let authRevision = 0;
let routeRevision = 0;

function message(text, failed = false) {
    status.hidden = !text;
    status.querySelector("span").textContent = text;
    retry.hidden = !failed;
}

async function mount(name, definition) {
    const section = document.getElementById(`${name}Section`);
    if (section.dataset.mounted) return;
    const version = definition.viewVersion ? `?v=${definition.viewVersion}` : "";
    const response = await fetch(new URL(`../modules/${name}/view.html${version}`, import.meta.url));
    if (!response.ok) throw new Error("No se pudo abrir el modulo");
    const html = await response.text();
    // Fragments are same-origin application files, without scripts or a second layout.
    const template = document.createElement("template");
    template.innerHTML = html;
    if (!template.content.querySelector(definition.ready)) {
        throw new Error("El modulo no esta disponible. Revisa la conexion");
    }
    section.replaceChildren(template.content);
    section.dataset.mounted = "true";
    if (name === "tienda") await import("../shared/catalog/layout.js?v=3");
}

function controller(name) {
    const definition = modules[name];
    let entry = instances.get(name);
    if (!entry) {
        entry = { version: "", loadedAt: 0, controller: null, pending: null };
        instances.set(name, entry);
    }
    if (entry.pending) return entry.pending;
    const needsRefresh = entry.version !== dataVersion(definition.resources)
        || (!definition.paged && dataExpired(definition.resources)) || Date.now() - entry.loadedAt >= 30_000;
    if (entry.controller && !needsRefresh) return Promise.resolve(entry.controller);

    entry.pending = (async () => {
        const version = dataVersion(definition.resources);
        if (!entry.controller) {
            await mount(name, definition);
            entry.controller = await definition.load();
            await entry.controller.initialize(session);
        } else {
            await entry.controller.refresh();
        }
        entry.version = version;
        entry.loadedAt = Date.now();
        return entry.controller;
    })().finally(() => { entry.pending = null; });
    return entry.pending;
}

async function showModule() {
    if (!session) return;
    const target = resolveModule();
    if (target === "cajeros" && session.profile?.rol === "cajero") return;
    const revision = ++routeRevision;
    const group = target;
    const section = document.getElementById(`${target}Section`);
    section.setAttribute("aria-busy", "true");
    section.inert = true;
    message(instances.get(group)?.controller ? "" : "Cargando...");
    try {
        await controller(group);
        if (revision !== routeRevision || target !== resolveModule()) return;
        section.setAttribute("aria-busy", "false");
        section.inert = false;
        message("");
        navigationReady(target);
    } catch (error) {
        console.error(error);
        if (revision === routeRevision) {
            section.setAttribute("aria-busy", "false");
            section.inert = false;
            message(error.message || "No se pudo abrir el modulo.", true);
        }
    }
}

async function verifySession(user) {
    const revision = ++authRevision;
    if (!user) {
        session = null;
        document.body.dataset.panelSession = "pending";
        location.replace(loginDestination());
        return;
    }
    if (session?.user.uid === user.uid) return;
    if (session) { location.reload(); return; }
    try {
        const profile = await getUserProfile(user.uid);
        if (revision !== authRevision) return;
        if (profile?.activo === false) { await signOut(auth); return; }
        session = { user, profile };
        await initializeSettings(session);
        if (revision !== authRevision) return;
        setNavigationUser(user, profile);
        document.body.dataset.panelSession = "ready";
        await showModule();
    } catch (error) {
        if (revision === authRevision) message("No se pudo verificar la sesion. Revisa tu conexion.", true);
    }
}

document.addEventListener("sxmy:module-change", showModule);
retry.addEventListener("click", () => session ? showModule() : verifySession(auth.currentUser));
document.getElementById("logout").addEventListener("click", async () => {
    document.dispatchEvent(new CustomEvent("sxmy:save-draft"));
    try { await signOut(auth); }
    catch { message("No se pudo cerrar la sesion. Intenta nuevamente.", true); }
});
onAuthStateChanged(auth, verifySession);
