import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { readAkariMenuFocusArgs, isAkariMenuSectionId, AKARI_MENU_PULSE_MS } = require('../lib/common/menu-focus.js');

test('omitted and empty arguments open the menu without a section', () => {
    for (const raw of [undefined, null, {}]) {
        assert.deepEqual(readAkariMenuFocusArgs(raw), {});
    }
});

test('valid section, pulse and exact skill names are preserved', () => {
    for (const raw of [
        { section: 'open' },
        { section: 'skills' },
        { section: 'skills', pulse: true, skill: 'x' },
        { section: 'open', pulse: false },
        { section: 'skills', skill: 'a"[b]' },
        { pulse: true }
    ]) {
        assert.deepEqual(readAkariMenuFocusArgs(raw), raw);
    }
});

test('invalid arguments are rejected', () => {
    for (const raw of [
        { section: 'export' }, { section: 'bogus' }, { section: null },
        { skill: 'x' }, { section: 'open', skill: 'x' },
        { pulse: 'yes' }, { pulse: null }, { section: 'skills', skill: 1 },
        'not-an-object', 1, true
    ]) {
        assert.equal(readAkariMenuFocusArgs(raw), undefined);
    }
});

test('only open and skills are section IDs', () => {
    for (const value of ['open', 'skills']) {
        assert.equal(isAkariMenuSectionId(value), true);
    }
    for (const value of ['export', 'bogus', '', undefined, null, 1, {}]) {
        assert.equal(isAkariMenuSectionId(value), false);
    }
    assert.equal(AKARI_MENU_PULSE_MS, 1600);
});
