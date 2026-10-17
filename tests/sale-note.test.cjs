const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function harness(format = 'letter', height = 600, images = []) {
    const styles = new Map(), properties = new Map(), frames = [];
    let prints = 0;
    const document = {
        getElementById: id => styles.get(id),
        createElement: () => ({ id: '', textContent: '', remove() { styles.delete(this.id); } }),
        head: { append: node => styles.set(node.id, node) },
        body: { append() {} }
    };
    const area = {
        innerHTML: '', dataset: {}, classList: { remove() {} },
        style: { setProperty: (name, value) => properties.set(name, value), removeProperty: name => properties.delete(name) },
        querySelector: () => ({ cloneNode: () => ({ style: { cssText: '' }, getBoundingClientRect: () => ({ height }), remove() {} }) }),
        querySelectorAll: () => images
    };
    const context = vm.createContext({ document, window: { print: () => prints++ }, requestAnimationFrame: callback => frames.push(callback) });
    const dependencies = {
        'product-service': { escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) },
        'sales-service': { formatMoney: value => Number(value || 0).toFixed(2).replace('.00', ''), formatSaleNumber: value => String(value || 1).padStart(6, '0') },
        'preferences.js': { getPreferences: () => ({ printing: { format } }) },
        'preferences-domain': { ticketWidth: value => value === 'ticket58' ? 58 : value === 'ticket80' ? 80 : null }
    };
    const renderer = new vm.SourceTextModule(fs.readFileSync(path.resolve(__dirname, '../app/shared/sale-note/renderer.js'), 'utf8'), { context });
    await renderer.link(specifier => {
        const entry = dependencies[Object.keys(dependencies).find(key => specifier.includes(key))];
        return new vm.SyntheticModule(Object.keys(entry), function () {
            for (const [key, value] of Object.entries(entry)) this.setExport(key, value);
        }, { context });
    });
    await renderer.evaluate();
    return { renderer: renderer.namespace, area, styles, properties, frames, prints: () => prints };
}

const sale = {
    numero: '7', cliente: 'Samuel <prueba>', telefono: '77755897', direccion: 'Caranavi & centro',
    vendedorNombre: 'Cajero', fechaTexto: '03/10/2026, 10:30', metodoPago: 'Transferencia',
    subtotal: 45, descuento: 2.5, total: 42.5,
    items: [
        { codigo: '010', nombre: 'Motorreductor <robot>', cantidad: 2, precio: 20, subtotal: 40 },
        { codigo: '011', nombre: 'Cable', cantidad: 1, precio: 5, subtotal: 5 }
    ]
};

for (const format of ['letter', 'ticket58', 'ticket80']) {
    test(`${format} uses the compact customer, product and totals layout without payment details`, async () => {
        const h = await harness(format);
        h.renderer.renderSaleNote(sale, h.area);
        for (const name of ['note-logo', 'note-brand', 'note-box', 'note-client', 'note-summary', 'note-totals', 'note-footer', 'note-whatsapp-icon', 'note-location-icon']) {
            assert(h.area.innerHTML.includes(name), name);
        }
        assert.equal(h.area.dataset.printFormat, format);
        for (const text of ['000007', 'Samuel &lt;prueba&gt;', 'Caranavi &amp; centro', 'Motorreductor &lt;robot&gt;', '42.50 Bs']) {
            assert(h.area.innerHTML.includes(text), text);
        }
        assert(!h.area.innerHTML.includes('class="ticket-heading"'));
        assert(!h.area.innerHTML.includes('note-payment'));
        assert(!h.area.innerHTML.includes('Transferencia'));
        assert(!h.area.innerHTML.includes('METODO DE PAGO'));
        assert.equal((h.area.innerHTML.match(/Productos SXMY/g) || []).length, 1);
    });
}

test('tickets use short unit, quantity and total headings while preserving numbers and codes', async () => {
    const h = await harness();
    for (const format of ['ticket58', 'ticket80']) {
        h.renderer.renderSaleNote(sale, h.area, { format });
        assert.equal((h.area.innerHTML.match(/class="note-ticket-item"/g) || []).length, 2);
        const headings = [...h.area.innerHTML.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(match => match[1]);
        assert.deepEqual(headings, ['Nombre', 'Uni.', 'Cant.', 'Total']);
        assert(h.area.innerHTML.includes('class="note-item-number">2.</span>'));
        assert(h.area.innerHTML.includes('Cod. 011'));
        assert(h.area.innerHTML.includes('class="note-ticket-unit-price">20</td>'));
        assert(h.area.innerHTML.includes('aria-label="Precio unitario en Bs"'));
        assert(h.area.innerHTML.includes('class="note-ticket-quantity">2</td>'));
        assert(h.area.innerHTML.includes('class="note-item-subtotal">40</td>'));
        assert(h.area.innerHTML.includes('note-table-ticket'));
        assert(!h.area.innerHTML.includes('note-ticket-values'));
    }
});

test('letter columns follow the reference while preserving code, price and quantity', async () => {
    const h = await harness();
    h.renderer.renderSaleNote(sale, h.area);
    const headings = [...h.area.innerHTML.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]);
    assert.deepEqual(headings, ['N', 'COD.', 'DETALLE', 'P. UNITARIO', 'CANT.', 'SUBTOTAL']);
    assert.match(h.area.innerHTML, /<td>Motorreductor &lt;robot&gt;<\/td>\s*<td>20 Bs<\/td><td>2<\/td><td>40 Bs<\/td>/);
});

