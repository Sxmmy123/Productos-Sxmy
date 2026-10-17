import { cents, safeId, normalizePurchase, prepareRegistration, normalizeName } from "./registration-domain.js?v=5";

export function prepareInventory(input, products) {
    const normalized = normalizePurchase({ ...input, proveedor: "", fecha: new Date().toISOString().slice(0, 10), textoOriginal: "",
        items: input.items.map(row => ({ ...row, actualizar: true, precioVenta: row.cambiarVenta === true ? row.precioVenta : row.expectedVenta })) });
    const prepared = prepareRegistration(normalized, products);
    return prepared.changes.filter(change => change.patch.precioCompra !== change.compraAnterior || change.patch.precioVenta !== change.ventaAnterior);
}
export function newProductValues(input) {
    if (!safeId(input?.requestId)) throw Object.assign(new Error("Identificador no valido."), { code: "invalid-argument" });
    const nombre = String(input.nombre || "").trim();
    const descripcion = String(input.descripcion || "").trim();
    if (descripcion.length > 1000) throw Object.assign(new Error("La descripcion admite hasta 1000 caracteres."), { code: "invalid-argument" });
    if (!nombre || nombre.length > 200 || input.precioVenta === "" || input.precioVenta == null) throw Object.assign(new Error("Completa nombre y precio de venta."), { code: "invalid-argument" });
    const normalized = normalizePurchase({ requestId: input.requestId, proveedor: "", fecha: new Date().toISOString().slice(0, 10), textoOriginal: "",
        items: [{ ...input.row, nombre, nombreOriginal: nombre, productId: "", confirmado: false, actualizar: false }] });
    const row = normalized.items[0];
    if (row.precioCompraInventario == null) throw Object.assign(new Error("Indica cuantas unidades contiene cada paquete antes de crear el producto."), { code: "invalid-argument" });
    return { nombre, precioCompra: row.precioCompraInventario, precioVenta: cents(Number(input.precioVenta)) / 100,
        imagenUrl: "", descripcion, stock: "", stockMinimo: "", activo: true, precioAnterior: "", historialPrecios: [] };
}
export function nextCode(products) {
    return products.reduce((max, product) => /^\d+$/.test(String(product.codigo)) && Number.isSafeInteger(Number(product.codigo)) ? Math.max(max, Number(product.codigo)) : max, 0) + 1;
}
export function duplicateProduct(nombre, products) {
    return products.find(product => normalizeName(product.nombre) === normalizeName(nombre));
}
