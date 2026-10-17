const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ admin = true, failProfile = false, duplicate = false } = {}) {
    const documents = new Map([
        ['usuarios/admin', { rol: admin ? 'admin' : 'cajero', activo: true }],
        ['usuarios/cashier', { rol: 'cajero', activo: true, email: 'old@example.com', nombre: 'Caja' }]
    ]);
    const account = { displayName: 'Caja', email: 'old@example.com', emailVerified: true };
    const remove = Symbol('delete');
    const doc = (key) => ({
        key, get: async () => ({ data: () => documents.get(key) }),
        update: async (value) => {
            if (failProfile && value.email) throw new Error('Firestore unavailable');
            const current = documents.get(key);
            for (const [name, field] of Object.entries(value)) {
                if (field === remove) delete current[name]; else current[name] = field;
            }
        }
    });
    const db = { doc, runTransaction: async (run) => run({ get: ref => ref.get(), update: (ref, value) => ref.update(value) }) };
    const auth = { getUser: async () => ({ ...account }), updateUser: async (_, value) => {
        if (duplicate && value.email !== account.email) throw Object.assign(new Error('Duplicate'), { code: 'auth/email-already-exists' });
        Object.assign(account, value);
    } };
    class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
    const modules = {
        './purchases': {},
        'firebase-admin/app': { initializeApp() {} },
        'firebase-admin/auth': { getAuth: () => auth },
        'firebase-admin/firestore': { getFirestore: () => db, FieldValue: { serverTimestamp: () => Date.now(), delete: () => remove } },
        'firebase-functions/v2/https': { HttpsError, onCall: (_, callback) => callback }
    };
    const exported = {};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../functions/index.js'), 'utf8'), { exports: exported, require: name => modules[name], Date, console });
    const request = { auth: { uid: 'admin' }, data: { uid: 'cashier', nombre: 'Caja nueva', email: 'new@example.com', expectedEmail: 'old@example.com' } };
    return { run: exported.updateCashier, request, account, documents };
}
test('only active administrators can edit cashier authentication', async () => {
    const h = harness({ admin: false });
    await assert.rejects(h.run(h.request), { code: 'permission-denied' });
    await assert.rejects(h.run({ ...h.request, auth: null }), { code: 'unauthenticated' });
});
test('email update synchronizes Authentication and Firestore', async () => {
    const h = harness(); await h.run(h.request);
    assert.equal(h.account.email, 'new@example.com');
    assert.equal(h.account.emailVerified, false);
    assert.equal(h.documents.get('usuarios/cashier').nombre, 'Caja nueva');
    assert.equal(h.documents.get('usuarios/cashier').email, 'new@example.com');
    assert.equal('editingUntil' in h.documents.get('usuarios/cashier'), false);
});
test('profile write failure compensates the Authentication update', async () => {
    const h = harness({ failProfile: true });
    await assert.rejects(h.run(h.request), { code: 'internal' });
    assert.equal(h.account.email, 'old@example.com');
    assert.equal(h.account.emailVerified, true);
    assert.equal(h.documents.get('usuarios/cashier').email, 'old@example.com');
});
test('duplicate email does not alter the account and releases its lock', async () => {
    const h = harness({ duplicate: true });
    await assert.rejects(h.run(h.request), { code: 'already-exists' });
    assert.equal(h.account.email, 'old@example.com');
    assert.equal('editingUntil' in h.documents.get('usuarios/cashier'), false);
});
test('stale profiles and unsafe document IDs are rejected', async () => {
    const h = harness();
    await assert.rejects(h.run({ ...h.request, data: { ...h.request.data, expectedEmail: 'stale@example.com' } }), { code: 'aborted' });
    await assert.rejects(h.run({ ...h.request, data: { ...h.request.data, uid: '../admin' } }), { code: 'invalid-argument' });
});
