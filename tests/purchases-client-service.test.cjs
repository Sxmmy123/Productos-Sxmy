const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const key = "sk-proj-" + "test-only-not-a-real-key".repeat(2);
const product = { nombre: "Motorreductor", codigo: "010", precioCompra: 9.5, precioVenta: 20, stock: 8 };
const input = (id = "purchase-test") => ({ requestId: id, proveedor: "Proveedor", fecha: "2026-10-15", textoOriginal: "6 motores 60 Bs", items: [
    { nombre: "Motorreductor", nombreOriginal: "motoreductor", cantidad: 6, importe: 60, tipoPrecio: "total", unidad: "unid.", productId: "motor", confirmado: true, actualizar: true, cambiarVenta: true, expectedCompra: 9.5, expectedVenta: 20, precioVenta: 22 }
] });

async function harness() {
    const docs = new Map(), versions = new Map(), calls = [], writes = [], reads = [];
    const auth = { currentUser: { uid: "admin" } }, navigator = { onLine: true };
    let failCommit = false, loseResponse = false, denied = "";
    const put = (id, value) => { docs.set(id, structuredClone(value)); versions.set(id, (versions.get(id) || 0) + 1); };
    const snapshot = id => ({ id: id.split("/").at(-1), exists: () => docs.has(id), data: () => structuredClone(docs.get(id)) });
    const sdk = {
        doc: (_, collection, id) => ({ path: collection + "/" + id, id }),
        collection: (_, name) => ({ path: name }),
        getDocFromServer: async ref => { if (denied === ref.path) throw Object.assign(new Error("denied"), { code: "permission-denied" }); return snapshot(ref.path); },
        setDoc: async (ref, value) => { writes.push(ref.path); put(ref.path, value); },
        serverTimestamp: () => new Date(),
        orderBy: (field, direction) => ({ type: "order", field, direction }),
        limit: value => ({ type: "limit", value }),
        startAfter: value => ({ type: "cursor", value }),
        query: (ref, ...parts) => ({ ...ref, parts }),
        getDocs: async ref => {
            reads.push(ref.path);
            if (denied === ref.path) throw Object.assign(new Error("denied"), { code: "permission-denied" });
            let result = [...docs.keys()].filter(id => id.startsWith(ref.path + "/")).map(snapshot);
            for (const part of ref.parts || []) {
                if (part.type === "order") result.sort((a, b) => b.data()[part.field] - a.data()[part.field]);
                if (part.type === "cursor") result = result.slice(result.findIndex(doc => doc.id === part.value.id) + 1);
                if (part.type === "limit") result = result.slice(0, part.value);
            }
            return { docs: result };
        },
        runTransaction: async (_, callback) => {
            for (let retry = 0; retry < 10; retry++) {
                const reads = new Map(), staged = [];
                const tx = {
                    get: async ref => {
                        assert.equal(staged.length, 0, "Every read must precede writes");
                        reads.set(ref.path, versions.get(ref.path) || 0);
                        const data = structuredClone(docs.get(ref.path)), exists = docs.has(ref.path);
                        await new Promise(resolve => setImmediate(resolve));
                        return { id: ref.id, exists: () => exists, data: () => data };
                    },
                    set: (ref, value) => staged.push([ref.path, value]),
                    update: (ref, value) => staged.push([ref.path, value, true])
                };
                const result = await callback(tx);
                if ([...reads].some(([id, version]) => versions.get(id) !== (version || undefined))) continue;
                if (failCommit) throw Object.assign(new Error("No se confirmo"), { code: "unavailable" });
                for (const [id, value, merge] of staged) { writes.push(id); put(id, merge ? { ...docs.get(id), ...value } : value); }
                if (loseResponse) { loseResponse = false; throw Object.assign(new Error("Respuesta perdida"), { code: "unavailable" }); }
                return result;
            }
            throw new Error("Too many retries");
        }
    };
    const context = vm.createContext({ navigator, Date, Error, Object, Map, Set, AbortSignal,
        fetch: async (url, options) => {
            calls.push({ url, options });
            const result = JSON.parse(options.body).text.format.name === "producto_compra" ? { nombre: "Sensor corregido", descripcion: "Sensor para proyectos electronicos." } : { filas: [{ nombre: "motoreductor", descripcion: "Motor para robotica.", cantidad: 6, importe: 60, tipoPrecio: "total", productId: "motor" }], avisos: [], totalDeclarado: null };
            return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(result) }] }] }) };
        }
    });
    const cache = new Map();
    async function load(file) {
        if (cache.has(file)) return cache.get(file);
        const module = new vm.SourceTextModule(fs.readFileSync(file, "utf8"), { context });
        cache.set(file, module);
        await module.link(specifier => {
            if (specifier.includes("firebase-config") || specifier.startsWith("https:")) {
                const exports = specifier.includes("firebase-config") ? { auth, db: {} } : sdk;
                return new vm.SyntheticModule(Object.keys(exports), function () {
                    for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
                }, { context });
            }
            return load(path.resolve(path.dirname(file), specifier.split("?")[0]));
        });
        return module;
    }
    const service = await load(path.resolve(__dirname, "../app/shared/services/purchase-service.js"));
    await service.evaluate();
    put("usuarios/admin", { rol: "admin", activo: true, nombre: "Administrador" });
    put("usuarios/cajero", { rol: "cajero", activo: true, nombre: "Cajero" });
    put("configuracion_privada/openai", { apiKey: key, model: "gpt-6-luna" });
    put("productos/motor", product);
    return { service: service.namespace, auth, docs, put, calls, writes, reads, navigator,
        fail: () => { failCommit = true; }, lose: () => { loseResponse = true; }, deny: id => { denied = id; } };
}

