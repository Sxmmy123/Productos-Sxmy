import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rowAmounts, purchaseSummary, attachInventory, suggestedSalePrice, buildPurchase, normalizeName, inventoryUnitPrice, buildInventoryUpdate, comparisonState, suggestNewSalePrice, candidateProducts, setUnitPrice } from "../app/modules/compras/domain.js";
import { prepareInventory, newProductValues } from "../app/modules/compras/inventory-domain.js";
import * as server from "../app/modules/compras/registration-domain.js";

const product = { id: "motor", nombre: "Motorreductor", codigo: "010", precioCompra: 9.5, precioVenta: 20, stock: 8 };
const row = { id: "row", nombre: "Motorreductor", nombreOriginal: "motor-reductor", cantidad: 6, importe: 60, tipoPrecio: "total", unidad: "unid.", productId: "motor", confirmado: true, incluir: true, actualizar: false };
const payload = rows => buildPurchase({ rows: attachInventory(rows, [product]), requestId: "purchase-test", proveedor: "Proveedor", fecha: "2026-10-14", textoOriginal: "Lista original" });
const updatePayload = rows => ({ ...buildInventoryUpdate({ rows: attachInventory(rows.map(row => ({ ...row, updateChoice: true })), [product]), requestId: "price-test" }), proveedor: "", fecha: "2026-10-15", textoOriginal: "" });

