import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, beforeEach, test } from "node:test";

const project = "demo-sxmy-rules";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
for (const host of [firestoreHost, authHost]) {
    if (!/^127\.0\.0\.1:\d+$/.test(host || "")) {
        throw new Error("Run npm run test:rules. These tests only use local emulators.");
    }
}
const base = `http://${firestoreHost}`;
const documents = `projects/${project}/databases/(default)/documents`;
const rules = await readFile(new URL("../firebase/firestore.rules", import.meta.url), "utf8");
const users = {};

async function request(path, { method = "GET", body, token = "owner" } = {}) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
}

function value(data) {
    if (typeof data === "string") return { stringValue: data };
    if (typeof data === "boolean") return { booleanValue: data };
    if (typeof data === "number") return Number.isInteger(data)
        ? { integerValue: String(data) } : { doubleValue: data };
    if (Array.isArray(data)) return { arrayValue: { values: data.map(value) } };
    return { mapValue: { fields: fields(data) } };
}

function fields(data) {
    return Object.fromEntries(Object.entries(data).map(([key, entry]) => [key, value(entry)]));
}

function write(path, data) {
    return { update: { name: `${documents}/${path}`, fields: fields(data) } };
}

async function commit(writes, token = "owner") {
    return request(`/v1/${documents}:commit`, { method: "POST", body: { writes }, token });
}

async function loadRules(content) {
    const response = await request(`/emulator/v1/projects/${project}:securityRules`, {
        method: "PUT", body: { rules: { files: [{ name: "firestore.rules", content }] } }
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal((response.body.issues || []).some((issue) => issue.severity === "ERROR"), false);
}

function saleWrites(user, { id = "order-1", sequence = 1, sale = {}, counter = {} } = {}) {
    const numero = String(sequence).padStart(6, "0");
    return [
        write("contadores/ventas", { ultimoNumero: sequence, numero, notaId: id, ...counter }),
        write(`ventas/${id}`, {
            requestId: id, numero, vendedorUid: user.uid, cliente: "Cliente",
            descuento: 0, subtotal: 40, total: 40,
            items: [{ productId: "motor", codigo: "010", nombre: "Motor", precio: 20, cantidad: 2, subtotal: 40 }],
            ...sale
        }),
        write("productos/motor", { nombre: "Motor", precio: 20, stock: 8 })
    ];
}

before(async () => {
    for (const name of ["admin", "cajero", "inactive", "missing", "visitor"]) {
        const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: `${name}@example.test`, password: "test-only-password", returnSecureToken: true })
        });
        const data = await response.json();
        assert.equal(response.status, 200, JSON.stringify(data.error || {}));
        users[name] = { uid: data.localId, token: data.idToken };
    }
});

