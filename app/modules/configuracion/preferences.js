import { defaultPreferences, normalizePreferences, patchPreferences } from "./preferences-domain.js";

let owner = "", settings = defaultPreferences(), dirty = false, revision = 0, timer;
let syncState = "local", localSaved = true;
let pendingSync = null;
const key = uid => `sxmy-settings:${uid}`;

export const getPreferences = () => normalizePreferences(settings);
export const preferencesOwner = () => owner;
export const preferencesStatus = () => ({ state: syncState, localSaved });

function emit(type = "sxmy:preferences-change") {
    document.dispatchEvent(new CustomEvent(type, { detail: { owner, settings: getPreferences(), ...preferencesStatus() } }));
}

function persist() {
    try { localStorage.setItem(key(owner), JSON.stringify({ settings, dirty })); localSaved = true; }
    catch { localSaved = false; }
}

export function initializePreferences(uid) {
    clearTimeout(timer);
    owner = uid;
    settings = defaultPreferences();
    dirty = false;
    revision++;
    syncState = "local";
    try {
        const saved = JSON.parse(localStorage.getItem(key(uid)) || "null");
        if (saved) { settings = normalizePreferences(saved.settings); dirty = saved.dirty === true; }
        else {
            const legacy = JSON.parse(sessionStorage.getItem(`sxmy-view:${uid}:productos`) || "{}");
            const fields = { adminSort: "sort", showActiveProducts: "showActive", showDisabledProducts: "showDisabled", onlyNoImage: "onlyNoImage", onlyLowStock: "onlyLowStock", showPriceHistory: "showPriceHistory" };
            const products = Object.fromEntries(Object.entries(fields).filter(([id]) => legacy[id] != null).map(([id, field]) => [field, legacy[id]]));
            // Global legacy appearance can only migrate to the first account on this device.
            const migrationKey = "sxmy-settings-migration-owner";
            const migrationOwner = localStorage.getItem(migrationKey);
            if (!migrationOwner) localStorage.setItem(migrationKey, uid);
            const general = { pushbuy: localStorage.getItem(`productos-sxmy-pushbuy:${uid}`) === "1" };
            if (!migrationOwner || migrationOwner === uid) {
                general.theme = localStorage.getItem("sxmy-theme") || "light";
                general.sidebarCollapsed = localStorage.getItem("sxmy-sidebar-collapsed") === "1";
                products.view = localStorage.getItem("sxmy-product-view") || "table";
            }
            settings = patchPreferences(settings, { products, general });
        }
    } catch { /* Ignore corrupt or unavailable storage. */ }
    persist();
    emit();
    void syncPreferences();
}

export function updatePreferences(patch) {
    if (!owner) return;
    const next = patchPreferences(settings, patch);
    if (JSON.stringify(next) === JSON.stringify(settings)) return;
    settings = next;
    dirty = true;
    revision++;
    syncState = "pending";
    persist();
    emit();
    clearTimeout(timer);
    timer = setTimeout(() => { void syncPreferences(); }, 450);
}

export async function syncPreferences() {
    if (!owner || pendingSync) return pendingSync;
    if (!navigator.onLine) { syncState = "offline"; emit("sxmy:preferences-status"); return; }
    const uid = owner, startRevision = revision;
    syncState = "syncing";
    emit("sxmy:preferences-status");
    pendingSync = (async () => {
        try {
            const storage = await import("./storage-service.js");
            if (!dirty) {
                const remote = await storage.readPreferences(uid);
                if (owner !== uid || revision !== startRevision) return;
                if (remote) { settings = normalizePreferences(remote); persist(); emit(); }
                else {
                    await storage.writePreferences(uid, getPreferences());
                    if (owner !== uid || revision !== startRevision) return;
                }
            } else {
                await storage.writePreferences(uid, getPreferences());
                if (owner !== uid || revision !== startRevision) return;
                dirty = false;
                persist();
            }
            syncState = "synced";
        } catch (error) {
            if (owner === uid) syncState = error.code === "permission-denied" ? "permissions" : "local";
        } finally {
            pendingSync = null;
            if (owner && owner !== uid) { void syncPreferences(); }
            if (owner === uid) {
                emit("sxmy:preferences-status");
                if (revision !== startRevision) { clearTimeout(timer); timer = setTimeout(() => { void syncPreferences(); }, 450); }
            }
        }
    })();
    return pendingSync;
}

window.addEventListener("online", () => { void syncPreferences(); });
window.addEventListener("storage", event => {
    if (!owner || event.key !== key(owner) || !event.newValue) return;
    try {
        const saved = JSON.parse(event.newValue);
        settings = normalizePreferences(saved.settings);
        dirty = saved.dirty === true;
        revision++;
        emit();
    } catch { /* Ignore partial data from another tab. */ }
});