test("line totals produce unit costs without multiplying the written amount twice", () => {
    assert.deepEqual(rowAmounts({ ...row, cantidad: 6, importe: 270 }), { unitario: 45, total: 270 });
    assert.deepEqual(rowAmounts({ ...row, cantidad: 25, importe: 450 }), { unitario: 18, total: 450 });
    assert.deepEqual(rowAmounts({ ...row, cantidad: 6, importe: 10, tipoPrecio: "unitario" }), { unitario: 10, total: 60 });
});
test("partial totals and ambiguous shared quantities never pretend to be final", () => {
    const summary = purchaseSummary([row, { ...row, id: "wood", cantidad: null }, { ...row, id: "plastic", incluir: false }]);
    assert.equal(summary.count, 2); assert.equal(summary.incomplete, 1); assert.equal(summary.total, 60);
    assert.throws(() => payload([row, { ...row, cantidad: null }]), /Completa/);
});
test("all inventory mutations are opt-in and only included rows are registered", () => {
    const input = payload([row, { ...row, id: "other", incluir: false, actualizar: true }]);
    assert.equal(input.items.length, 1); assert.equal(input.items[0].actualizar, false);
    const prepared = server.prepareRegistration(server.normalizePurchase(input), new Map([["motor", product]]));
    assert.equal(prepared.changes.length, 0); assert.equal(prepared.items[0].precioCompra, 10);
});
test("inventory refresh clears stale selections without silently approving new prices", () => {
    const previous = { ...attachInventory([row], [product])[0], actualizar: true, precioVenta: 22 };
    const refreshed = attachInventory([previous], [{ ...product, precioCompra: 11 }])[0];
    assert.equal(refreshed.actualizar, false); assert.equal(refreshed.precioCambio, true); assert.equal(refreshed.precioVenta, 20);
    assert.equal(attachInventory([previous], [product])[0].precioVenta, 22);
});
test("sale price can preserve the old value or explicitly keep the markup ratio", () => {
    const attached = attachInventory([row], [product])[0];
    assert.equal(attached.precioVenta, 20); assert.equal(suggestedSalePrice(attached), 21.05);
    assert.equal(suggestedSalePrice({ ...attached, expectedCompra: 0 }), null);
});
test("probable matches and duplicate update sources require an explicit decision", () => {
    assert.equal(payload([{ ...row, confirmado: false }]).items[0].productId, "");
    assert.throws(() => updatePayload([{ ...row, confirmado: false }]), /Selecciona/);
    assert.throws(() => updatePayload([row, row]), /sola fila/);
});
test("registration recomputes totals, ignores forged aggregates and preserves batch-rounding cents", () => {
    const input = server.normalizePurchase({ ...payload([{ ...row, cantidad: 3, importe: 28 }]), total: .01 });
    assert.equal(input.total, 28); assert.equal(input.items[0].precioCompra, 9.33);
});
test("registration updates only selected prices, keeps stock and uses the existing price-history contract", () => {
    const input = server.normalizePurchase(updatePayload([{ ...row, actualizar: true, cambiarVenta: true, precioVenta: 22 }]));
    const result = server.prepareRegistration(input, new Map([["motor", product]]));
    assert.equal(result.changes[0].patch.precioCompra, 10);
    assert.equal(result.changes[0].patch.precioVenta, 22);
    assert.equal(result.changes[0].patch.precioAnterior, 20);
    assert.deepEqual(Object.keys(result.changes[0].patch.historialPrecios[0]).sort(), ["anterior", "fechaIso", "fechaTexto", "nuevo"]);
    assert.equal("stock" in result.changes[0].patch, false);
    assert.equal(result.items[0].nombre, "Motorreductor");
});
test("registration rejects stale prices, missing products, invalid cents and unsafe IDs", () => {
    const input = server.normalizePurchase(updatePayload([{ ...row, actualizar: true }]));
    assert.throws(() => server.prepareRegistration(input, new Map([["motor", { ...product, precioCompra: 11 }]])), { code: "aborted" });
    assert.throws(() => server.prepareRegistration(input, new Map()), { code: "failed-precondition" });
    assert.throws(() => server.normalizePurchase({ ...payload([row]), requestId: "../admin" }), { code: "invalid-argument" });
    const forged = payload([row]); forged.items[0].importe = 1.001;
    assert.throws(() => server.normalizePurchase(forged), { code: "invalid-argument" });
    assert.throws(() => server.normalizePurchase({ ...payload([row]), fecha: "2026-02-30" }), { code: "invalid-argument" });
});
test("unambiguous normalized names match; typos and model suggestions remain unconfirmed", () => {
    const input = { filas: [{ nombre: "motor-reductor", cantidad: 6, unidad: "unid.", importe: 60, tipoPrecio: "total", productId: "invented" }, { nombre: "motoreductor", cantidad: 6, importe: 60, tipoPrecio: "total", productId: "motor" }] };
    const result = server.reconcileInterpretation(input, [product]);
    assert.equal(result.filas[0].productId, "motor"); assert.equal(result.filas[0].confirmado, true);
    assert.equal(result.filas[1].productId, "motor"); assert.equal(result.filas[1].confirmado, true);
    assert.equal(normalizeName("Motor-reductor"), normalizeName("Motorreductor"));
});
test("confirmed aliases are reused, but vanished IDs and duplicate canonical names are not trusted", () => {
    const raw = { filas: [{ nombre: "motoreductor", cantidad: 1, importe: 10, tipoPrecio: "total", productId: "fake" }] };
    const aliases = new Map([[server.aliasKey("motoreductor"), { productId: "motor" }]]);
    assert.equal(server.reconcileInterpretation(raw, [product], aliases).filas[0].confirmado, true);
    assert.equal(server.reconcileInterpretation(raw, [], aliases).filas[0].productId, "");
    const duplicate = { filas: [{ ...raw.filas[0], nombre: "motorreductor", productId: null }] };
    assert.equal(server.reconcileInterpretation(duplicate, [product, { ...product, id: "motor2" }]).filas[0].confirmado, false);
});
test("a generic source used for two variants never poisons remembered aliases", () => {
    const input = server.normalizePurchase(payload([row, { ...row, productId: "other", nombreOriginal: row.nombreOriginal }]));
    const result = server.prepareRegistration(input, new Map([["motor", product], ["other", { ...product, nombre: "Motor diferente" }]]));
    assert.equal(result.aliases.length, 0);
});
test("a bag stays one bag, not an invented number of inventory units", () => {
    const result = server.reconcileInterpretation({ filas: [{ nombre: "Bolsa de portapilas", cantidad: 1, unidad: "bolsa", importe: 250, tipoPrecio: "total" }] }, []);
    assert.equal(result.filas[0].cantidad, 1); assert.equal(result.filas[0].unidad, "bolsa");
});
test("unknown package size cannot overwrite a per-piece inventory cost", () => {
    const bag = { ...row, cantidad: 1, importe: 250, unidad: "bolsa" };
    assert.equal(rowAmounts(bag).unitario, 250);
    assert.equal(inventoryUnitPrice(bag), null);
    assert.throws(() => updatePayload([{ ...bag, actualizar: true }]), /Selecciona/);
    const forged = payload([bag]); forged.items[0].actualizar = true;
    assert.throws(() => server.normalizePurchase(forged), /paquete/);
});
test("explicit package size converts only the inventory cost, preserving paid totals and purchase units", () => {
    const bag = { ...row, cantidad: 1, importe: 250, unidad: "bolsa", unidadesPorPaquete: 25, actualizar: true };
    assert.equal(inventoryUnitPrice(bag), 10);
    const input = server.normalizePurchase(updatePayload([bag]));
    const result = server.prepareRegistration(input, new Map([["motor", product]]));
    assert.equal(result.changes[0].patch.precioCompra, 10);
    assert.equal(result.items[0].precioCompra, 250);
    assert.equal(result.items[0].precioCompraInventario, 10);
    assert.equal(result.items[0].total, 250);
    assert.equal(result.items[0].unidad, "bolsa");
});

