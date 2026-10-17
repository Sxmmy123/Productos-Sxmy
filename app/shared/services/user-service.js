import { app, firebaseConfig, db } from "../firebase/firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
    createUserWithEmailAndPassword,
    getAuth,
    signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-functions.js";

const USERS_COLLECTION = "usuarios";
const usersRef = collection(db, USERS_COLLECTION);
let creatorAuth;

export async function createCashier({ nombre, email, password }) {
    creatorAuth ||= getAuth(initializeApp(firebaseConfig, "cajeroCreator"));
    const credential = await createUserWithEmailAndPassword(creatorAuth, email, password);
    const uid = credential.user.uid;
    const profile = {
        uid,
        nombre: String(nombre || "Cajero").trim() || "Cajero",
        email: String(email || "").trim().toLowerCase(),
        rol: "cajero",
        activo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, USERS_COLLECTION, uid), profile);
    await signOut(creatorAuth);
    return profile;
}

export async function getUsers() {
    const snapshot = await getDocs(usersRef);
    return snapshot.docs
        .map((item) => normalizeUser({ uid: item.id, ...item.data() }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function getUserProfile(uid) {
    if (!uid) return null;
    const snapshot = await getDoc(doc(db, USERS_COLLECTION, uid));
    if (!snapshot.exists()) return null;
    return normalizeUser({ uid: snapshot.id, ...snapshot.data() });
}

export async function updateUserStatus(uid, activo) {
    await updateDoc(doc(db, USERS_COLLECTION, uid), {
        activo,
        updatedAt: serverTimestamp()
    });
}

export async function updateCashierProfile(uid, { nombre, email, expectedEmail }) {
    const cleanName = String(nombre || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanName || !cleanEmail) throw new Error("Nombre y correo son obligatorios.");
    if (cleanEmail === expectedEmail) {
        await updateDoc(doc(db, USERS_COLLECTION, uid), { nombre: cleanName, updatedAt: serverTimestamp() });
        return;
    }
    const update = httpsCallable(getFunctions(app, "us-central1"), "updateCashier");
    try { await update({ uid, nombre: cleanName, email: cleanEmail, expectedEmail }); }
    catch (error) {
        if (["functions/not-found", "functions/unavailable", "functions/internal"].includes(error.code)) {
            throw new Error("No se pudo actualizar el correo. Comprueba que updateCashier esta desplegada en Firebase.");
        }
        throw error;
    }
}

function normalizeUser(user) {
    return {
        uid: user.uid || "",
        nombre: user.nombre || "Cajero",
        email: user.email || "",
        rol: user.rol || "cajero",
        activo: user.activo !== false
    };
}
