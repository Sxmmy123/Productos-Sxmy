import test from "node:test";
import assert from "node:assert/strict";
import { buildPackageMemory, rememberPackages, packageCandidates, choosePackage } from "../app/modules/compras/package-memory.js";
import { inventoryUnitPrice, rowAmounts } from "../app/modules/compras/domain.js";

const item = { nombre: "Portapilas AA para 2 celdas", nombreOriginal: "Bolsa de porta pilas AA", unidad: "bolsa", unidadesPorPaquete: 50, productId: "porta-aa" };
const order = (id, values = {}) => ({ id, estado: "comprado", fecha: "2026-10-15", items: [{ ...item, ...values }] });
const row = { nombre: "Bolsa de pila AA", cantidad: 1, unidad: "bolsa", importe: 120, tipoPrecio: "total", unidadesPorPaquete: null };

test("a recorded bag of 50 completes a later pila AA bag at 120 Bs with a 2.40 unit cost", () => {
    const memory = buildPackageMemory([order("old")]);
    const result = rememberPackages([row], memory)[0];
    assert.equal(result.unidadesPorPaquete, 50); assert.equal(result.empaqueRecordado.compraId, "old");
    assert.equal(inventoryUnitPrice(result), 2.4); assert.equal(rowAmounts(result).total, 120);
    assert.equal(rememberPackages([result], memory)[0].unidadesPorPaquete, 50);
});

test("explicit package sizes and manual corrections always win; disabling history clears only remembered values", () => {
    const memory = buildPackageMemory([order("old")]);
    assert.equal(rememberPackages([{ ...row, unidadesPorPaquete: 100 }], memory)[0].unidadesPorPaquete, 100);
    const inferred = rememberPackages([row], memory)[0];
    assert.equal(rememberPackages([inferred], memory, false)[0].unidadesPorPaquete, null);
    assert.equal(rememberPackages([{ ...inferred, unidadesPorPaquete: 75 }], memory, false)[0].unidadesPorPaquete, 75);
    assert.equal(rememberPackages([{ ...row, omitirMemoriaEmpaque: true }], memory)[0].unidadesPorPaquete, null);
});

test("AA, AAA, 18650, boxes, loose units and unrelated products never share a bag size", () => {
    const memory = buildPackageMemory([order("old")]);
    for (const other of [{ nombre: "Bolsa de pila AAA" }, { nombre: "Bolsa de pila 18650" }, { nombre: "Bolsa de conectores" }, { unidad: "caja" }, { unidad: "unidad" }, { confirmado: true, productId: "otro" }, { nombre: "" }]) {
        assert.equal(rememberPackages([{ ...row, ...other }], memory)[0].unidadesPorPaquete, null);
    }
});

test("different recorded sizes offer choices, not an arbitrary automatic assumption", () => {
    const memory = buildPackageMemory([order("new", { unidadesPorPaquete: 100 }), order("old")]);
    assert.equal(rememberPackages([row], memory)[0].unidadesPorPaquete, null);
    assert.deepEqual(packageCandidates(row, memory).map(entry => entry.unidades), [100, 50]);
    const chosen = choosePackage(row, packageCandidates(row, memory)[1]);
    assert.equal(rememberPackages([chosen], memory)[0].unidadesPorPaquete, 50);
    assert.equal(rememberPackages([chosen], memory, false)[0].unidadesPorPaquete, null);
});

test("similar names with different cell counts stay ambiguous until the product is confirmed", () => {
    const memory = buildPackageMemory([order("two"), order("four", { nombre: "Portapilas AA para 4 celdas", productId: "porta-aa-four" })]);
    assert.equal(rememberPackages([row], memory)[0].unidadesPorPaquete, null);
    assert.equal(rememberPackages([{ ...row, confirmado: true, productId: "porta-aa" }], memory)[0].unidadesPorPaquete, 50);
    assert.equal(rememberPackages([{ ...row, nombre: "Portapilas AA para 4 celdas" }], memory)[0].empaqueRecordado.compraId, "four");
});

test("only registered purchases with valid explicit package sizes are indexed, deduplicating latest records", () => {
    const memory = buildPackageMemory([order("new"), order("old"), { ...order("draft"), estado: "borrador" }, order("missing", { unidadesPorPaquete: null }), order("bad", { unidadesPorPaquete: -1 }), order("loose", { unidad: "unidad" })]);
    assert.equal(memory.length, 1); assert.equal(memory[0].compraId, "new");
});