test('reference layout shows note number, date and seller only once in the information band', async () => {
    const h = await harness();
    for (const format of ['letter', 'ticket58', 'ticket80']) {
        h.renderer.renderSaleNote(sale, h.area, { format });
        assert(h.area.innerHTML.includes('class="note-details"'));
        assert.equal(h.area.innerHTML.split('000007').length - 1, 1);
        assert.equal(h.area.innerHTML.split(sale.fechaTexto).length - 1, 1);
        assert.equal(h.area.innerHTML.split('Cajero').length - 1, 1);
        assert(h.area.innerHTML.indexOf('class="note-seller"') < h.area.innerHTML.indexOf('class="note-table'));
    }
});

test('tickets use compact seller labels and 58 mm gives the location its own two lines', async () => {
    const h = await harness();
    h.renderer.renderSaleNote(sale, h.area, { format: 'ticket58' });
    assert(h.area.innerHTML.includes('<span>Vendedor</span>'));
    assert(h.area.innerHTML.includes('Caranavi<br>Frente Colegio Kennedy'));
    for (const format of ['letter', 'ticket80']) {
        h.renderer.renderSaleNote(sale, h.area, { format });
        assert(h.area.innerHTML.includes('Caranavi - Frente Colegio Kennedy'));
        assert(!h.area.innerHTML.includes('<br>'));
    }
    assert(h.area.innerHTML.includes('<span>Vendedor</span>'));
    h.renderer.renderSaleNote(sale, h.area, { format: 'letter' });
    assert(h.area.innerHTML.includes('<span>Atendido por</span>'));
});

test('paper width and dynamic page height reset when switching back to letter', async () => {
    const h = await harness();
    for (const [format, width] of [['ticket58', 58], ['ticket80', 80]]) {
        h.renderer.renderSaleNote(sale, h.area, { format });
        assert.equal(h.properties.get('--ticket-width'), `${width}mm`);
        assert.match(h.styles.get('salePrintPageStyle').textContent, new RegExp(`size: ${width}mm 162mm`));
    }
    h.renderer.renderSaleNote(sale, h.area, { format: 'letter' });
    assert(!h.styles.has('salePrintPageStyle'));
    assert(!h.properties.has('--ticket-width'));
    assert(!h.area.innerHTML.includes('note-ticket'));
});

test('blank optional fields and zero totals remain valid in all formats', async () => {
    const h = await harness();
    for (const format of ['letter', 'ticket58', 'ticket80']) {
        h.renderer.renderSaleNote({ ...sale, cliente: 'Cliente', direccion: '', telefono: '', subtotal: 0, total: 0 }, h.area, { format });
        assert(!h.area.innerHTML.includes('class="note-client"'));
        assert(!h.area.innerHTML.includes('is-empty'));
        assert(h.area.innerHTML.includes('<span>0 Bs</span>'));
    }
    h.renderer.renderSaleNote(sale, h.area, { format: 'invalid' });
    assert.equal(h.area.dataset.printFormat, 'letter');
});

test('zero discounts omit redundant summary lines without modifying the saved sale', async () => {
    const h = await harness();
    const value = { ...sale, descuento: 0 };
    const before = JSON.stringify(value);
    for (const format of ['letter', 'ticket58', 'ticket80']) {
        h.renderer.renderSaleNote(value, h.area, { format });
        assert(!h.area.innerHTML.includes('<span>Descuento</span>'));
        assert(!h.area.innerHTML.includes('<span>Subtotal</span>'));
        assert(h.area.innerHTML.includes('<strong>TOTAL</strong><span>42.50 Bs</span>'));
    }
    assert.equal(JSON.stringify(value), before);
    assert.equal(value.metodoPago, 'Transferencia');
});

test('provided customer fields appear independently without blank placeholders', async () => {
    const h = await harness('ticket58');
    h.renderer.renderSaleNote({ ...sale, cliente: '', telefono: '777', direccion: '', fechaTexto: '', vendedorNombre: '' }, h.area);
    assert(h.area.innerHTML.includes('<strong>Tel.:</strong> <span>777</span>'));
    assert(!h.area.innerHTML.includes('<strong>Cliente:</strong>'));
    assert(!h.area.innerHTML.includes('<strong>Direccion:</strong>'));
    assert(!h.area.innerHTML.includes('class="note-date"'));
    assert(!h.area.innerHTML.includes('class="note-seller"'));
});

test('short tickets do not reserve an eighty millimetre blank tail', async () => {
    const h = await harness('ticket58', 100);
    h.renderer.renderSaleNote(sale, h.area);
    assert.match(h.styles.get('salePrintPageStyle').textContent, /size: 58mm 35mm/);
});

test('printing waits for rendering and uses the selected ticket format', async () => {
    const h = await harness('ticket80');
    h.renderer.printSaleNote(sale, h.area);
    assert.equal(h.area.dataset.printFormat, 'ticket80');
    assert.equal(h.prints(), 0);
    h.frames.shift()();
    assert.equal(h.prints(), 0);
    await h.frames.shift()();
    assert.equal(h.prints(), 1);
});

test('printing waits for the logo and still works if an image fails to load', async () => {
    let loaded = false;
    const images = [{ decode: async () => { loaded = true; } }, { decode: async () => { throw new Error('Missing image'); } }];
    const h = await harness('ticket80', 600, images);
    h.renderer.printSaleNote(sale, h.area);
    h.frames.shift()();
    assert.equal(loaded, false);
    assert.equal(h.prints(), 0);
    await h.frames.shift()();
    assert.equal(loaded, true);
    assert.equal(h.prints(), 1);
});
