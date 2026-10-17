const MAX_ROWS = 200;
const MAX_TEXT = 16000;

function invalid(message) { throw Object.assign(new Error(message), { code: "invalid-argument" }); }
function text(value, max = 200) {
    if (typeof value !== "string" || value.length > max) invalid("Texto demasiado largo o no valido.");
    return value.trim();
}
function cents(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e7) invalid("Revisa los importes de la compra.");
    const result = Math.round(value * 100);
    if (Math.abs(value * 100 - result) > .0001) invalid("Los importes admiten hasta dos decimales.");
    return result;
}
function normalizeName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/motoreductor/g, "motorreductor");
}
const aliasKey = value => normalizeName(value);
const isPackage = value => /\b(bolsas?|cajas?|paquetes?|lotes?|docenas?|packs?)\b/i.test(value || "");
function safeId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value); }

function normalizePurchase(input) {
    if (!input || !safeId(input.requestId)) invalid("Identificador de compra no valido.");
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_ROWS) invalid("La compra debe contener de 1 a 200 filas.");
    const fecha = text(input.fecha, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha) invalid("Fecha de compra no valida.");
    const updates = new Set();
    const items = input.items.map((row, index) => {
        if (!row || !Number.isInteger(row.cantidad) || row.cantidad < 1 || row.cantidad > 100000) invalid(`Revisa la cantidad en la fila ${index + 1}.`);
        if (!["total", "unitario"].includes(row.tipoPrecio)) invalid(`Indica si el importe es total o unitario en la fila ${index + 1}.`);
        const nombre = text(row.nombre), nombreOriginal = text(row.nombreOriginal || row.nombre);
        if (!nombre) invalid(`Falta el nombre en la fila ${index + 1}.`);
        const importe = cents(row.importe);
        const totalCentavos = row.tipoPrecio === "total" ? importe : importe * row.cantidad;
        if (!Number.isSafeInteger(totalCentavos) || totalCentavos > 1e10) invalid("El total de la fila es demasiado grande.");
        const precioCompra = row.tipoPrecio === "total" ? Math.round(importe / row.cantidad) / 100 : importe / 100;
        const productId = row.productId || "";
        if (productId && (!safeId(productId) || row.confirmado !== true)) invalid(`Confirma el producto de inventario en la fila ${index + 1}.`);
        const actualizar = row.actualizar === true;
        const unidad = text(row.unidad || "unid.", 40);
        const unidadesPorPaquete = row.unidadesPorPaquete == null || row.unidadesPorPaquete === "" ? null : row.unidadesPorPaquete;
        if (unidadesPorPaquete != null && (!Number.isInteger(unidadesPorPaquete) || unidadesPorPaquete < 1 || unidadesPorPaquete > 100000)) invalid("Revisa las unidades por paquete.");
        const precioCompraInventario = isPackage(unidad) && unidadesPorPaquete == null ? null : Math.round(totalCentavos / (row.cantidad * (isPackage(unidad) ? unidadesPorPaquete : 1))) / 100;
        if (actualizar && precioCompraInventario == null) invalid("Indica las unidades por paquete antes de actualizar su costo de inventario.");
        if (actualizar && !productId) invalid("Solo puedes actualizar productos vinculados al inventario.");
        if (actualizar && updates.has(productId)) invalid("Elige una sola fila para actualizar cada producto repetido.");
        if (actualizar) updates.add(productId);
        return {
            nombre, nombreOriginal, cantidad: row.cantidad, unidad, unidadesPorPaquete,
            importe: importe / 100, tipoPrecio: row.tipoPrecio, precioCompra, precioCompraInventario, total: totalCentavos / 100,
            productId, actualizar,
            ...(actualizar ? { precioVenta: cents(row.precioVenta) / 100, expectedCompra: cents(row.expectedCompra) / 100, expectedVenta: cents(row.expectedVenta) / 100 } : {})
        };
    });
    return {
        requestId: input.requestId, proveedor: text(input.proveedor || "", 160), fecha,
        textoOriginal: text(input.textoOriginal || "", MAX_TEXT), items,
        total: items.reduce((sum, row) => sum + Math.round(row.total * 100), 0) / 100
    };
}

