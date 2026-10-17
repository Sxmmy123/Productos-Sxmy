const CACHE_NAME = "productos-sxmy-v39";
const SDK_CACHE = "productos-sxmy-sdk-v1";
const APP_SHELL = [
    "./",
    "./index.html",
    "./login.html",
    "./admin.html",
    "./manifest.webmanifest",
    "./manifest-staff.webmanifest",
    "./app/core/appearance.js?v=4",
    "./app/core/navigation.js?v=9",
    "./app/core/navigation.css?v=7",
    "./app/core/routes.js?v=5",
    "./app/core/view-state.js",
    "./app/core/pwa-register.js?v=3",
    "./app/core/panel-app.js?v=22",
    "./app/core/data-cache.js?v=2",
    "./app/shared/firebase/firebase-config.js",
    "./app/shared/services/product-service.js",
    "./app/shared/services/sales-service.js",
    "./app/shared/services/sales-domain.js",
    "./app/shared/services/user-service.js",
    "./app/shared/services/purchase-service.js?v=7",
    "./app/shared/theme/theme.js?v=2",
    "./app/shared/catalog/catalog-utils.js?v=3",
    "./app/shared/catalog/layout.js?v=3",
    "./app/shared/sale-note/renderer.js?v=9",
    "./app/shared/sale-note/styles.css?v=17",
    "./app/shared/styles/tokens.css?v=2",
    "./app/shared/styles/components.css?v=2",
    "./app/shared/styles/foundation.css?v=5",
    "./app/shared/styles/utilities.css?v=3",
    "./app/shared/styles/store.css?v=30",
    "./app/shared/styles/backoffice.css?v=35",
    "./app/modules/catalogo/controller.js?v=4",
    "./app/modules/catalogo/styles.css?v=2",
    "./app/modules/login/controller.js?v=9",
    "./app/modules/login/styles.css?v=6",
    "./app/modules/productos/view.html?v=2",
    "./app/modules/productos/controller.js?v=5",
    "./app/modules/productos/styles.css?v=3",
    "./app/modules/productos/csv-import.js?v=2",
    "./app/modules/historial/view.html",
    "./app/modules/historial/controller.js?v=11",
    "./app/modules/historial/styles.css?v=1",
    "./app/modules/analisis/view.html",
    "./app/modules/analisis/controller.js?v=3",
    "./app/modules/analisis/styles.css?v=1",
    "./app/modules/tienda/view.html",
    "./app/modules/tienda/controller.js?v=12",
    "./app/modules/tienda/checkout.css?v=1",
    "./app/modules/tienda/cart-audio.js",
    "./app/modules/tienda/draft-storage.js",
    "./app/modules/tienda/layout.css?v=3",
    "./app/modules/tienda/pushbuy.css?v=3",
    "./app/modules/cajeros/view.html",
    "./app/modules/cajeros/controller.js?v=3",
    "./app/modules/cajeros/styles.css?v=2",
    "./app/modules/configuracion/view.html",
    "./app/modules/configuracion/controller.js?v=2",
    "./app/modules/configuracion/styles.css?v=2",
    "./app/modules/configuracion/preferences-domain.js",
    "./app/modules/configuracion/preferences.js",
    "./app/modules/configuracion/storage-service.js",
    "./app/modules/compras/view.html?v=6",
    "./app/modules/compras/controller.js?v=7",
    "./app/modules/compras/domain.js?v=5",
    "./app/modules/compras/registration-domain.js?v=5",
    "./app/modules/compras/inventory-domain.js?v=5",
    "./app/modules/compras/openai-client.js?v=6",
    "./app/modules/compras/styles.css?v=6",
    "./app/modules/compras/package-memory.js?v=1",
    "./assets/icons/compras.svg",
    "./assets/img/login-tech-bg.png",
    "./assets/icons/icon.svg",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith("productos-sxmy-") && key !== CACHE_NAME && key !== SDK_CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    const sdk = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/12.1.0/");
    if (url.origin !== self.location.origin && !sdk) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(sdk ? SDK_CACHE : CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});

self.addEventListener("message", (event) => {
    if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
