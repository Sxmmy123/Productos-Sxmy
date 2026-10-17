const SALE_DRAFT_PREFIX = "productos-sxmy-sale-draft:";

function key(prefix, userId) {
    return userId ? `${prefix}${userId}` : "";
}

export function loadSaleDraft(userId) {
    const storageKey = key(SALE_DRAFT_PREFIX, userId);
    if (!storageKey) return null;
    try {
        const draft = JSON.parse(localStorage.getItem(storageKey) || "null");
        return draft && Array.isArray(draft.items) ? draft : null;
    } catch (error) {
        console.warn("La orden pendiente no se pudo recuperar.", error);
        clearSaleDraft(userId);
        return null;
    }
}

export function saveSaleDraft(userId, draft) {
    const storageKey = key(SALE_DRAFT_PREFIX, userId);
    if (!storageKey) return false;
    try {
        localStorage.setItem(storageKey, JSON.stringify(draft));
        return true;
    } catch (error) {
        console.warn("No se pudo guardar la orden pendiente.", error);
        return false;
    }
}

export function clearSaleDraft(userId) {
    const storageKey = key(SALE_DRAFT_PREFIX, userId);
    if (!storageKey) return;
    try {
        localStorage.removeItem(storageKey);
    } catch (error) {
        console.warn("No se pudo limpiar la orden pendiente.", error);
    }
}
