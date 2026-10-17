import { auth, db } from "../firebase/firebase-config.js";
import {
    collection, doc, getDoc, getDocs, limit, orderBy, query,
    runTransaction, serverTimestamp, startAfter, where
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { money, saleItemsFromProducts, saleTotals, validateOrder } from "./sales-domain.js";

const salesRef = collection(db, "ventas");
const counterRef = doc(db, "contadores", "ventas");

export function formatMoney(value) {
    return money(Number(value || 0)).toFixed(2).replace(".00", "");
}

export function formatSaleNumber(value, fallback = "000001") {
    const raw = String(value || "").trim();
    if (/^\d+$/.test(raw)) return raw.padStart(6, "0");
    const other = String(fallback || "1").trim();
    return /^\d+$/.test(other) ? other.padStart(6, "0") : "000001";
}

export function dateTimeText(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString("es-BO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export async function saveSale(sale) {
    const user = auth.currentUser;
    if (!user || user.uid !== sale.vendedorUid) throw new Error("La sesion de venta no esta activa.");
    const requestedItems = validateOrder(sale);
    const saleRef = doc(salesRef, sale.requestId);
    let phase = `leer usuarios/${user.uid}`;
    try {
        const profileSnapshot = await getDoc(doc(db, "usuarios", user.uid));
        if (!profileSnapshot.exists()) {
            throw new Error(`Falta el perfil usuarios/${user.uid}. El administrador debe crearlo en Firebase con el rol correspondiente y activo: true.`);
        }
        const profile = profileSnapshot.data();
        if (!["admin", "cajero"].includes(profile.rol)) {
            throw new Error(`El perfil usuarios/${user.uid} no tiene un rol autorizado (admin o cajero).`);
        }
        if (profile.activo !== true) {
            throw new Error(`La cuenta usuarios/${user.uid} no esta habilitada para vender. El campo activo debe ser el booleano true.`);
        }
        let initialNumber = 0;
        phase = "leer contadores/ventas";
        // Bootstrap once for notes created before the counter existed.
        if (!(await getDoc(counterRef)).exists()) {
            phase = "leer ventas anteriores";
            const legacy = await getDocs(salesRef);
            initialNumber = legacy.docs.reduce((max, entry) => Math.max(max, Number(normalizeSaleNumber(entry.data().numero)) || 0), legacy.size);
        }
        phase = "guardar ventas, contadores/ventas y stock de productos";
        return await runTransaction(db, async (transaction) => {
            const previous = await transaction.get(saleRef);
            if (previous.exists()) {
                if (previous.data().vendedorUid !== user.uid) throw new Error("La orden pertenece a otro vendedor.");
                return normalizeSale({ id: previous.id, ...previous.data() });
            }
            const counter = await transaction.get(counterRef);
            const refs = requestedItems.map((item) => doc(db, "productos", item.productId));
            const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
            const products = snapshots.map((snapshot) => snapshot.exists() ? snapshot.data() : null);
            const items = saleItemsFromProducts(requestedItems, products);
            const now = new Date();
            const sequence = Number(counter.data()?.ultimoNumero ?? initialNumber) + 1;
            if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("El contador de notas requiere revision.");
            const payload = {
                numero: formatSaleNumber(sequence),
                requestId: sale.requestId,
                cliente: String(sale.cliente || "").trim() || "Cliente",
                direccion: String(sale.direccion || "").trim(),
                telefono: String(sale.telefono || "").trim(),
                metodoPago: sale.metodoPago === "Transferencia" ? "Transferencia" : "Efectivo",
                vendedorUid: user.uid,
                vendedorNombre: String(sale.vendedorNombre || user.email || "Vendedor").trim(),
                vendedorEmail: String(user.email || "").toLowerCase(),
                items,
                ...saleTotals(items, sale.descuento || 0),
                fechaIso: now.toISOString(),
                fechaTexto: dateTimeText(now),
                createdAt: serverTimestamp()
            };
            transaction.set(counterRef, { ultimoNumero: sequence, numero: payload.numero, notaId: saleRef.id, updatedAt: serverTimestamp() });
            transaction.set(saleRef, payload);
            products.forEach((product, index) => {
                if (product.stock !== "" && product.stock != null) {
                    transaction.update(refs[index], { stock: Number(product.stock) - items[index].cantidad, updatedAt: serverTimestamp() });
                }
            });
            return normalizeSale({ id: saleRef.id, ...payload });
        });
    } catch (error) {
        if (error.code === "permission-denied") {
            const denied = new Error(`Firebase rechazo ${phase}. Revisa las reglas publicadas en sxmy-bd y el perfil usuarios/${user.uid}. La orden sigue guardada.`, { cause: error });
            denied.code = error.code;
            throw denied;
        }
        throw error;
    }
}

function constraints({ start = null, end = null, seller = "", number = "" } = {}) {
    const filters = [];
    if (start) filters.push(where("createdAt", ">=", start));
    if (end) filters.push(where("createdAt", "<", end));
    if (seller) filters.push(where("vendedorUid", "==", seller));
    if (number) filters.push(where("numero", "==", formatSaleNumber(number)));
    filters.push(orderBy("createdAt", "desc"));
    return filters;
}

export async function getSalesPage({ cursor = null, pageSize = 25, ...filters } = {}) {
    const size = Math.max(1, Math.min(100, pageSize));
    const parts = constraints(filters);
    if (cursor) parts.push(startAfter(cursor));
    const snapshot = await getDocs(query(salesRef, ...parts, limit(size + 1)));
    const page = snapshot.docs.slice(0, size);
    return {
        sales: page.map((entry) => normalizeSale({ id: entry.id, ...entry.data() })),
        cursor: page.at(-1) || null,
        hasMore: snapshot.size > size
    };
}

export async function getSales(filters = {}) {
    const snapshot = Object.keys(filters).length
        ? await getDocs(query(salesRef, ...constraints(filters)))
        : await getDocs(salesRef);
    const sales = snapshot.docs.map((item) => normalizeSale({ id: item.id, ...item.data() }));
    sales.sort((a, b) => a.fechaOrden - b.fechaOrden).forEach((sale, index) => {
        sale.numeroVista = sale.numero || formatSaleNumber(index + 1);
    });
    return sales.sort((a, b) => b.fechaOrden - a.fechaOrden);
}

function normalizeSale(sale) {
    const createdAtMillis = sale.createdAt?.toMillis?.() || 0;
    const isoMillis = sale.fechaIso ? new Date(sale.fechaIso).getTime() : 0;
    return {
        id: sale.id,
        numero: normalizeSaleNumber(sale.numero),
        requestId: sale.requestId || sale.id,
        cliente: sale.cliente || "Cliente",
        direccion: sale.direccion || "",
        telefono: sale.telefono || "",
        metodoPago: sale.metodoPago || "Efectivo",
        vendedorUid: sale.vendedorUid || "",
        vendedorNombre: sale.vendedorNombre || sale.vendedorEmail || "Vendedor",
        vendedorEmail: sale.vendedorEmail || "",
        items: (Array.isArray(sale.items) ? sale.items : []).map((item) => ({
            productId: item.productId || "", codigo: item.codigo || "", nombre: item.nombre || "Producto",
            precio: Number(item.precio || 0), cantidad: Number(item.cantidad || 0), subtotal: Number(item.subtotal || 0)
        })),
        subtotal: Number(sale.subtotal ?? sale.total ?? 0),
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
