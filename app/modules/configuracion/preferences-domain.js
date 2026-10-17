const choices = {
    theme: ["light", "dark"],
    productView: ["table", "cards", "compact"],
    productSort: ["codigo", "precio-asc", "precio-desc", "stock", "nombre", "fecha"],
    printFormat: ["letter", "ticket80", "ticket58"]
};

export function defaultPreferences() {
    return {
        general: { theme: "light", sidebarCollapsed: false, sounds: true, pushbuy: false },
        products: { view: "table", sort: "codigo", showActive: true, showDisabled: false, onlyNoImage: false, onlyLowStock: false, showPriceHistory: false },
        printing: { format: "letter" }
    };
}

export function normalizePreferences(input = {}) {
    const value = input && typeof input === "object" ? input : {};
    const result = defaultPreferences();
    for (const group of Object.keys(result)) {
        for (const key of Object.keys(result[group])) {
            const candidate = value[group]?.[key];
            if (typeof result[group][key] === "boolean" && typeof candidate === "boolean") result[group][key] = candidate;
        }
    }
    const select = (group, key, values) => {
        if (values.includes(value[group]?.[key])) result[group][key] = value[group][key];
    };
    select("general", "theme", choices.theme);
    select("products", "view", choices.productView);
    select("products", "sort", choices.productSort);
    select("printing", "format", choices.printFormat);
    return result;
}

export function patchPreferences(current, patch = {}) {
    const next = normalizePreferences(current);
    for (const group of Object.keys(next)) next[group] = { ...next[group], ...patch[group] };
    return normalizePreferences(next);
}

export function ticketWidth(format) {
    return format === "ticket58" ? 58 : format === "ticket80" ? 80 : null;
}