for (const role of ["admin", "cajero"]) {
    test(`${role} can request an AI product draft with no product writes or price disclosure`, async () => {
        const h = await harness(); h.auth.currentUser = { uid: role };
        const result = await h.service.generatePurchaseProduct("sensor");
        assert.equal(result.nombre, "Sensor corregido"); assert.equal(result.descripcion, "Sensor para proyectos electronicos.");
        const body = JSON.parse(h.calls[0].options.body);
        assert.equal(h.writes.length, 0); assert.deepEqual(Object.keys(JSON.parse(body.input)), ["nombre"]);
        h.put("usuarios/" + role, { rol: role, activo: false });
        await assert.rejects(h.service.generatePurchaseProduct("sensor"), { code: "permission-denied" });
        assert.equal(h.calls.length, 1);
    });
    test(`${role} interprets with the private key, sends no inventory prices and writes nothing`, async () => {
        const h = await harness(); h.auth.currentUser = { uid: role };
        const result = await h.service.interpretPurchaseList("6 motores 60 Bs", [{ id: "motor", ...product }]);
        assert.equal(result.modelo, "gpt-6-luna"); assert.equal(result.filas[0].confirmado, true);
        assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, "https://api.openai.com/v1/responses");
        const body = JSON.parse(h.calls[0].options.body);
        assert.equal(body.store, false); assert.equal(body.model, "gpt-6-luna");
        assert.equal("precioCompra" in JSON.parse(body.input).catalogo[0], false);
        assert.equal(h.writes.length, 0); assert.equal(h.docs.has("compras/purchase-test"), false);
    });
    test(`${role} registers reviewed products directly without changing stock`, async () => {
        const h = await harness(); h.auth.currentUser = { uid: role };
        const result = await h.service.registerPurchase(input());
        assert.equal(result.total, 60); assert.equal(result.actualizados, 0);
        assert.equal(h.docs.get("productos/motor").stock, 8);
        assert.equal(h.docs.get("productos/motor").precioCompra, 9.5);
        assert.equal(h.docs.get("productos/motor").precioVenta, 20);
        assert.equal(h.writes.some(id => id.startsWith("productos/")), false);
        const saved = h.docs.get("compras/purchase-test");
        assert.equal(saved.registradoPorUid, role); assert.equal(saved.textoOriginal, "6 motores 60 Bs");
        assert.equal(JSON.stringify(saved).includes(key), false);
        assert.equal(h.calls.length, 0);
    });
}

test("the existing private key works without any API registration UI or key-writing service", async () => {
    const h = await harness();
    assert.equal(h.service.saveOpenAIKey, undefined);
    const view = fs.readFileSync(path.join(__dirname, "../app/modules/compras/view.html"), "utf8");
    assert.equal(view.includes("purchaseKeyInput"), false);
    await h.service.interpretPurchaseList("list", [{ id: "motor", ...product }]);
    assert.equal(h.calls.length, 1); assert.equal(h.writes.length, 0);
});

