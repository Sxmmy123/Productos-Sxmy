const header = document.querySelector(".store-header");
const filters = document.querySelector(".store-filterbar");

function updateStoreSpacing() {
    if (!header?.offsetHeight || !filters?.offsetHeight) return;
    const style = document.documentElement.style;
    style.setProperty("--store-mobile-header-space", `${header.offsetHeight}px`);
    style.setProperty("--store-mobile-filter-space", `${filters.offsetHeight}px`);
}

// Measure the mobile bars before product images or remote data finish loading.
updateStoreSpacing();
const observer = new ResizeObserver(updateStoreSpacing);
if (header) observer.observe(header);
if (filters) observer.observe(filters);
window.addEventListener("pageshow", updateStoreSpacing);

document.addEventListener("sxmy:module-change", () => requestAnimationFrame(updateStoreSpacing));
