const STORAGE_KEY = "sxmy-theme";

export function initTheme() {
    let saved;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Keep the default appearance. */ }
    const theme = saved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    hydrateButtons();
    updateButtons(theme);
}

export function setupThemeToggle() {
    initTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
            const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
            const next = current === "dark" ? "light" : "dark";
            setTheme(next);
            document.dispatchEvent(new CustomEvent("sxmy:theme-change", { detail: { theme: next } }));
        });
    });
}

export function setTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Theme remains usable without storage. */ }
    document.documentElement.dataset.theme = next;
    hydrateButtons();
    updateButtons(next);
}

function updateButtons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        const label = theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
        button.dataset.themeState = theme;
        button.setAttribute("aria-label", label);
        button.title = label;
    });
}

function hydrateButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
        if (button.querySelector(".theme-toggle-track")) return;
        button.innerHTML = `
            <span class="theme-toggle-track" aria-hidden="true">
                <span class="theme-toggle-sun"></span>
                <span class="theme-toggle-moon"></span>
                <span class="theme-toggle-thumb"></span>
            </span>
        `;
    });
}
