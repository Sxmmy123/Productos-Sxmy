const base = new URL("../../", import.meta.url);

export const modules = {
    tienda: { page: "admin.html", hash: "tienda", title: "Tienda" },
    productos: { page: "admin.html", hash: "productos", title: "Productos" },
    historial: { page: "admin.html", hash: "historial", title: "Historial" },
    analisis: { page: "admin.html", hash: "analisis", title: "Analisis" },
    compras: { page: "admin.html", hash: "compras", title: "Compras" },
    cajeros: { page: "admin.html", hash: "cajeros", title: "Cajeros", adminOnly: true }
};

export function moduleUrl(name) {
    const route = modules[name] || modules.productos;
    const url = new URL(route.page, base);
    url.hash = route.hash || "";
    return url;
}

export function resolveModule(value = location.href) {
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    if (url.pathname === moduleUrl("productos").pathname) {
        const name = url.hash.slice(1);
        return Object.hasOwn(modules, name) ? name : "productos";
    }
    return null;
}

export function loginDestination() {
    const destination = new URL("login.html", base);
    destination.searchParams.set("next", `${location.pathname}${location.search}${location.hash}`);
    return destination.href;
}

export function authenticatedDestination(profile) {
    let name = "productos";
    try {
        const next = new URLSearchParams(location.search).get("next");
        if (next) name = resolveModule(new URL(next, location.href)) || "productos";
    } catch { /* Ignore invalid return addresses. */ }
    if (modules[name].adminOnly && profile?.rol === "cajero") name = "productos";
    return moduleUrl(name).href;
}
