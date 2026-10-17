import test from "node:test";
import assert from "node:assert/strict";
import { money, lowStock, saleDateRange, saleItemsFromProducts, saleTotals, summarizeSales, validateOrder } from "../app/shared/services/sales-domain.js";

test("money and discounts preserve cents and reject invalid totals", () => {
    assert.equal(money(0.1 + 0.2), 0.3);
    assert.deepEqual(saleTotals([{ subtotal: 0.1 }, { subtotal: 0.2 }], 0.1), { subtotal: 0.3, descuento: 0.1, total: 0.2 });
    assert.throws(() => saleTotals([{ subtotal: 10 }], -1));
    assert.throws(() => saleTotals([{ subtotal: 10 }], 11));
    assert.throws(() => saleTotals([{ subtotal: 10 }], Infinity));
});
test("orders reject duplicate items, invalid quantities and forged prices", () => {
    const item = { productId: "motor", cantidad: 2, precio: 20 };
    const order = { requestId: "order-000000000001", items: [item] };
    const items = validateOrder(order);
    assert.throws(() => validateOrder({ ...order, items: [item, item] }));
    assert.throws(() => validateOrder({ ...order, items: [{ ...item, cantidad: 1.5 }] }));
    assert.throws(() => saleItemsFromProducts(items, [{ nombre: "Motor", precioVenta: 21, stock: 5 }]));
    assert.throws(() => saleItemsFromProducts(items, [{ nombre: "Motor", precioVenta: 20, stock: 1 }]));
    assert.throws(() => saleItemsFromProducts(items, [{ nombre: "Motor", precioVenta: 20, stock: 5, activo: false }]));
    assert.equal(saleItemsFromProducts(items, [{ nombre: "Motor", precioVenta: 20, stock: "" }])[0].subtotal, 40);
});
test("stock alerts only apply to tracked products with a configured minimum", () => {
    assert.equal(lowStock({ stock: "", stockMinimo: 5 }), false);
    assert.equal(lowStock({ stock: 0, stockMinimo: "" }), false);
    assert.equal(lowStock({ stock: 3, stockMinimo: 3 }), true);
    assert.equal(lowStock({ stock: 0, stockMinimo: 3, activo: false }), false);
});
test("custom dates include the entire last day; week starts on Monday", () => {
    const range = saleDateRange("custom", "2026-10-01", "2026-10-02");
    assert.equal(range.start.getDate(), 1);
    assert.equal(range.end.getDate(), 3);
    assert.throws(() => saleDateRange("custom", "2026-10-04", "2026-10-02"));
    const week = saleDateRange("week", "", "", new Date(2026, 9, 2, 10));
    assert.equal(week.start.getDay(), 1);
});
test("analysis allocates discounts exactly, including cent remainders", () => {
    const summary = summarizeSales([{ total: 24.01, metodoPago: "Transferencia", fechaIso: "2026-10-02T12:00:00Z", items: [
        { productId: "a", nombre: "Motor", codigo: "001", cantidad: 1, subtotal: 10 },
        { productId: "b", nombre: "Rueda", codigo: "002", cantidad: 2, subtotal: 20 }
    ] }], [{ id: "a", codigo: "001", imagenUrl: "motor.png" }]);
    assert.equal(summary.income, 24.01);
    assert.equal(summary.transfer, 24.01);
    assert.equal(summary.cash, 0);
    assert.equal(summary.units, 3);
    assert.equal(money(summary.products.reduce((sum, item) => sum + item.total, 0)), 24.01);
    assert.equal(summary.products.find((item) => item.codigo === "001").imagenUrl, "motor.png");
    assert.equal(summary.days[0].total, 24.01);
});
