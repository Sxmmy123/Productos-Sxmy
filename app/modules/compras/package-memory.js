const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const validUnits = value => Number.isInteger(value) && value > 0 && value <= 100000;
export function packageKind(value) {
    const word = clean(value).match(/\b(bolsas?|cajas?|paquetes?|lotes?|docenas?|packs?)\b/)?.[1];
    return word?.replace(/s$/, "") || "";
}
function tokens(value) {
    return clean(value).replace(/porta\s*pilas?/g, "pila").match(/[a-z0-9]+/g)?.filter(word => !/^(de|del|la|el|las|los|para|con|una?|bolsas?|cajas?|paquetes?|lotes?|docenas?|packs?|unidades?|uds?|u)$/.test(word))
        .map(word => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word) || [];
}
function compatibleNames(a, b) {
    const first = tokens(a), second = tokens(b);
    const batteries = list => list.filter(word => /^(aa|aaa|aaaa|18650|14500|16340|cr2032|cr2025)$/.test(word));
    const aa = batteries(first), bb = batteries(second);
    return !aa.length || !bb.length || aa.every(word => bb.includes(word));
}
export function buildPackageMemory(purchases) {
    const entries = new Map();
    for (const purchase of purchases) {
        if (purchase.estado !== "comprado") continue;
        for (const [index, item] of (Array.isArray(purchase.items) ? purchase.items : []).entries()) {
            if (!item) continue;
            const kind = packageKind(item.unidad), units = item.unidadesPorPaquete;
            if (!kind || !validUnits(units) || !item.nombre) continue;
            const names = [...new Set([item.nombre, item.nombreOriginal].filter(Boolean))];
            const identity = item.productId || [...tokens(item.nombre)].sort().join("-");
            const key = `${identity}:${kind}:${units}`;
            const previous = entries.get(key);
            if (previous) { previous.nombres = [...new Set([...previous.nombres, ...names])]; continue; }
            entries.set(key, { id: `${purchase.id}:${index}`, compraId: purchase.id, fecha: purchase.fecha || "", proveedor: purchase.proveedor || "",
                nombre: item.nombre, nombres: names, productId: item.productId || "", kind, unidades: units, identity });
        }
    }
    return [...entries.values()];
}
export function packageCandidates(row, memory) {
    const kind = packageKind(row.unidad);
    if (!kind) return [];
    const names = [row.nombre, row.nombreOriginal].filter(Boolean);
    const candidates = memory.map(entry => {
        if (entry.kind !== kind || !validUnits(entry.unidades) || !names.every(name => compatibleNames(name, entry.nombre))) return null;
        if (row.confirmado && row.productId) return entry.productId === row.productId ? { ...entry, score: 3 } : null;
        const score = Math.max(0, ...names.flatMap(name => entry.nombres.map(old => {
            const current = tokens(name), previous = tokens(old);
            if (current.length < 2 || !current.some(word => word.length >= 4)) return 0;
            if (current.length === previous.length && current.every(word => previous.includes(word))) return 2;
            return current.every(word => previous.includes(word)) ? 1 : 0;
        })));
        return score ? { ...entry, score } : null;
    }).filter(Boolean);
    const best = Math.max(0, ...candidates.map(entry => entry.score));
    return candidates.filter(entry => entry.score === best);
}
export function rememberPackages(rows, memory, enabled = true) {
    return rows.map(original => {
        const row = { ...original };
        if (row.empaqueRecordado) {
            if (enabled && row.empaqueRecordado.seleccionado && packageCandidates(row, memory).some(entry => entry.id === row.empaqueRecordado.id)) return row;
            // A manually edited value must never be erased by switching history off.
            if (Number(row.unidadesPorPaquete) === row.empaqueRecordado.unidades) row.unidadesPorPaquete = null;
            delete row.empaqueRecordado;
        }
        if (!enabled || row.omitirMemoriaEmpaque || row.unidadesPorPaquete !== "" && row.unidadesPorPaquete != null) return row;
        const candidates = packageCandidates(row, memory);
        if (new Set(candidates.map(entry => entry.identity)).size !== 1 || new Set(candidates.map(entry => entry.unidades)).size !== 1) return row;
        const source = candidates[0];
        if (source) { row.unidadesPorPaquete = source.unidades; row.empaqueRecordado = { id: source.id, unidades: source.unidades, compraId: source.compraId, fecha: source.fecha, nombre: source.nombre, productId: source.productId }; }
        return row;
    });
}
export function choosePackage(row, entry) {
    return { ...row, unidadesPorPaquete: entry.unidades, empaqueRecordado: { id: entry.id, unidades: entry.unidades, compraId: entry.compraId, fecha: entry.fecha, nombre: entry.nombre, productId: entry.productId, seleccionado: true }, omitirMemoriaEmpaque: false };
}
