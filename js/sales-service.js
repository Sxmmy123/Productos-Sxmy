import { db } from "../firebase/firebase-config.js";
import {
    addDoc,
    collection,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const SALES_COLLECTION = "ventas";
const salesRef = collection(db, SALES_COLLECTION);

export function formatMoney(value) {
    return Number(value || 0).toFixed(2).replace(".00", "");
}

export function formatSaleNumber(value, fallback = "000001") {
    const raw = String(value || "").trim();
    if (/^\d+$/.test(raw)) return raw.padStart(6, "0");
    const fallbackRaw = String(fallback || "1").trim();
    if (/^\d+$/.test(fallbackRaw)) return fallbackRaw.padStart(6, "0");
    return "000001";
}

export function dateTimeText(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString("es-BO", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

export async function saveSale(sale) {
    const now = new Date();
    const cleanItems = sale.items.map((item) => ({
        productId: item.productId || item.id || "",
        codigo: String(item.codigo || ""),
        nombre: String(item.nombre || ""),
        precio: Number(item.precio || item.precioVenta || 0),
        cantidad: Number(item.cantidad || item.qty || 0),
        subtotal: Number(item.subtotal || 0)
    }));
    const total = cleanItems.reduce((sum, item) => sum + item.subtotal, 0);
    const descuento = Math.min(Math.max(Number(sale.descuento || 0), 0), total);
    const payload = {
        numero: await buildSaleNumber(),
        cliente: String(sale.cliente || "Cliente").trim() || "Cliente",
        direccion: String(sale.direccion || "").trim(),
        telefono: String(sale.telefono || "").trim(),
        metodoPago: String(sale.metodoPago || "Efectivo").trim() || "Efectivo",
        vendedorUid: String(sale.vendedorUid || "").trim(),
        vendedorNombre: String(sale.vendedorNombre || sale.vendedorEmail || "Vendedor").trim(),
        vendedorEmail: String(sale.vendedorEmail || "").trim().toLowerCase(),
        items: cleanItems,
        subtotal: total,
        descuento,
        total: Math.max(0, total - descuento),
        fechaIso: now.toISOString(),
        fechaTexto: dateTimeText(now),
        createdAt: serverTimestamp()
    };
    const docRef = await addDoc(salesRef, payload);
    return { id: docRef.id, ...payload };
}

export async function getSales() {
    const snapshot = await getDocs(salesRef);
    const normalized = snapshot.docs
        .map((item) => normalizeSale({ id: item.id, ...item.data() }))
        .sort((a, b) => a.fechaOrden - b.fechaOrden);

    normalized.forEach((sale, index) => {
        sale.numeroVista = sale.numero || formatSaleNumber(index + 1);
    });

    return normalized.sort((a, b) => b.fechaOrden - a.fechaOrden);
}

function normalizeSale(sale) {
    const createdAtMillis = sale.createdAt?.toMillis?.() || 0;
    const isoMillis = sale.fechaIso ? new Date(sale.fechaIso).getTime() : 0;
    const items = Array.isArray(sale.items) ? sale.items : [];
    return {
        id: sale.id,
        numero: normalizeSaleNumber(sale.numero),
        cliente: sale.cliente || "Cliente",
        direccion: sale.direccion || "",
        telefono: sale.telefono || "",
        metodoPago: sale.metodoPago || "Efectivo",
        vendedorUid: sale.vendedorUid || "",
        vendedorNombre: sale.vendedorNombre || sale.vendedorEmail || "Vendedor",
        vendedorEmail: sale.vendedorEmail || "",
        items: items.map((item) => ({
            productId: item.productId || "",
            codigo: item.codigo || "",
            nombre: item.nombre || "Producto",
            precio: Number(item.precio || 0),
            cantidad: Number(item.cantidad || 0),
            subtotal: Number(item.subtotal || 0)
        })),
        subtotal: Number(sale.subtotal || sale.total || 0),
        descuento: Number(sale.descuento || 0),
        total: Number(sale.total || 0),
        fechaIso: sale.fechaIso || "",
        fechaTexto: sale.fechaTexto || (isoMillis ? dateTimeText(sale.fechaIso) : "Sin fecha"),
        fechaOrden: createdAtMillis || isoMillis || 0
    };
}

function normalizeSaleNumber(value) {
    const raw = String(value || "").trim();
    return /^\d+$/.test(raw) ? formatSaleNumber(raw) : "";
}

async function buildSaleNumber() {
    const snapshot = await getDocs(salesRef);
    let maxNumber = 0;
    snapshot.docs.forEach((doc) => {
        const storedNumber = normalizeSaleNumber(doc.data().numero);
        if (storedNumber) maxNumber = Math.max(maxNumber, Number(storedNumber));
    });
    if (!maxNumber) maxNumber = snapshot.size;
    return formatSaleNumber(maxNumber + 1);
}
