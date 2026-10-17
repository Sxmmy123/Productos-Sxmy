import * as products from "../shared/services/product-service.js";
import * as sales from "../shared/services/sales-service.js";

export { escapeHtml, formatCode, nextProductCode, uploadProductImage } from "../shared/services/product-service.js";
export { dateTimeText, formatMoney, formatSaleNumber } from "../shared/services/sales-service.js";
export { getSalesPage } from "../shared/services/sales-service.js";

const cache = new Map();
const revisions = new Map();
const MAX_AGE = 30_000;

// Share pending reads between staff modules; never persist private sales in this cache.
async function read(key, loader) {
    let entry = cache.get(key);
    if (!entry || (entry.loadedAt && Date.now() - entry.loadedAt >= MAX_AGE)) {
        entry = { loadedAt: 0 };
        entry.promise = loader().then((data) => {
            entry.loadedAt = Date.now();
            return data;
        }).catch((error) => {
            if (cache.get(key) === entry) cache.delete(key);
            throw error;
        });
        cache.set(key, entry);
    }
    const data = await entry.promise;
    return cache.get(key) !== entry ? read(key, loader) : data;
}

function invalidate(key) {
    cache.delete(key);
    revisions.set(key, (revisions.get(key) || 0) + 1);
}

export const invalidateProducts = () => invalidate("products");

export function dataVersion(keys) {
    return keys.map((key) => revisions.get(key) || 0).join(":");
}

export function dataExpired(keys) {
    return keys.some((key) => !cache.has(key) || Date.now() - cache.get(key).loadedAt >= MAX_AGE);
}

export const getProducts = () => read("products", products.getProducts);
export const getSales = (filters = {}) => Object.keys(filters).length ? sales.getSales(filters) : read("sales", sales.getSales);

export async function saveProduct(...args) {
    const result = await products.saveProduct(...args);
    invalidate("products");
    return result;
}

export async function updateProduct(...args) {
    const result = await products.updateProduct(...args);
    invalidate("products");
    return result;
}

export async function deleteProduct(...args) {
    const result = await products.deleteProduct(...args);
    invalidate("products");
    return result;
}

export async function saveSale(...args) {
    const result = await sales.saveSale(...args);
    invalidate("sales");
    invalidate("products");
    return result;
}
