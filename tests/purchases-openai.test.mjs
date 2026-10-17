import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestInterpretation, requestProductDetails, validApiKey } from "../app/modules/compras/openai-client.js";

const input = { apiKey: "sk-proj-" + "test-only-key".repeat(3), texto: "6 motores 60 Bs", products: [] };
test("invalid credentials and oversized input never reach the network", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; };
    assert.equal(validApiKey("not-a-key"), false);
    for (const data of [{ ...input, apiKey: "" }, { ...input, texto: "a".repeat(16001) }, { ...input, products: Array(2001).fill({}) }]) await assert.rejects(requestInterpretation({ ...data, fetchImpl }));
    assert.equal(calls, 0);
});
test("OpenAI HTTP errors are actionable and never expose provider responses or the key", async () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
        await assert.rejects(requestInterpretation({ ...input, fetchImpl: async () => ({ ok: false, status, json: () => { throw new Error(input.apiKey); } }) }), error => {
            assert.equal(error.code, `openai/http-${status}`); assert.equal(error.message.includes(input.apiKey), false); return true;
        });
    }
});
test("network failures, refusals, truncated JSON and incomplete responses keep existing data intact", async () => {
    for (const fetchImpl of [
        async () => { throw new TypeError("network failed"); },
        async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); },
        async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
        async () => ({ ok: true, json: async () => ({ status: "incomplete", output: [] }) }),
        async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "refusal" }] }] }) }),
        async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: "{" }] }] }) })
    ]) await assert.rejects(requestInterpretation({ ...input, fetchImpl }), error => error.code.startsWith("openai/"));
});

test("interpretation requests descriptions and candidates, not review states or questions", async () => {
    await requestInterpretation({ ...input, fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body), fields = body.text.format.schema.properties.filas.items.properties;
        assert.equal(body.text.format.strict, true); assert.deepEqual(fields.tipoPrecio.enum, ["total", "unitario"]);
        assert.equal(fields.descripcion.type, "string"); assert.equal(fields.consulta, undefined);
        return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: '{"filas":[]}' }] }] }) };
    } });
});

test("the variant prompt inherits the header quantity for every priced variant, with explicit exceptions", async () => {
    const example = JSON.parse(readFileSync(new URL("./fixtures/purchase-variants.json", import.meta.url), "utf8"));
    await requestInterpretation({ ...input, texto: example.texto, fetchImpl: async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(JSON.parse(body.input).lista, example.texto);
        assert.match(body.instructions, /se aplican A CADA variante/);
        assert.match(body.instructions, /esas palabras son opcionales/);
        assert.match(body.instructions, /cantidad 12, importe 240/);
        assert.match(body.instructions, /cantidad 12, importe 300/);
        assert.match(body.instructions, /cantidad 20, importe 30/);
        assert.match(body.instructions, /cantidad 20, importe 40/);
        assert.match(body.instructions, /su propia cantidad, esa cantidad prevalece/);
        assert.match(body.instructions, /20 en total: 8 simples y 12 con tornillo/);
        assert.equal(body.instructions.includes("No apliques la cantidad completa a cada variante"), false);
        return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ filas: example.filas }) }] }] }) };
    } });
});

test("AI product draft uses the shared model and validates name/description without writing or choosing a sale", async () => {
    const fetchImpl = async (_, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.model, "gpt-6-luna"); assert.equal(body.store, false);
        assert.deepEqual(Object.keys(JSON.parse(body.input)), ["nombre"]);
        assert.deepEqual(body.text.format.schema.required, ["nombre", "descripcion"]);
        return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ nombre: "Motorreductor", descripcion: "Motor para proyectos de robotica." }) }] }] }) };
    };
    assert.deepEqual(await requestProductDetails({ apiKey: input.apiKey, nombre: "motoreductor", fetchImpl }), { nombre: "Motorreductor", descripcion: "Motor para proyectos de robotica." });
    await assert.rejects(requestProductDetails({ apiKey: input.apiKey, nombre: "" }), { code: "invalid-argument" });
    await assert.rejects(requestProductDetails({ apiKey: input.apiKey, nombre: "Sensor", fetchImpl: async () => ({ ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: '{}' }] }] }) }) }), { code: "openai/invalid-response" });
});