test("missing, inactive and public profiles cannot call OpenAI or register", async () => {
    for (const profile of [null, { rol: "admin", activo: false }, { rol: "cajero" }, { rol: "visitante", activo: true }]) {
        const h = await harness(); h.docs.delete("usuarios/admin");
        if (profile) h.put("usuarios/admin", profile);
        await assert.rejects(h.service.interpretPurchaseList("list", []), { code: "permission-denied" });
        await assert.rejects(h.service.registerPurchase(input()), { code: "permission-denied" });
        assert.equal(h.writes.length, 0); assert.equal(h.calls.length, 0);
    }
});

test("missing key and denied private settings explain the problem without an OpenAI request", async () => {
    const h = await harness(); h.docs.delete("configuracion_privada/openai");
    await assert.rejects(h.service.interpretPurchaseList("list", []), { code: "openai/not-configured" });
    h.deny("configuracion_privada/openai");
    await assert.rejects(h.service.interpretPurchaseList("list", []), /reglas nuevas/);
    assert.equal(h.calls.length, 0);
});

test("saved aliases resolve matching names without any interpretation write", async () => {
    const h = await harness(); h.put("compras_aliases/motoreductor", { productId: "motor" });
    const result = await h.service.interpretPurchaseList("list", [{ id: "motor", ...product }]);
    assert.equal(result.filas[0].confirmado, true); assert.equal(h.writes.length, 0);
});

test("lost registration responses can be retried exactly once with the same ID", async () => {
    const h = await harness(); h.lose();
    await assert.rejects(h.service.registerPurchase(input()), /Respuesta perdida/);
    const result = await h.service.registerPurchase(input());
    assert.equal(result.repetida, true);
    assert.equal(h.docs.get("productos/motor").historialPrecios, undefined);
    assert.equal([...h.docs.keys()].filter(id => id.startsWith("compras/")).length, 1);
    h.auth.currentUser = { uid: "cajero" };
    await assert.rejects(h.service.registerPurchase(input()), { code: "permission-denied" });
});

test("stale prices and atomic failures do not partially save a purchase", async () => {
    const h = await harness(); h.put("productos/motor", { ...product, precioCompra: 11 });
    await assert.rejects(h.service.applyPurchaseInventory(input()), { code: "aborted" });
    assert.equal(h.writes.length, 0);
    h.put("productos/motor", product); h.fail();
    await assert.rejects(h.service.registerPurchase(input()), { code: "unavailable" });
    assert.equal(h.docs.has("compras/purchase-test"), false); assert.equal(h.docs.get("productos/motor").precioCompra, 9.5);
});

test("9 selected updates out of 14 keep the other prices and every stock unchanged", async () => {
    const h = await harness(); const data = input();
    data.items = Array.from({ length: 14 }, (_, i) => {
        h.put("productos/motor" + i, product);
        return { ...data.items[0], productId: "motor" + i, nombreOriginal: "Motor modelo " + i, actualizar: i < 9 };
    });
    const result = await h.service.applyPurchaseInventory({ ...data, items: data.items.filter(item => item.actualizar) });
    assert.equal(result.actualizados, 9);
    assert.equal([...h.docs.keys()].some(id => id.startsWith("compras/")), false);
    for (let i = 0; i < 14; i++) {
        const saved = h.docs.get("productos/motor" + i);
        assert.equal(saved.precioCompra, i < 9 ? 10 : 9.5); assert.equal(saved.precioVenta, i < 9 ? 22 : 20); assert.equal(saved.stock, 8);
    }
    const archived = await h.service.registerPurchase(data);
    assert.equal(archived.total, 840); assert.equal(archived.actualizados, 0);
});

test("offline operations do not send drafts or credentials", async () => {
    const h = await harness(); h.navigator.onLine = false;
    for (const operation of [() => h.service.interpretPurchaseList("list", []), () => h.service.registerPurchase(input()), () => h.service.applyPurchaseInventory(input())]) await assert.rejects(operation(), { code: "client/offline" });
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
});

test("purchase cursors avoid duplicate records", async () => {
    const h = await harness();
    for (let i = 1; i <= 25; i++) h.put("compras/order-" + i, { createdAt: i, total: i, items: [] });
    const first = await h.service.getPurchasesPage(), second = await h.service.getPurchasesPage(first.cursor);
    assert.equal(first.purchases.length, 20); assert.equal(first.hasMore, true); assert.equal(second.purchases.length, 5); assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.purchases, ...second.purchases].map(row => row.id)).size, 25);
});

