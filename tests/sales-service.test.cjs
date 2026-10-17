const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function harness() {
    const docs = new Map(), versions = new Map();
    const auth = { currentUser: { uid: 'a', email: 'a@example.com' } };
    let failCommit = false;
    let deniedRead = '';
    const put = (id, data) => { docs.set(id, structuredClone(data)); versions.set(id, (versions.get(id) || 0) + 1); };
    const snapshot = (id) => ({ id: id.split('/').at(-1), exists: () => docs.has(id), data: () => structuredClone(docs.get(id)) });
    const sdk = {
        collection: (_, id) => ({ path: id }),
        doc: (...args) => ({ path: typeof args[1] === 'string' && args.length === 3 ? args[1] + '/' + args[2] : args[0].path + '/' + args[1] }),
        getDoc: async (ref) => {
            if (ref.path === deniedRead) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
            return snapshot(ref.path);
        },
        getDocs: async (ref) => {
            if (ref.path === deniedRead) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
            let result = [...docs].filter(([id]) => id.startsWith(ref.path + '/')).map(([id]) => snapshot(id));
            for (const part of ref.parts || []) {
                if (part.kind === 'where') result = result.filter(doc => {
                    const actual = doc.data()[part.field];
                    return part.op === '==' ? actual === part.value : part.op === '>=' ? actual >= part.value : actual < part.value;
                });
                if (part.kind === 'order') result.sort((a, b) => b.data()[part.field] - a.data()[part.field]);
                if (part.kind === 'cursor') result = result.slice(result.findIndex(doc => doc.id === part.value.id) + 1);
                if (part.kind === 'limit') result = result.slice(0, part.value);
            }
            return { docs: result, size: result.length };
        },
        query: (ref, ...parts) => ({ ...ref, parts }),
        where: (field, op, value) => ({ kind: 'where', field, op, value }),
        orderBy: (field) => ({ kind: 'order', field }),
        startAfter: (value) => ({ kind: 'cursor', value }),
        limit: (value) => ({ kind: 'limit', value }),
        serverTimestamp: () => new Date(),
        runTransaction: async (_, callback) => {
            for (let retry = 0; retry < 10; retry++) {
                const reads = new Map(), writes = [];
                const tx = {
                    get: async (ref) => {
                        assert.equal(writes.length, 0, 'All reads precede writes');
                        reads.set(ref.path, versions.get(ref.path) || 0);
                        const snap = snapshot(ref.path), data = snap.data(), exists = snap.exists();
                        await new Promise(resolve => setImmediate(resolve));
                        return { ...snap, exists: () => exists, data: () => data };
                    },
                    set: (ref, value) => writes.push([ref.path, value, false]),
                    update: (ref, value) => writes.push([ref.path, value, true])
                };
                const result = await callback(tx);
                if ([...reads].some(([id, version]) => (versions.get(id) || 0) !== version)) continue;
                if (failCommit) throw Object.assign(new Error('connection lost'), { code: failCommit === true ? 'unavailable' : failCommit });
                for (const [id, value, merge] of writes) put(id, merge ? { ...docs.get(id), ...value } : value);
                return result;
            }
            throw new Error('Retries exhausted');
        }
    };
    const context = vm.createContext({ console, Date, Map, Set, Object, Number, String, Error, Promise });
    const dependencies = new Map();
    function synthetic(key, exports) {
        const module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context });
        dependencies.set(key, module);
        return module;
    }
    synthetic('firebase-config', { auth, db: {} });
    synthetic('firebase-firestore', sdk);
    const directory = path.resolve(__dirname, '../app/shared/services');
    const domain = new vm.SourceTextModule(fs.readFileSync(path.join(directory, 'sales-domain.js'), 'utf8'), { context });
    await domain.link(() => {}); await domain.evaluate();
    const service = new vm.SourceTextModule(fs.readFileSync(path.join(directory, 'sales-service.js'), 'utf8'), { context });
    await service.link(specifier => specifier.includes('sales-domain') ? domain : dependencies.get(specifier.includes('firebase-config') ? 'firebase-config' : 'firebase-firestore'));
    await service.evaluate();
    put('usuarios/a', { rol: 'admin', activo: true });
    put('usuarios/b', { rol: 'cajero', activo: true });
    put('productos/motor', { nombre: 'Motor', codigo: '001', precioVenta: 20, stock: 5, activo: true });
    return { service: service.namespace, docs, auth, put, setFail: (value) => { failCommit = value; }, denyRead: (value) => { deniedRead = value; } };
}
const order = (uid, id, cantidad = 1) => ({ requestId: id, vendedorUid: uid, items: [{ productId: 'motor', cantidad, precio: 20 }], descuento: 0 });

