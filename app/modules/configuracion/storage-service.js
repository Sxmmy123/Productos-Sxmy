import { db } from "../../shared/firebase/firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

export async function readPreferences(uid) {
    const snapshot = await getDoc(doc(db, "usuarios", uid, "preferencias", "interfaz"));
    return snapshot.exists() ? snapshot.data().settings : null;
}

export async function writePreferences(uid, settings) {
    await setDoc(doc(db, "usuarios", uid, "preferencias", "interfaz"), { version: 1, settings, updatedAt: serverTimestamp() });
}