beforeEach(async () => {
    const cleared = await request(`/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
    assert.equal(cleared.status, 200);
    await loadRules(rules);
    const seeded = await commit([
        ...["admin", "cajero", "inactive", "visitor"].map((name) => write(`usuarios/${users[name].uid}`, {
            uid: users[name].uid, rol: name === "inactive" ? "cajero" : name,
            activo: name !== "inactive", nombre: name
        })),
        write("productos/motor", { nombre: "Motor", precio: 20, stock: 10 })
    ]);
    assert.equal(seeded.status, 200);
});

test("old rules reproduce the permission error even for an active admin", async () => {
    await loadRules(rules.replaceAll(").data.numero", ").numero").replaceAll(").data.notaId", ").notaId"));
    const result = await commit(saleWrites(users.admin), users.admin.token);
    assert.equal(result.status, 403, JSON.stringify(result.body));
});

for (const name of ["admin", "cajero"]) {
    test(`${name} can atomically create a note, counter and update stock`, async () => {
        const result = await commit(saleWrites(users[name]), users[name].token);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const saved = await request(`/v1/${documents}/ventas/order-1`, { token: users[name].token });
        assert.equal(saved.body.fields.numero.stringValue, "000001");
        const product = await request(`/v1/${documents}/productos/motor`);
        assert.equal(product.body.fields.stock.integerValue, "8");
    });

    test(`${name} can advance an existing sales counter`, async () => {
        await commit([write("contadores/ventas", { ultimoNumero: 7, numero: "000007", notaId: "previous" })]);
        const result = await commit(saleWrites(users[name], { sequence: 8 }), users[name].token);
        assert.equal(result.status, 200, JSON.stringify(result.body));
    });
}

for (const name of ["missing", "inactive", "visitor"]) {
    test(`${name} cannot create a sales note`, async () => {
        const result = await commit(saleWrites(users[name]), users[name].token);
        assert.equal(result.status, 403, JSON.stringify(result.body));
    });
}

test("public visitors can read products but cannot register sales", async () => {
    const product = await request(`/v1/${documents}/productos/motor`, { token: "" });
    assert.equal(product.status, 200);
    const result = await commit(saleWrites(users.admin), "");
    assert.equal(result.status, 403);
});

for (const [name, options] of [
    ["wrong seller", () => ({ sale: { vendedorUid: users.cajero.uid } })],
    ["wrong request ID", () => ({ sale: { requestId: "other-order" } })],
    ["wrong sales number", () => ({ sale: { numero: "000999" } })],
    ["wrong counter note ID", () => ({ counter: { notaId: "other-order" } })],
    ["negative total", () => ({ sale: { total: -1 } })],
    ["negative discount", () => ({ sale: { descuento: -1 } })],
    ["empty products", () => ({ sale: { items: [] } })]
]) {
    test(`rejects ${name} without partially changing stock`, async () => {
        const result = await commit(saleWrites(users.admin, options()), users.admin.token);
        assert.equal(result.status, 403, JSON.stringify(result.body));
        const product = await request(`/v1/${documents}/productos/motor`);
        assert.equal(product.body.fields.stock.integerValue, "10");
    });
}

test("existing sales notes remain immutable", async () => {
    const user = users.admin;
    assert.equal((await commit(saleWrites(user), user.token)).status, 200);
    assert.equal((await commit([write("ventas/order-1", { total: 0 })], user.token)).status, 403);
    assert.equal((await commit([{ delete: `${documents}/ventas/order-1` }], user.token)).status, 403);
});

function purchaseWrites(user, { id = "purchase-1", patch = {}, aliases = 1 } = {}) {
    const purchase = write(`compras/${id}`, {
        requestId: id, proveedor: "Proveedor", fecha: "2026-10-15", textoOriginal: "6 motores 60 Bs",
        items: Array.from({ length: Math.max(1, aliases) }, (_, index) => ({ nombre: "Motor " + index, cantidad: 6, precioCompra: 10, total: 60 })),
        total: Math.max(1, aliases) * 60, actualizados: 0, estado: "comprado", registradoPorUid: user.uid,
        registradoPorNombre: "Usuario", ...patch
    });
    purchase.updateTransforms = [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }];
    return [purchase, ...Array.from({ length: aliases }, (_, index) => ({
        ...write(`compras_aliases/motor${index}`, { productId: "motor", nombre: "Motor " + index, compraId: id, updatedByUid: user.uid }),
        updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }]
    }))];
}

function keyWrite(user, patch = {}) {
    return {
        ...write("configuracion_privada/openai", { apiKey: "sk-proj-test-only-not-a-real-key", model: "gpt-6-luna", updatedByUid: user.uid, ...patch }),
        updateTransforms: [{ fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }]
    };
}

test("purchase history and aliases remain staff-only and immutable after registration", async () => {
    assert.equal((await commit([
        write("compras/purchase-1", { estado: "comprado", total: 60, registradoPorUid: users.admin.uid }),
        write("compras_aliases/motor", { productId: "motor" })
    ])).status, 200);
    for (const name of ["admin", "cajero"]) {
        for (const path of ["compras/purchase-1", "compras_aliases/motor"]) {
            assert.equal((await request(`/v1/${documents}/${path}`, { token: users[name].token })).status, 200);
            assert.equal((await commit([write(path, { total: 1 })], users[name].token)).status, 403);
            assert.equal((await commit([{ delete: `${documents}/${path}` }], users[name].token)).status, 403);
        }
        assert.equal((await commit([write("compras/forged", { total: 0 })], users[name].token)).status, 403);
        assert.equal((await commit([write("_compras_ia_limites/counter", { dayCount: 0 })], users[name].token)).status, 403);
    }
    for (const token of ["", users.visitor.token, users.inactive.token, users.missing.token]) {
        assert.equal((await request(`/v1/${documents}/compras/purchase-1`, { token })).status, 403);
        assert.equal((await request(`/v1/${documents}/compras_aliases/motor`, { token })).status, 403);
    }
});

for (const role of ["admin", "cajero"]) {
    test(`${role} can register a reviewed purchase and its aliases without Functions`, async () => {
        const result = await commit(purchaseWrites(users[role]), users[role].token);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const saved = await request(`/v1/${documents}/compras/purchase-1`, { token: users[role].token });
        assert.equal(saved.body.fields.total.integerValue, "60");
        assert.equal((await commit(purchaseWrites(users[role]), users[role].token)).status, 403, "A saved purchase cannot be overwritten");
    });
}

test("200 aliases share the transaction access budget instead of exceeding rule limits", async () => {
    const result = await commit(purchaseWrites(users.admin, { aliases: 200 }), users.admin.token);
    assert.equal(result.status, 200, JSON.stringify(result.body));
});

test("purchase creation rejects forged owners, totals, counts and unknown fields", async () => {
    for (const patch of [{ registradoPorUid: users.cajero.uid }, { requestId: "different" }, { total: -1 }, { items: [] }, { actualizados: 1 }, { actualizados: 2 }, { apiKey: "secret" }]) {
        const result = await commit(purchaseWrites(users.admin, { patch }), users.admin.token);
        assert.equal(result.status, 403, JSON.stringify(patch));
    }
    assert.equal((await commit([write("compras_aliases/forged", { productId: "motor", nombre: "Motor", compraId: "none", updatedByUid: users.admin.uid })], users.admin.token)).status, 403);
});

test("private OpenAI credentials are readable by active staff only and never listable", async () => {
    assert.equal((await commit([keyWrite(users.admin)], users.admin.token)).status, 200);
    for (const name of ["admin", "cajero"]) {
        assert.equal((await request(`/v1/${documents}/configuracion_privada/openai`, { token: users[name].token })).status, 200);
        assert.equal((await request(`/v1/${documents}/configuracion_privada`, { token: users[name].token })).status, 403);
    }
    for (const token of ["", users.visitor.token, users.inactive.token, users.missing.token]) {
        assert.equal((await request(`/v1/${documents}/configuracion_privada/openai`, { token })).status, 403);
        assert.equal((await commit([keyWrite(users.admin)], token)).status, 403);
        assert.equal((await commit(purchaseWrites(users.admin), token)).status, 403);
    }
});

test("cashiers cannot replace the key and admin updates must use the fixed model and own UID", async () => {
    assert.equal((await commit([keyWrite(users.admin)], users.admin.token)).status, 200);
    assert.equal((await commit([keyWrite(users.cajero)], users.cajero.token)).status, 403);
    for (const patch of [{ apiKey: "not-a-key" }, { model: "other-model" }, { updatedByUid: users.cajero.uid }, { public: true }]) {
        assert.equal((await commit([keyWrite(users.admin, patch)], users.admin.token)).status, 403);
    }
    assert.equal((await commit([keyWrite(users.admin, { apiKey: "sk-proj-replacement-test-only-key" })], users.admin.token)).status, 200);
    assert.equal((await commit([{ delete: `${documents}/configuracion_privada/openai` }], users.admin.token)).status, 403);
});

for (const role of ["admin", "cajero"]) {
    test(`${role} can apply inventory changes with a separate immutable receipt, without saving a purchase`, async () => {
        const receipt = {
            ...write("compras_operaciones/operation-1", { requestId: "operation-1", tipo: "precios", productIds: ["motor"], actualizados: 1, registradoPorUid: users[role].uid }),
            updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }]
        };
        assert.equal((await commit([write("productos/motor", { nombre: "Motor", precioCompra: 10, precioVenta: 22, stock: 10 }), receipt], users[role].token)).status, 200);
        assert.equal((await request(`/v1/${documents}/compras_operaciones/operation-1`, { token: users[role].token })).status, 200);
        assert.equal((await request(`/v1/${documents}/compras/purchase-1`, { token: users[role].token })).status, 404);
        assert.equal((await commit([receipt], users[role].token)).status, 403);
        assert.equal((await commit([{ delete: `${documents}/compras_operaciones/operation-1` }], users[role].token)).status, 403);
    });
}

test("new product receipts allow staff creation but reject public, inactive and forged owners", async () => {
    const receipt = {
        ...write("compras_operaciones/new-1", { requestId: "new-1", tipo: "producto", codigo: "011", productIds: ["011"], actualizados: 1, registradoPorUid: users.admin.uid }),
        updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }]
    };
    for (const token of ["", users.inactive.token, users.missing.token, users.visitor.token, users.cajero.token]) assert.equal((await commit([receipt], token)).status, 403);
    assert.equal((await commit([write("productos/011", { codigo: "011", nombre: "Sensor nuevo", precioCompra: 10, precioVenta: 15, imagenUrl: "", stock: "" }), receipt], users.admin.token)).status, 200);
    assert.equal((await request(`/v1/${documents}/compras_operaciones/new-1`, { token: "" })).status, 403);
    assert.equal((await request(`/v1/${documents}/compras_operaciones`, { token: users.admin.token })).status, 403);
});