test("30 units at 240 Bs is unchanged at 8 Bs; rises are green-state defaults and falls are opt-in", () => {
    const base = { ...row, cantidad: 30, importe: 240 };
    const same = attachInventory([base], [{ ...product, precioCompra: 8 }])[0];
    assert.equal(comparisonState(same).kind, "same"); assert.equal(same.actualizar, false);
    const up = attachInventory([{ ...base, importe: 300 }], [{ ...product, precioCompra: 8 }])[0];
    assert.equal(comparisonState(up).kind, "up"); assert.equal(comparisonState(up).delta, 2); assert.equal(up.actualizar, true);
    const down = attachInventory([{ ...base, importe: 300 }], [{ ...product, precioCompra: 14 }])[0];
    assert.equal(comparisonState(down).kind, "down"); assert.equal(comparisonState(down).delta, -4); assert.equal(down.actualizar, false);
    assert.equal(attachInventory([{ ...up, updateChoice: false }], [{ ...product, precioCompra: 8 }])[0].actualizar, false);
    assert.equal(payload([up]).items[0].actualizar, false, "Archiving never inherits the inventory selection");
});

test("new names are separate from uncertain matches and sale suggestions stay editable", () => {
    assert.equal(comparisonState({ ...row, productId: "" }).kind, "new");
    assert.equal(comparisonState({ ...row, confirmado: false }).kind, "match");
    assert.equal(suggestNewSalePrice(10, [{ precioCompra: 8, precioVenta: 12 }]), 15);
    assert.equal(suggestNewSalePrice(10, []), 13);
});
test("client and server agree on half-cent division, including 0.29 split across two pieces", () => {
    for (const importe of [.29, .57, 1.01, 4.99]) {
        const inputRow = { ...row, importe, cantidad: 2 };
        const normalized = server.normalizePurchase(payload([inputRow]));
        assert.equal(inventoryUnitPrice(inputRow), normalized.items[0].precioCompraInventario);
    }
    assert.equal(inventoryUnitPrice({ ...row, importe: .29, cantidad: 2 }), .15);
});

test("unit-only editing preserves the original total until the unit price is deliberately changed", () => {
    const input = { ...row, cantidad: 3, importe: 28 };
    assert.equal(inventoryUnitPrice(input), 9.33); assert.equal(rowAmounts(input).total, 28);
    setUnitPrice(input, "10"); assert.equal(inventoryUnitPrice(input), 10); assert.equal(rowAmounts(input).total, 30);
    const bag = { ...row, cantidad: 2, unidad: "bolsas", unidadesPorPaquete: 50, importe: 100 };
    setUnitPrice(bag, "1.25"); assert.equal(inventoryUnitPrice(bag), 1.25); assert.equal(rowAmounts(bag).total, 125);
    setUnitPrice(input, "1.001"); assert.equal(rowAmounts(input), null, "Invalid decimals cannot silently retain a previous unit price");
});

