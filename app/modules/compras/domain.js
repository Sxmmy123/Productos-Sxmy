export const normalizeName = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/motoreductor/g, "motorreductor");
export const isPackage = value => /\b(bolsas?|cajas?|paquetes?|lotes?|docenas?|packs?)\b/i.test(value || "");
export function rowAmounts(row) {
    const cantidad = Number(row.cantidad), importe = Number(row.importe);
    if (row.cantidad === "" || row.cantidad == null || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100000 || row.importe === "" || row.importe == null || !Number.isFinite(importe) || importe < 0 || importe > 1e7 || Math.abs(importe * 100 - Math.round(importe * 100)) > .0001 || !["total", "unitario"].includes(row.tipoPrecio)) return null;
    const amount = Math.round(importe * 100);
    return { total: (row.tipoPrecio === "total" ? amount : amount * cantidad) / 100, unitario: (row.tipoPrecio === "total" ? Math.round(amount / cantidad) : amount) / 100 };
}
export function purchaseSummary(rows) {
    const included = rows.filter(row => row.incluir);
    const amounts = included.map(rowAmounts);
    return { count: included.length, incomplete: amounts.filter(value => !value).length,
        pendingMatches: included.filter(row => row.productId && !row.confirmado).length,
        updates: included.filter(row => row.actualizar).length,
        total: amounts.reduce((sum, value) => sum + (value ? Math.round(value.total * 100) : 0), 0) / 100 };
}
export function inventoryUnitPrice(row) {
    const amount = rowAmounts(row);
    if (!amount) return null;
    const units = isPackage(row.unidad) ? Number(row.unidadesPorPaquete) : 1;
    if (!Number.isInteger(units) || units < 1 || units > 100000) return null;
    return Math.round(Math.round(amount.total * 100) / (Number(row.cantidad) * units)) / 100;
}
export function attachInventory(rows, products) {
    const map = new Map(products.map(product => [product.id, product]));
    return rows.map(row => {
        const product = map.get(row.productId);
        if (!product) return { ...row, actualizar: false, cambiarVenta: false, precioVenta: "" };
        const changed = row.expectedCompra != null && (Number(row.expectedCompra) !== Number(product.precioCompra) || Number(row.expectedVenta) !== Number(product.precioVenta));
        const attached = { ...row, nombre: row.confirmado ? product.nombre : row.nombreOriginal || row.nombre, expectedCompra: Number(product.precioCompra), expectedVenta: Number(product.precioVenta),
            cambiarVenta: !changed && row.cambiarVenta === true,
            precioVenta: changed || row.precioVenta == null || row.precioVenta === "" ? Number(product.precioVenta) : row.precioVenta,
            updateChoice: changed ? false : row.updateChoice, precioCambio: changed };
        const state = comparisonState(attached);
        attached.actualizar = row.incluir !== false && ["up", "down"].includes(state.kind) && (attached.updateChoice ?? state.kind === "up");
        return attached;
    });
}
const nameTokens = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/motor[ -]?reductor|motoreductor/g, "motorreductor").match(/[a-z0-9]+/g)?.filter(token => !["de", "del", "la", "el", "con", "para", "unidades", "unidad", "bolsa", "bolsas"].includes(token))
    .map(token => token.endsWith("ores") ? token.slice(0, -2) : token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token) || [];
