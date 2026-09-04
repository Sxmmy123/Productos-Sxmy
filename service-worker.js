const CACHE_NAME = "productos-sxmy-v5";
const APP_SHELL = [
    "./",
    "./index.html",
    "./login.html",
    "./admin.html",
    "./admin-users.html",
    "./manifest.webmanifest",
    "./css/style.css",
    "./css/utilities.css",
    "./css/store-cart.css",
    "./css/admin-compact.css",
    "./css/login.css",
    "./css/sale-note.css",
    "./js/catalog.js",
    "./js/admin.js",
    "./js/admin-users.js",
    "./js/login.js",
    "./js/product-service.js",
    "./js/sales-service.js",
    "./js/theme-service.js",
    "./js/user-service.js",
    "./firebase/firebase-config.js",
    "./assets/img/login-tech-bg.png",
    "./assets/icons/icon.svg",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

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
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
