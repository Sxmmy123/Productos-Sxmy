import { formatCode, saveProduct, uploadProductImage } from "../../core/data-cache.js?v=2";

function normalizeHeader(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];
        if (char === '"' && quoted && next === '"') { cell += '"'; index++; }
        else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) { row.push(cell); cell = ""; }
        else if ((char === "\n" || char === "\r") && !quoted) {
            if (char === "\r" && next === "\n") index++;
            row.push(cell);
            if (row.some((value) => value.trim() !== "")) rows.push(row);
            row = [];
            cell = "";
        } else cell += char;
    }
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map((values) => {
        const item = {};
        headers.forEach((header, index) => { item[header] = values[index]?.trim() || ""; });
        return item;
    });
}

function imageKey(value) {
    return String(value || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function productFromCsv(row) {
    return {
        codigo: formatCode(row.codigo || row.code || ""),
        nombre: row.nombre || row.name || "",
        precioCompra: row.preciocompra || row.compra || row.costo || 0,
        precioVenta: row.precioventa || row.venta || row.precio || row.price || 0,
        precioAnterior: "",
        historialPrecios: [],
        stock: row.stock || "",
        descripcion: row.descripcion || row.desc || "",
        imagenUrl: row.imagenurl || "",
        activo: String(row.activo || "true").toLowerCase() !== "false"
    };
}

async function readTextFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, "utf-8");
    });
}

export async function importProductsFromCsv(csvFile, imageFiles, onProgress = () => {}) {
    const rows = parseCsv(await readTextFile(csvFile));
    const imageMap = new Map();
    [...(imageFiles || [])].forEach((file) => {
        const key = imageKey(file.name);
        if (key) imageMap.set(key, file);
    });
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
        const product = productFromCsv(row);
        if (!product.codigo || !product.nombre || !product.precioVenta) {
            skipped++;
            continue;
        }
        const requestedImage = row.imagenarchivo || row.archivoimagen || row.imagen || "";
        const matchedImage = imageMap.get(imageKey(requestedImage)) || imageMap.get(imageKey(product.codigo));
        if (matchedImage) {
            onProgress(`Subiendo imagen ${product.codigo}...`);
            product.imagenUrl = await uploadProductImage(matchedImage, product.codigo);
        }
        onProgress(`Guardando ${product.codigo}...`);
        await saveProduct(product);
        imported++;
    }
    return { imported, skipped };
}

export function downloadCsvTemplate() {
    const csv = [
        "codigo,nombre,precioCompra,precioVenta,stock,descripcion,imagenArchivo,imagenUrl,activo",
        "001,Arduino UNO,75,95,,Placa Arduino Uno con cable,001.jpg,,true",
        "002,Motor DC 9V,6.5,14,20,Motor para proyectos escolares,002.jpg,,true"
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla-productos.csv";
    link.click();
    URL.revokeObjectURL(url);
}
