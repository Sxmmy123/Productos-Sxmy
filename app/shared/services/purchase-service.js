import { auth, db } from "../firebase/firebase-config.js";
import { collection, doc, getDocFromServer, getDocs, query, orderBy, limit, startAfter, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { MODEL, requestInterpretation, requestProductDetails } from "../../modules/compras/openai-client.js?v=6";
import { aliasKey, normalizePurchase, prepareRegistration, reconcileInterpretation, safeId } from "../../modules/compras/registration-domain.js?v=5";
import { prepareInventory, newProductValues, nextCode, duplicateProduct } from "../../modules/compras/inventory-domain.js?v=5";
import { buildPackageMemory } from "../../modules/compras/package-memory.js?v=1";

const keyRef = () => doc(db, "configuracion_privada", "openai");
let packageCache = null;
function online() {
    if (!navigator.onLine) throw Object.assign(new Error("Sin conexion. La lista sigue guardada en este dispositivo."), { code: "client/offline" });
}
function user() {
    if (!auth.currentUser) throw Object.assign(new Error("Inicia sesion para usar Compras."), { code: "unauthenticated" });
    return auth.currentUser;
}
async function staff(actor, transaction = null) {
    const ref = doc(db, "usuarios", actor.uid);
    const snapshot = await (transaction ? transaction.get(ref) : getDocFromServer(ref));
    const profile = snapshot.data();
    if (!profile || !["admin", "cajero"].includes(profile.rol) || profile.activo !== true) throw Object.assign(new Error("Necesitas un perfil activo de administrador o cajero."), { code: "permission-denied" });
    if (auth.currentUser?.uid !== actor.uid) throw Object.assign(new Error("La sesion cambio. Vuelve a abrir Compras."), { code: "unauthenticated" });
    return profile;
}
async function aiConfig() {
    online();
    const actor = user();
    await staff(actor);
    let config;
    try { config = (await getDocFromServer(keyRef())).data(); }
    catch (error) {
        if (error.code === "permission-denied") error.message = "No se puede leer configuracion_privada/openai. Publica las reglas nuevas de Firestore.";
        throw error;
    }
    return { actor, apiKey: config?.apiKey };
}
export async function generatePurchaseProduct(nombre) {
    const { actor, apiKey } = await aiConfig();
    const result = await requestProductDetails({ apiKey, nombre });
    if (auth.currentUser?.uid !== actor.uid) throw Object.assign(new Error("La sesion cambio. Vuelve a abrir Compras."), { code: "unauthenticated" });
    return result;
}
export async function interpretPurchaseList(texto, products) {
    const { actor, apiKey } = await aiConfig();
    const result = await requestInterpretation({ apiKey, texto, products });
    // Only confirmed, saved aliases can auto-resolve a name; interpreting never writes.
    const keys = [...new Set((Array.isArray(result?.filas) ? result.filas : []).map(row => aliasKey(row.nombre)).filter(Boolean))];
    if (keys.length > 200) throw Object.assign(new Error("La lista supera 200 productos."), { code: "invalid-argument" });
    const snapshots = await Promise.all(keys.map(id => getDocFromServer(doc(db, "compras_aliases", id))));
    if (auth.currentUser?.uid !== actor.uid) throw Object.assign(new Error("La sesion cambio. Vuelve a abrir Compras."), { code: "unauthenticated" });
    return { ...reconcileInterpretation(result, products, new Map(snapshots.filter(snapshot => snapshot.exists()).map(snapshot => [snapshot.id, snapshot.data()]))), modelo: MODEL };
}
export async function registerPurchase(input) {
    online();
    if (!Array.isArray(input?.items)) throw Object.assign(new Error("La compra no contiene productos."), { code: "invalid-argument" });
    const actor = user(), purchase = normalizePurchase({ ...input, items: input.items.map(row => ({ ...row, actualizar: false })) });
    const ref = doc(db, "compras", purchase.requestId);
    const result = await runTransaction(db, async transaction => {
        const profile = await staff(actor, transaction);
        const previous = await transaction.get(ref);
        if (previous.exists()) {
            const data = previous.data();
            if (data.registradoPorUid !== actor.uid) throw Object.assign(new Error("El identificador pertenece a otra compra."), { code: "permission-denied" });
            return { id: ref.id, total: data.total, actualizados: data.actualizados, repetida: true };
        }
        const products = new Map();
        for (const id of new Set(purchase.items.map(row => row.productId).filter(Boolean))) {
            const snapshot = await transaction.get(doc(db, "productos", id));
            if (snapshot.exists()) products.set(id, snapshot.data());
        }
        const prepared = prepareRegistration(purchase, products);
        for (const [id, alias] of prepared.aliases) transaction.set(doc(db, "compras_aliases", id), { ...alias, compraId: ref.id, updatedByUid: actor.uid, updatedAt: serverTimestamp() });
        transaction.set(ref, {
            requestId: purchase.requestId, proveedor: purchase.proveedor, fecha: purchase.fecha,
            textoOriginal: purchase.textoOriginal, items: prepared.items, total: purchase.total,
            actualizados: 0, estado: "comprado", registradoPorUid: actor.uid,
            registradoPorNombre: profile.nombre || "Usuario", createdAt: serverTimestamp()
        });
        return { id: ref.id, total: purchase.total, actualizados: 0, repetida: false };
    });
    packageCache = null;
    return result;
}
export async function getPurchasePackageMemory(force = false) {
    online();
    const actor = user(); await staff(actor);
    if (!force && packageCache?.uid === actor.uid) {
        if (packageCache.pending) return packageCache.pending;
        if (Date.now() - packageCache.loadedAt < 30000) return packageCache.data;
    }
    const cache = { uid: actor.uid, data: [], loadedAt: 0, pending: null }; packageCache = cache;
    cache.pending = (async () => {
        const purchases = []; let cursor = null;
        for (;;) {
            const page = await getDocs(query(collection(db, "compras"), orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(100)));
            if (auth.currentUser?.uid !== actor.uid) throw Object.assign(new Error("La sesion cambio. Vuelve a abrir Compras."), { code: "unauthenticated" });
            purchases.push(...page.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id })));
            if (page.docs.length < 100) break;
            const next = page.docs.at(-1);
            if (next.id === cursor?.id) throw Object.assign(new Error("No se pudo completar la lectura del historial de empaques."), { code: "unavailable" });
            cursor = next;
        }
        cache.data = buildPackageMemory(purchases); cache.loadedAt = Date.now();
        return cache.data;
    })();
    try { return await cache.pending; }
    finally { cache.pending = null; }
}
export async function applyPurchaseInventory(input) {
    online();
    const actor = user();
    if (!safeId(input?.requestId) || !Array.isArray(input.items) || !input.items.length || input.items.length > 200 || input.items.some(row => !safeId(row?.productId))) throw Object.assign(new Error("Seleccion no valida."), { code: "invalid-argument" });
    const ref = doc(db, "compras_operaciones", input.requestId);
    return runTransaction(db, async transaction => {
        await staff(actor, transaction);
        const previous = await transaction.get(ref);
        if (previous.exists()) {
            const saved = previous.data();
            if (saved.registradoPorUid !== actor.uid || saved.tipo !== "precios") throw Object.assign(new Error("El identificador pertenece a otra operacion."), { code: "permission-denied" });
            return { id: ref.id, actualizados: saved.actualizados, repetida: true };
        }
        const products = new Map();
        for (const id of new Set(input.items.map(row => row.productId))) {
            const snapshot = await transaction.get(doc(db, "productos", id));
            if (snapshot.exists()) products.set(id, snapshot.data());
        }
        const changes = prepareInventory(input, products);
        for (const change of changes) transaction.update(doc(db, "productos", change.productId), { ...change.patch, updatedAt: serverTimestamp() });
        transaction.set(ref, { requestId: input.requestId, tipo: "precios", productIds: changes.map(change => change.productId), actualizados: changes.length, registradoPorUid: actor.uid, createdAt: serverTimestamp() });
        return { id: ref.id, actualizados: changes.length, repetida: false };
    });
}
export async function createPurchaseProduct(input) {
    online();
    const actor = user(), values = newProductValues(input);
    const catalog = (await getDocs(collection(db, "productos"))).docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
    const ref = doc(db, "compras_operaciones", input.requestId);
    return runTransaction(db, async transaction => {
        await staff(actor, transaction);
        const previous = await transaction.get(ref);
        if (previous.exists()) {
            const saved = previous.data();
            if (saved.registradoPorUid !== actor.uid || saved.tipo !== "producto") throw Object.assign(new Error("El identificador pertenece a otra operacion."), { code: "permission-denied" });
            return { id: saved.productIds[0], codigo: saved.codigo, repetida: true };
        }
        if (duplicateProduct(values.nombre, catalog)) throw Object.assign(new Error("Ya existe un producto con ese nombre. Vinculalo desde la tabla."), { code: "failed-precondition" });
        let number = nextCode(catalog), productRef;
        for (let attempt = 0; attempt < 50; attempt++, number++) {
            productRef = doc(db, "productos", String(number).padStart(3, "0"));
            if (!(await transaction.get(productRef)).exists()) break;
            productRef = null;
        }
        if (!productRef) throw Object.assign(new Error("Actualiza el inventario e intenta otra vez."), { code: "aborted" });
        const codigo = String(number).padStart(3, "0");
        transaction.set(productRef, { ...values, codigo, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        transaction.set(ref, { requestId: input.requestId, tipo: "producto", codigo, productIds: [productRef.id], actualizados: 1, registradoPorUid: actor.uid, createdAt: serverTimestamp() });
        return { id: productRef.id, codigo, repetida: false };
    });
}
export async function getPurchasesPage(cursor = null) {
    const filters = [orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(21)];
    const snapshot = await getDocs(query(collection(db, "compras"), ...filters));
    const docs = snapshot.docs.slice(0, 20);
    return { purchases: docs.map(doc => ({ id: doc.id, ...doc.data() })), cursor: docs.at(-1) || null, hasMore: snapshot.docs.length > 20 };
}