test("small purchase changes never change sales without the explicit sale switch", () => {
    const base = { ...row, importe: 57.06, precioVenta: 99, updateChoice: true };
    for (const cambiarVenta of [false, undefined, true]) {
        const input = buildInventoryUpdate({ rows: attachInventory([{ ...base, cambiarVenta }], [product]), requestId: "toggle-test" });
        assert.equal(input.items[0].precioVenta, cambiarVenta === true ? 99 : 20);
        const changes = prepareInventory(input, new Map([["motor", product]]));
        assert.equal(changes[0].patch.precioCompra, 9.51);
        assert.equal(changes[0].patch.precioVenta, cambiarVenta === true ? 99 : 20);
        assert.equal("historialPrecios" in changes[0].patch, cambiarVenta === true);
    }
    const forged = updatePayload([{ ...base, cambiarVenta: false }]); forged.items[0].precioVenta = 500;
    assert.equal(prepareInventory(forged, new Map([["motor", product]]))[0].patch.precioVenta, 20);
});

test("generic names expose inventory variants without falsely selecting one, including plurals and motor spelling", () => {
    const catalog = ["Interruptor doble pulsador", "INTERRUPTOR DE 6 PINES 6A 125VAC ON-OFF-ON", "Interruptor mediano", "Sensor", "Motorreductor"].map((nombre, i) => ({ id: "p" + i, codigo: String(i), nombre }));
    assert.deepEqual(candidateProducts({ nombre: "Interruptores" }, catalog).map(p => p.id), ["p0", "p1", "p2"]);
    assert.deepEqual(candidateProducts({ nombre: "motor-reductor" }, catalog).map(p => p.id), ["p4"]);
    const uncertain = server.reconcileInterpretation({ filas: [{ nombre: "Interruptor", cantidad: 30, importe: 240, tipoPrecio: "revisar", productId: "p0", candidatos: ["p0", "p1", "p2"] }] }, catalog).filas[0];
    assert.equal(uncertain.confirmado, false); assert.equal(uncertain.nombre, "Interruptor"); assert.equal(uncertain.tipoPrecio, "total");
    assert.equal(attachInventory([uncertain], catalog)[0].nombre, "Interruptor");
});

test("new product stores the editable AI description, never an image or automatically chosen sale", () => {
    const data = { requestId: "new-desc", nombre: "Sensor", descripcion: "Sensor para proyectos electronicos.", row, precioVenta: 15 };
    assert.equal(newProductValues(data).descripcion, data.descripcion);
    assert.equal(newProductValues(data).imagenUrl, "");
    assert.throws(() => newProductValues({ ...data, precioVenta: "" }), /venta/);
    assert.throws(() => newProductValues({ ...data, descripcion: "x".repeat(1001) }), /descripcion/);
});

test("the complete variant order preserves 12 separate rows, inherited quantities, unit costs and its 2640 Bs total", () => {
    const example = JSON.parse(readFileSync(new URL("./fixtures/purchase-variants.json", import.meta.url), "utf8"));
    const result = server.reconcileInterpretation({ filas: example.filas.map(row => ({ ...row, tipoPrecio: "total" })) }, []);
    assert.equal(result.filas.length, 12);
    result.filas.forEach((row, index) => {
        const expected = example.filas[index];
        assert.equal(row.nombre, expected.nombre); assert.equal(row.cantidad, expected.cantidad);
        assert.equal(rowAmounts(row).unitario, expected.unitario); assert.equal(rowAmounts(row).total, expected.importe);
    });
    const purchase = buildPurchase({ rows: result.filas, requestId: "variant-order", proveedor: "", fecha: "2026-10-15", textoOriginal: example.texto });
    const prepared = server.prepareRegistration(server.normalizePurchase(purchase), new Map());
    assert.equal(purchaseSummary(result.filas).incomplete, 0);
    assert.equal(server.normalizePurchase(purchase).total, 2640);
    assert.equal(prepared.items.length, 12); assert.equal(prepared.changes.length, 0);
    assert.equal(inventoryUnitPrice(result.filas.at(-1)), null, "Two battery cells are not two pieces per bag");
});