test("inventory updates have their own idempotent receipt and never register a purchase", async () => {
    const h = await harness(); h.lose();
    await assert.rejects(h.service.applyPurchaseInventory(input()), /Respuesta perdida/);
    assert.equal((await h.service.applyPurchaseInventory(input())).repetida, true);
    assert.equal(h.docs.get("productos/motor").historialPrecios.length, 1);
    assert.equal(h.docs.has("compras/purchase-test"), false);
    assert.equal(h.docs.get("compras_operaciones/purchase-test").tipo, "precios");
});

test("new products keep the reviewed description, have no images or stock changes and retries do not duplicate them", async () => {
    const h = await harness(); h.lose();
    const data = { requestId: "new-product", nombre: "Sensor nuevo", descripcion: "Sensor para proyectos electronicos.", precioVenta: 15, row: input().items[0] };
    await assert.rejects(h.service.createPurchaseProduct(data), /Respuesta perdida/);
    const result = await h.service.createPurchaseProduct(data);
    assert.equal(result.repetida, true); assert.equal(result.codigo, "011");
    const created = h.docs.get("productos/011");
    assert.equal(created.imagenUrl, ""); assert.equal(created.precioCompra, 10); assert.equal(created.precioVenta, 15); assert.equal(created.stock, "");
    assert.equal(created.descripcion, data.descripcion);
    assert.equal([...h.docs.keys()].filter(id => id.startsWith("compras/")).length, 0);
});

test("cost-only inventory operation ignores stale sale drafts and never appends sale history", async () => {
    const h = await harness(), data = input(); data.items[0].cambiarVenta = false;
    await h.service.applyPurchaseInventory(data);
    assert.equal(h.docs.get("productos/motor").precioCompra, 10);
    assert.equal(h.docs.get("productos/motor").precioVenta, 20);
    assert.equal(h.docs.get("productos/motor").historialPrecios, undefined);
});

test("package memory reads all registered history pages, caches per user and sends nothing to OpenAI", async () => {
    const h = await harness();
    for (let i = 0; i < 105; i++) h.put("compras/old-" + i, { estado: "comprado", createdAt: i, fecha: "2026-10-15", items: i === 0 ? [{ nombre: "Portapilas AA", unidad: "bolsa", unidadesPorPaquete: 50 }] : [] });
    const result = await h.service.getPurchasePackageMemory();
    assert.equal(result.length, 1); assert.equal(result[0].unidades, 50); assert.equal(result[0].compraId, "old-0");
    assert.equal(h.reads.filter(path => path === "compras").length, 2);
    await h.service.getPurchasePackageMemory(); assert.equal(h.reads.length, 2);
    assert.equal(h.calls.length, 0); assert.equal(h.writes.length, 0);
    h.auth.currentUser = { uid: "cajero" }; await h.service.getPurchasePackageMemory(); assert.equal(h.reads.length, 4);
    h.put("usuarios/cajero", { rol: "cajero", activo: false });
    await assert.rejects(h.service.getPurchasePackageMemory(), { code: "permission-denied" });
});

test("registering a reviewed package makes it available for later orders and invalidates cached history", async () => {
    const h = await harness(); await h.service.getPurchasePackageMemory();
    const data = input(); Object.assign(data.items[0], { nombre: "Portapilas AA", nombreOriginal: "Bolsa de pilas AA", productId: "", confirmado: false, unidad: "bolsa", cantidad: 1, importe: 120, unidadesPorPaquete: 50 });
    await h.service.registerPurchase(data);
    const result = await h.service.getPurchasePackageMemory();
    assert.equal(result.length, 1); assert.equal(result[0].unidades, 50);
    assert.equal(h.docs.get("compras/purchase-test").items[0].precioCompraInventario, 2.4);
    assert.equal(h.writes.some(path => path.startsWith("productos/")), false);
    h.navigator.onLine = false;
    await assert.rejects(h.service.getPurchasePackageMemory(), { code: "client/offline" });
});

test("concurrent new products get separate sequential codes without overwriting", async () => {
    const h = await harness();
    const results = await Promise.all(["A", "B"].map(nombre => h.service.createPurchaseProduct({ requestId: "new-" + nombre, nombre: "Sensor " + nombre, precioVenta: 15, row: input().items[0] })));
    assert.equal(new Set(results.map(result => result.id)).size, 2);
    assert.equal(h.docs.get("productos/010"), undefined);
    assert.equal(h.docs.get("productos/motor").nombre, product.nombre);
});
