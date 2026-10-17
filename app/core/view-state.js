export function rememberControls(owner, page, ids) {
    const key = `sxmy-view:${owner}:${page}`;
    const controls = ids.map((id) => document.getElementById(id)).filter(Boolean);
    let saved = {};
    try { saved = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { /* Use the default filters. */ }
    for (const control of controls) {
        const value = saved?.[control.id];
        if (control.type === "checkbox" && typeof value === "boolean") control.checked = value;
        else if (typeof value === "string") {
            if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === value)) control.value = value;
        }
    }
    function save() {
        const state = Object.fromEntries(controls.map((control) => [control.id, control.type === "checkbox" ? control.checked : control.value]));
        try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* Filters remain usable without storage. */ }
    }
    controls.forEach((control) => {
        control.addEventListener("input", save);
        control.addEventListener("change", save);
    });
    return save;
}
