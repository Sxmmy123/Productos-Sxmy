export function stockLabel(product) {
    if (product.stock === "") return "Stock libre";
    if (Number(product.stock) > 0) return `${product.stock} disp.`;
    return "Sin stock";
}

export function formatCatalogMoney(value) {
    return Number(value || 0).toFixed(2).replace(".00", "");
}

export function productHasStock(product) {
    return product.stock === "" || Number(product.stock || 0) > 0;
}

export function productInitial(product) {
    const initial = String(product.nombre || "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .charAt(0)
        .toUpperCase();
    return /^[A-Z]$/.test(initial) ? initial : "#";
}

export function availableCatalogLetters(products) {
    return [...new Set(products
        .filter((product) => product.activo !== false)
        .map(productInitial))]
        .sort((a, b) => {
            if (a === "#") return 1;
            if (b === "#") return -1;
            return a.localeCompare(b);
        });
}

export function filterCatalogProducts(products, query = "", initial = "all") {
    const normalizedQuery = String(query).trim().toLocaleLowerCase("es");
    return products
        .filter((product) => product.activo !== false)
        .filter((product) => !normalizedQuery || [product.codigo, product.nombre, product.descripcion]
            .some((value) => String(value || "").toLocaleLowerCase("es").includes(normalizedQuery)))
        .filter((product) => initial === "all" || productInitial(product) === initial)
        .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));
}