function prepareRegistration(purchase, products) {
    const changes = [], aliases = new Map();
    const items = purchase.items.map(row => {
        const product = row.productId ? products.get(row.productId) : null;
        if (row.productId && !product) throw Object.assign(new Error(`El producto ${row.nombre} ya no existe. Revisa la lista.`), { code: "failed-precondition" });
        if (row.actualizar) {
            const oldBuy = cents(Number(product.precioCompra || 0)) / 100;
            const oldSell = cents(Number(product.precioVenta || 0)) / 100;
            if (oldBuy !== row.expectedCompra || oldSell !== row.expectedVenta) throw Object.assign(new Error(`El precio de ${product.nombre} cambio. Actualiza la comparacion y vuelve a elegir los cambios.`), { code: "aborted" });
            const patch = { precioCompra: row.precioCompraInventario, precioVenta: row.precioVenta };
            if (oldSell !== row.precioVenta) {
                patch.precioAnterior = oldSell;
                const date = new Date();
                patch.historialPrecios = [...(Array.isArray(product.historialPrecios) ? product.historialPrecios : []), {
                    anterior: oldSell, nuevo: row.precioVenta, fechaIso: date.toISOString(),
                    fechaTexto: date.toLocaleString("es-BO", { timeZone: "America/La_Paz" })
                }].slice(-12);
            }
            changes.push({ productId: row.productId, patch, compraAnterior: oldBuy, ventaAnterior: oldSell });
        }
        if (product && normalizeName(row.nombreOriginal).length >= 4) {
            const key = aliasKey(row.nombreOriginal), previous = aliases.get(key);
            // A generic name used for two variants must never become a permanent alias.
            aliases.set(key, previous && previous.productId !== row.productId ? { ambiguous: true } : previous?.ambiguous ? previous : { productId: row.productId, nombre: row.nombreOriginal });
        }
        return {
            nombre: product?.nombre || row.nombre, nombreOriginal: row.nombreOriginal,
            codigo: String(product?.codigo || ""), productId: row.productId,
            cantidad: row.cantidad, unidad: row.unidad, unidadesPorPaquete: row.unidadesPorPaquete, importe: row.importe, tipoPrecio: row.tipoPrecio,
            precioCompra: row.precioCompra, precioCompraInventario: row.precioCompraInventario, total: row.total, actualizado: row.actualizar,
            ...(row.actualizar ? { compraAnterior: row.expectedCompra, ventaAnterior: row.expectedVenta, precioVenta: row.precioVenta } : {})
        };
    });
    return { items, changes, aliases: [...aliases].filter(([, value]) => !value.ambiguous) };
}

function reconcileInterpretation(result, products, aliases = new Map()) {
    if (!Array.isArray(result?.filas) || !result.filas.length || result.filas.length > MAX_ROWS) invalid("La IA no devolvio una lista valida de hasta 200 filas.");
    return {
        filas: result.filas.map((row, index) => {
            const nombreOriginal = text(row.nombre, 200);
            if (!nombreOriginal) invalid("La IA devolvio una fila sin nombre.");
            const key = normalizeName(nombreOriginal);
            const exact = products.filter(product => normalizeName(product.nombre) === key);
            const remembered = products.find(product => product.id === aliases.get(aliasKey(nombreOriginal))?.productId);
            const suggested = products.find(product => product.id === row.productId);
            const resolved = remembered || (exact.length === 1 ? exact[0] : null);
            const product = resolved || suggested;
            const cantidad = Number.isInteger(row.cantidad) && row.cantidad > 0 && row.cantidad <= 100000 ? row.cantidad : null;
            const importe = row.importe == null ? null : cents(row.importe) / 100;
            return {
                id: `fila-${index + 1}`, nombreOriginal, nombre: resolved?.nombre || nombreOriginal,
                descripcion: text(row.descripcion || "", 1000), detallesIA: typeof row.descripcion === "string" && Boolean(row.descripcion.trim()),
                cantidad, unidad: text(row.unidad || "unid.", 40), importe,
                unidadesPorPaquete: Number.isInteger(row.unidadesPorPaquete) && row.unidadesPorPaquete > 0 && row.unidadesPorPaquete <= 100000 ? row.unidadesPorPaquete : null,
                tipoPrecio: row.tipoPrecio === "unitario" ? "unitario" : "total",
                productId: product?.id || "", confirmado: Boolean(resolved),
                coincidencia: resolved ? "exacta" : product ? "probable" : "ninguna",
                grupo: text(row.grupo || "", 160),
                candidatos: [...new Set([...(product ? [product.id] : []), ...(Array.isArray(row.candidatos) ? row.candidatos : [])])].filter(id => products.some(product => product.id === id)).slice(0, 4),
                incluir: true, actualizar: false
            };
        }),
        totalDeclarado: result.totalDeclarado == null ? null : cents(result.totalDeclarado) / 100,
        avisos: Array.isArray(result.avisos) ? result.avisos.slice(0, 30).map(value => text(value, 500)) : []
    };
}

export { MAX_ROWS, MAX_TEXT, cents, normalizeName, aliasKey, safeId, normalizePurchase, prepareRegistration, reconcileInterpretation };
