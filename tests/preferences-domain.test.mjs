import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPreferences, normalizePreferences, patchPreferences, ticketWidth } from '../app/modules/configuracion/preferences-domain.js';

test('preferences reject unknown values and keep independent defaults', () => {
    const first = defaultPreferences(); first.products.showDisabled = true;
    assert.equal(defaultPreferences().products.showDisabled, false);
    const settings = normalizePreferences({ general: { theme: 'unsafe', sounds: 'false' }, products: { view: 'unknown', showPriceHistory: true }, printing: { format: '80mm; color:red' }, admin: true });
    assert.equal(settings.general.theme, 'light');
    assert.equal(settings.general.sounds, true);
    assert.equal(settings.products.view, 'table');
    assert.equal(settings.products.showPriceHistory, true);
    assert.equal(settings.printing.format, 'letter');
    assert.equal('admin' in settings, false);
});

test('partial changes preserve other groups and only supported print widths are accepted', () => {
    const settings = patchPreferences(defaultPreferences(), { general: { theme: 'dark' }, printing: { format: 'ticket58' } });
    const next = patchPreferences(settings, { products: { view: 'cards', onlyNoImage: true } });
    assert.equal(next.general.theme, 'dark');
    assert.equal(next.products.view, 'cards');
    assert.equal(next.products.onlyNoImage, true);
    assert.equal(next.printing.format, 'ticket58');
    assert.equal(ticketWidth('ticket58'), 58);
    assert.equal(ticketWidth('ticket80'), 80);
    assert.equal(ticketWidth('letter'), null);
    assert.equal(ticketWidth('unsupported'), null);
});
