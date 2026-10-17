const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

exports.updateCashier = onCall({ region: "us-central1", timeoutSeconds: 60 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Inicia sesion.");
    const db = getFirestore(), auth = getAuth();
    const actor = await db.doc(`usuarios/${request.auth.uid}`).get();
    if (actor.data()?.rol !== "admin" || actor.data()?.activo === false) throw new HttpsError("permission-denied", "Solo el administrador puede editar cajeros.");
    const { uid, nombre, email, expectedEmail } = request.data || {};
    if (typeof uid !== "string" || !uid || uid.includes("/") || typeof nombre !== "string" || !nombre.trim() || nombre.length > 100 || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new HttpsError("invalid-argument", "Revisa nombre y correo.");
    }
    const ref = db.doc(`usuarios/${uid}`);
    const cleanEmail = email.trim().toLowerCase();
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const profile = snapshot.data();
        if (profile?.rol !== "cajero") throw new HttpsError("failed-precondition", "La cuenta no es de un cajero.");
        if (expectedEmail !== profile.email) throw new HttpsError("aborted", "El cajero cambio. Actualiza la lista.");
        if (profile.editingUntil > Date.now()) throw new HttpsError("aborted", "Este cajero se esta actualizando. Intenta nuevamente.");
        transaction.update(ref, { editingUntil: Date.now() + 120000 });
    });
    let original, changed = false;
    try {
        original = await auth.getUser(uid);
        await auth.updateUser(uid, { displayName: nombre.trim(), email: cleanEmail, ...(cleanEmail !== original.email ? { emailVerified: false } : {}) });
        changed = true;
        await ref.update({ nombre: nombre.trim(), email: cleanEmail, updatedAt: FieldValue.serverTimestamp(), editingUntil: FieldValue.delete() });
        return { uid, nombre: nombre.trim(), email: cleanEmail };
    } catch (error) {
        if (changed) {
            try { await auth.updateUser(uid, { displayName: original.displayName || "", email: original.email, emailVerified: original.emailVerified }); }
            catch { throw new HttpsError("internal", "La cuenta necesita revision: no se pudo sincronizar el correo."); }
        }
        if (error instanceof HttpsError) throw error;
        if (error.code === "auth/email-already-exists") throw new HttpsError("already-exists", "Ese correo ya pertenece a otra cuenta.");
        throw new HttpsError("internal", "No se pudo actualizar el cajero. Intenta nuevamente.");
    } finally {
        await ref.update({ editingUntil: FieldValue.delete() }).catch(() => {});
    }
});