export function candidateProducts(row, products) {
    const words = nameTokens(row.nombreOriginal || row.nombre), supplied = new Set(row.candidatos || []);
    if (!row.confirmado && row.productId) supplied.add(row.productId);
    const exact = normalizeName(row.nombreOriginal || row.nombre);
    return products.map(product => {
        const tokens = nameTokens(product.nombre), common = words.filter(token => tokens.includes(token)).length;
        const score = normalizeName(product.nombre) === exact ? 100 : supplied.has(product.id) ? 20 + common : common && words.some(token => token.length >= 4 && tokens.includes(token)) ? common / Math.max(words.length, 1) : 0;
        return { product, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || String(a.product.codigo).localeCompare(String(b.product.codigo), undefined, { numeric: true })).slice(0, 6).map(item => item.product);
}
export function setUnitPrice(row, value) {
    if (value === "") { row.importe = ""; return; }
    const price = Number(value), pieces = isPackage(row.unidad) ? Number(row.unidadesPorPaquete) : 1;
    if (!Number.isInteger(pieces) || pieces < 1) return;
    if (!Number.isFinite(price) || price < 0) { row.importe = ""; return; }
    // Only deliberate unit-price edits replace the original line total (28 / 3 stays 28).
    row.importe = Math.abs(price * 100 - Math.round(price * 100)) > .0001 ? price * pieces : Math.round(price * 100) * pieces / 100;
    row.tipoPrecio = "unitario";
}
export function comparisonState(row) {
    const amount = rowAmounts(row), unit = inventoryUnitPrice(row);
    if (!amount) return { kind: "incomplete", unit: null };
    if (!row.productId) return { kind: "new", unit };
    if (!row.confirmado) return { kind: "match", unit };
    if (unit == null) return { kind: "package", unit: null };
    const delta = (Math.round(unit * 100) - Math.round(Number(row.expectedCompra || 0) * 100)) / 100;
    return { kind: delta > 0 ? "up" : delta < 0 ? "down" : "same", unit, delta };
}
export function suggestNewSalePrice(unit, products) {
    if (!Number.isFinite(unit) || unit < 0) return null;
    const ratios = products.filter(product => product.precioCompra > 0 && product.precioVenta >= product.precioCompra)
        .map(product => product.precioVenta / product.precioCompra).sort((a, b) => a - b);
    const ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1.3;
    return Math.round(unit * ratio * 100) / 100;
}
export function purchaseRow(row) {
    return { nombre: row.confirmado ? row.nombre.trim() : (row.nombreOriginal || row.nombre).trim(), nombreOriginal: row.nombreOriginal || row.nombre.trim(),
        cantidad: Number(row.cantidad), unidad: row.unidad || "unid.",
        unidadesPorPaquete: row.unidadesPorPaquete == null || row.unidadesPorPaquete === "" ? null : Number(row.unidadesPorPaquete),
        importe: Number(row.importe), tipoPrecio: row.tipoPrecio, productId: row.confirmado ? row.productId || "" : "", confirmado: row.confirmado === true, actualizar: false };
}
export function buildInventoryUpdate({ rows, requestId }) {
    const selected = rows.filter(row => row.incluir && row.actualizar && ["up", "down"].includes(comparisonState(row).kind));
    if (!selected.length) throw new Error("Selecciona al menos un cambio de precio.");
    const ids = new Set();
    const items = selected.map(row => {
        if (ids.has(row.productId)) throw new Error("Selecciona una sola fila por producto.");
        ids.add(row.productId);
        const precioVenta = row.cambiarVenta === true ? row.precioVenta : row.expectedVenta;
        if (precioVenta === "" || !Number.isFinite(Number(precioVenta)) || Number(precioVenta) < 0) throw new Error("Completa el precio de venta que deseas cambiar.");
        return { ...purchaseRow(row), actualizar: true, cambiarVenta: row.cambiarVenta === true, expectedCompra: Number(row.expectedCompra), expectedVenta: Number(row.expectedVenta), precioVenta: Number(precioVenta) };
    });
    return { requestId, items };
}
export function suggestedSalePrice(row) {
    const price = inventoryUnitPrice(row);
    return price != null && Number(row.expectedCompra) > 0 ? Math.round(price * Number(row.expectedVenta) / Number(row.expectedCompra) * 100) / 100 : null;
}
export function buildPurchase({ rows, requestId, proveedor, fecha, textoOriginal }) {
    const summary = purchaseSummary(rows);
    if (!summary.count) throw new Error("Incluye al menos un producto.");
    if (summary.incomplete) throw new Error("Completa cantidad y precio de las filas incluidas.");
    const items = rows.filter(row => row.incluir).map(row => {
        if (!row.nombre?.trim()) throw new Error("Completa el nombre de cada producto.");
        return purchaseRow(row);
    });
    return { requestId, proveedor: proveedor.trim(), fecha, textoOriginal, items };
}
