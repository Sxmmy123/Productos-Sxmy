export const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function validateOrder(sale) {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(sale.requestId || "")) throw new Error("La orden no tiene un identificador valido.");
    if (!Array.isArray(sale.items) || !sale.items.length || sale.items.length > 150) throw new Error("Revisa los productos de la orden.");
    const ids = new Set();
    return sale.items.map((item) => {
        const productId = String(item.productId || item.id || "");
        const cantidad = Number(item.cantidad ?? item.qty);
        const precio = Number(item.precio ?? item.precioVenta);
        if (!productId || productId.includes("/") || ids.has(productId)) throw new Error("La orden contiene productos repetidos o invalidos.");
        if (!Number.isSafeInteger(cantidad) || cantidad < 1 || !Number.isFinite(precio) || precio < 0) throw new Error("Revisa las cantidades y precios.");
        ids.add(productId);
        return { productId, cantidad, precio: money(precio) };
    });
}

export function saleItemsFromProducts(items, products) {
    return items.map((item, index) => {
        const product = products[index];
        if (!product || product.activo === false) throw new Error("Un producto ya no esta disponible. Revisa la orden.");
        const price = Number(product.precioVenta);
        if (!Number.isFinite(price) || money(price) !== item.precio) throw new Error(`Cambio el precio de ${product.nombre}. Revisa la orden.`);
        const tracked = product.stock !== "" && product.stock != null;
        if (tracked && (!Number.isSafeInteger(Number(product.stock)) || Number(product.stock) < item.cantidad)) throw new Error(`Stock insuficiente: ${product.nombre}.`);
        return { ...item, codigo: String(product.codigo || ""), nombre: String(product.nombre || "Producto"), subtotal: money(item.cantidad * item.precio) };
    });
}

export function saleTotals(items, discount = 0) {
    const subtotal = money(items.reduce((sum, item) => sum + item.subtotal, 0));
    const value = Number(discount);
    if (!Number.isFinite(value) || value < 0 || value > subtotal) throw new Error("El descuento debe estar entre cero y el subtotal.");
    const descuento = money(value);
    return { subtotal, descuento, total: money(subtotal - descuento) };
}

export function saleDateRange(mode, from = "", to = "", now = new Date()) {
    let start = null;
    let end = null;
    if (mode === "custom") {
        if (from) start = new Date(`${from}T00:00:00`);
        if (to) { end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1); }
    } else if (mode !== "all") {
        start = new Date(now);
        start.setHours(0, 0, 0, 0);
        if (mode === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        if (mode === "month") start.setDate(1);
        end = new Date(now);
        end.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() + 1);
    }
    if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime())) || (start && end && start >= end)) throw new Error("Revisa el rango de fechas.");
    return { start, end };
}

export function localDateKey(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Sin fecha";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function lowStock(product) {
    return product.activo !== false && product.stock !== "" && product.stock != null && product.stockMinimo !== "" && product.stockMinimo != null && Number(product.stock) <= Number(product.stockMinimo);
}

export function summarizeSales(sales, products = []) {
    const productIndex = new Map(products.flatMap((product) => [[product.id, product], [product.codigo, product]]));
    const ranked = new Map(), days = new Map();
    let units = 0, income = 0, cash = 0, transfer = 0;
    sales.forEach((sale) => {
        const net = Math.round(Number(sale.total || 0) * 100);
        const gross = sale.items.reduce((sum, item) => sum + Math.round(item.subtotal * 100), 0);
        income += net;
        if (sale.metodoPago === "Transferencia") transfer += net;
        else cash += net;
        const day = localDateKey(sale.fechaOrden || sale.fechaIso);
        days.set(day, (days.get(day) || 0) + net);
        let assigned = 0;
        sale.items.forEach((item, index) => {
            const key = item.productId || item.codigo || item.nombre;
            const product = productIndex.get(item.productId) || productIndex.get(item.codigo);
            const current = ranked.get(key) || { nombre: item.nombre, codigo: item.codigo, imagenUrl: product?.imagenUrl || "", cantidad: 0, cents: 0 };
            const portion = index === sale.items.length - 1 ? net - assigned : Math.floor(gross ? net * Math.round(item.subtotal * 100) / gross : 0);
            assigned += portion;
            current.cantidad += item.cantidad;
            current.cents += portion;
            units += item.cantidad;
            ranked.set(key, current);
        });
    });
    return {
        income: income / 100, cash: cash / 100, transfer: transfer / 100, units,
        products: [...ranked.values()].map((item) => ({ ...item, total: item.cents / 100 })).sort((a, b) => b.cantidad - a.cantidad),
        days: [...days].map(([nombre, cents]) => ({ nombre, total: cents / 100 })).sort((a, b) => b.nombre.localeCompare(a.nombre))
    };
}