test('two cashiers get unique numbers and subtract from current stock', async () => {
    const h = await harness();
    const one = h.service.saveSale(order('a', 'order-000000000001', 2));
    h.auth.currentUser = { uid: 'b', email: 'b@example.com' };
    const two = h.service.saveSale(order('b', 'order-000000000002', 2));
    const results = await Promise.all([one, two]);
    assert.equal(new Set(results.map(sale => sale.numero)).size, 2);
    assert.equal(h.docs.get('productos/motor').stock, 1);
    assert.equal(h.docs.get('contadores/ventas').ultimoNumero, 2);
});
test('concurrent overselling leaves only one committed sale', async () => {
    const h = await harness();
    const results = await Promise.allSettled([h.service.saveSale(order('a', 'order-000000000001', 4)), h.service.saveSale(order('a', 'order-000000000002', 4))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(h.docs.get('productos/motor').stock, 1);
    assert.equal([...h.docs.keys()].filter(key => key.startsWith('ventas/')).length, 1);
});
test('same order retried twice does not duplicate the note or stock deduction', async () => {
    const h = await harness();
    const payload = order('a', 'order-000000000001', 2);
    const first = await h.service.saveSale(payload), second = await h.service.saveSale(payload);
    assert.equal(first.numero, second.numero);
    assert.equal(h.docs.get('productos/motor').stock, 3);
    assert.equal(h.docs.get('contadores/ventas').ultimoNumero, 1);
});
test('failed commit saves neither note nor stock and retry preserves numbering', async () => {
    const h = await harness(); h.setFail(true);
    await assert.rejects(h.service.saveSale(order('a', 'order-000000000001', 2)));
    assert.equal(h.docs.get('productos/motor').stock, 5);
    assert.equal(h.docs.has('ventas/order-000000000001'), false);
    h.setFail(false);
    assert.equal((await h.service.saveSale(order('a', 'order-000000000001', 2))).numero, '000001');
});
test('existing legacy numbers seed the counter; free stock remains free', async () => {
    const h = await harness();
    h.put('ventas/legacy', { numero: '000123', items: [], fechaIso: '2026-01-01T12:00:00Z' });
    h.put('productos/motor', { nombre: 'Motor', codigo: '001', precioVenta: 20, stock: '', activo: true });
    const sale = await h.service.saveSale(order('a', 'order-000000000001', 10));
    assert.equal(sale.numero, '000124');
    assert.equal(h.docs.get('productos/motor').stock, '');
});

test('missing profile identifies the actual UID without creating roles or sales', async () => {
    const h = await harness();
    h.docs.delete('usuarios/a');
    await assert.rejects(h.service.saveSale(order('a', 'order-000000000001')), /Falta el perfil usuarios\/a/);
    assert.equal(h.docs.has('usuarios/a'), false);
    assert.equal(h.docs.has('contadores/ventas'), false);
    assert.equal(h.docs.get('productos/motor').stock, 5);
});

test('only an explicit active staff profile can sell', async () => {
    for (const profile of [{ rol: 'cliente', activo: true }, { rol: 'admin', activo: false }, { rol: 'cajero' }, { rol: 'admin', activo: 'true' }]) {
        const h = await harness();
        h.put('usuarios/a', profile);
        await assert.rejects(h.service.saveSale(order('a', 'order-000000000001')), /perfil usuarios\/a|cuenta usuarios\/a/);
        assert.equal(h.docs.has('contadores/ventas'), false);
        assert.equal(h.docs.get('productos/motor').stock, 5);
    }
});

test('permission errors during initial reads identify the blocked operation', async () => {
    for (const [path, message] of [['usuarios/a', 'leer usuarios/a'], ['contadores/ventas', 'leer contadores/ventas'], ['ventas', 'leer ventas anteriores']]) {
        const h = await harness();
        h.denyRead(path);
        await assert.rejects(h.service.saveSale(order('a', 'order-000000000001')), error => {
            assert.equal(error.code, 'permission-denied');
            assert.ok(error.message.includes(message));
            assert.ok(error.message.includes('sxmy-bd'));
            assert.ok(error.message.includes('usuarios/a'));
            assert.equal(error.cause.message, 'Missing or insufficient permissions.');
            return true;
        });
        assert.equal(h.docs.has('contadores/ventas'), false);
        assert.equal(h.docs.get('productos/motor').stock, 5);
    }
});

test('denied transaction retains its error code and commits nothing', async () => {
    const h = await harness();
    h.setFail('permission-denied');
    await assert.rejects(h.service.saveSale(order('a', 'order-000000000001')), error => error.code === 'permission-denied' && error.message.includes('guardar ventas, contadores/ventas y stock'));
    assert.equal(h.docs.has('contadores/ventas'), false);
    assert.equal(h.docs.has('ventas/order-000000000001'), false);
    assert.equal(h.docs.get('productos/motor').stock, 5);
});
test('page cursors do not repeat sales and support exact note filters', async () => {
    const h = await harness();
    for (let n = 1; n <= 7; n++) h.put('ventas/sale-' + n, { numero: String(n).padStart(6, '0'), vendedorUid: 'a', createdAt: new Date(2026, 9, n), items: [] });
    const first = await h.service.getSalesPage({ pageSize: 3 });
    const second = await h.service.getSalesPage({ pageSize: 3, cursor: first.cursor });
    assert.equal(first.hasMore, true);
    assert.equal(new Set([...first.sales, ...second.sales].map(sale => sale.id)).size, 6);
    assert.equal((await h.service.getSalesPage({ number: '000003' })).sales[0].numero, '000003');
});
