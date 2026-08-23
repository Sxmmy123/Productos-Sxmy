import { db } from "../firebase/firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const COLLECTION = "productos";
const productsRef = collection(db, COLLECTION);
const CLOUDINARY_CLOUD_NAME = "gz9r3pcp";
const CLOUDINARY_UPLOAD_PRESET = "sxmy_productos";
const CLOUDINARY_FOLDER = "productos";

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function slugify(value) {
    return String(value || "producto")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "producto";
}

export function formatCode(value) {
    const raw = String(value || "").trim().toUpperCase();
    if (!raw) return "";
    if (/^\d+$/.test(raw)) return raw.padStart(3, "0");
    return raw;
}

export async function getProducts() {
    const snapshot = await getDocs(productsRef);
    return snapshot.docs
        .map((item) => normalizeProduct({ id: item.id, ...item.data() }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo, "es", { numeric: true }));
}

export function nextProductCode(products) {
    const max = products.reduce((current, product) => {
        const match = String(product.codigo || "").match(/^\d+$/);
        return match ? Math.max(current, Number(product.codigo)) : current;
    }, 0);
    return String(max + 1).padStart(3, "0");
}

export async function saveProduct(product, id = "") {
    const payload = normalizeForSave(product);
    const cleanId = slugify(payload.codigo).slice(0, 80);

    if (id && id !== cleanId) {
        await deleteDoc(doc(db, COLLECTION, id));
    }

    await setDoc(doc(db, COLLECTION, cleanId), {
        ...payload,
        updatedAt: serverTimestamp(),
        createdAt: product.createdAt || serverTimestamp()
    }, { merge: true });

    return cleanId;
}

export async function updateProduct(id, data) {
    await updateDoc(doc(db, COLLECTION, id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteProduct(id) {
    await deleteDoc(doc(db, COLLECTION, id));
}

export async function uploadProductImage(file, codigo) {
    const cleanCode = slugify(formatCode(codigo)).slice(0, 60);
    const blob = await compressImage(file);
    const formData = new FormData();
    formData.append("file", blob, `${cleanCode}.webp`);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("folder", CLOUDINARY_FOLDER);
    formData.append("public_id", `${cleanCode}-${Date.now()}`);
    formData.append("tags", `producto,${cleanCode}`);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData
    });
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error?.message || "Cloudinary rechazo la imagen");
    }

    return optimizeCloudinaryUrl(data.secure_url);
}

function optimizeCloudinaryUrl(url) {
    if (!url || !url.includes("/upload/")) return url;
    return url.replace("/upload/", "/upload/f_auto,q_auto,c_pad,b_white,w_900,h_900/");
}

async function compressImage(file) {
    const bitmap = await createImageBitmap(file);
    const maxSize = 1200;
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("No se pudo comprimir la imagen"));
        }, "image/webp", 0.82);
    });
}

function normalizeProduct(product) {
    const createdAtMillis = product.createdAt?.toMillis?.() || 0;
    const updatedAtMillis = product.updatedAt?.toMillis?.() || 0;
    const historialPrecios = Array.isArray(product.historialPrecios) ? product.historialPrecios : [];
    return {
        id: product.id,
        codigo: formatCode(product.codigo || product.id || ""),
        nombre: product.nombre || "Producto sin nombre",
        precioCompra: Number(product.precioCompra) || 0,
        precioVenta: Number(product.precioVenta) || 0,
        precioAnterior: product.precioAnterior == null ? "" : Number(product.precioAnterior) || 0,
        historialPrecios,
        stock: product.stock === "" || product.stock == null ? "" : Number(product.stock) || 0,
        descripcion: product.descripcion || "",
        imagenUrl: product.imagenUrl || "",
        activo: product.activo !== false,
        createdAt: product.createdAt || "",
        updatedAt: product.updatedAt || "",
        createdAtMillis,
        updatedAtMillis
    };
}

function normalizeForSave(product) {
    return {
        codigo: formatCode(product.codigo),
        nombre: String(product.nombre || "").trim(),
        precioCompra: Number(product.precioCompra) || 0,
        precioVenta: Number(product.precioVenta) || 0,
        precioAnterior: product.precioAnterior === "" || product.precioAnterior == null ? "" : Number(product.precioAnterior) || 0,
        historialPrecios: Array.isArray(product.historialPrecios) ? product.historialPrecios : [],
        stock: product.stock === "" || product.stock == null ? "" : Number(product.stock) || 0,
        descripcion: String(product.descripcion || "").trim(),
        imagenUrl: String(product.imagenUrl || "").trim(),
        activo: product.activo !== false
    };
}
