// Apply saved appearance before styles paint; this does not restore authentication.
(() => {
    if (location.pathname.endsWith('/admin.html')) {
        const section = location.hash.slice(1);
        document.documentElement.dataset.module = ["productos", "historial", "analisis", "tienda", "cajeros"].includes(section) ? section : "productos";
    }
    try {
        document.documentElement.dataset.theme = localStorage.getItem("sxmy-theme") === "dark" ? "dark" : "light";
        document.documentElement.classList.toggle("sidebar-collapsed", localStorage.getItem("sxmy-sidebar-collapsed") === "1");
    } catch {
        document.documentElement.dataset.theme = "light";
    }
})();
