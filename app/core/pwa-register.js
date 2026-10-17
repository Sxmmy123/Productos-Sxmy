if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        let accepted = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (accepted) location.reload();
        });
        try {
            const registration = await navigator.serviceWorker.register("./service-worker.js");
            const offer = () => {
                if (!registration.waiting || !navigator.serviceWorker.controller || document.getElementById("pwaUpdateBar")) return;
                const bar = document.createElement("div");
                bar.id = "pwaUpdateBar";
                bar.className = "pwa-update-bar";
                const text = document.createElement("span");
                text.textContent = "Actualizacion disponible";
                const button = document.createElement("button");
                button.className = "btn-light";
                button.type = "button";
                button.textContent = "Actualizar";
                button.addEventListener("click", () => {
                    if (document.documentElement.dataset.saleSaving === "true") {
                        text.textContent = "Espera a que termine la venta";
                        return;
                    }
                    document.dispatchEvent(new CustomEvent("sxmy:save-draft"));
                    accepted = true;
                    registration.waiting?.postMessage({ type: "SKIP_WAITING" });
                });
                bar.append(text, button);
                document.body.append(bar);
            };
            offer();
            registration.addEventListener("updatefound", () => {
                registration.installing?.addEventListener("statechange", offer);
            });
        } catch (error) {
            console.warn("No se pudo registrar la PWA:", error);
        }
    });
}
