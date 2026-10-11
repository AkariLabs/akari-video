import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { selectionScrollTop } = require('../lib/browser/daihon/selection-reveal.js');

test('visible row stays put, including after a manual scroll', () => {
    assert.equal(selectionScrollTop(120, 150, 100, 300, 400), null);
});

test('the inspector reduces the viewport and an obscured last row is centered above it', () => {
    // A 120-row script at 24 px per row: the final row is behind a 140 px inspector.
    assert.equal(selectionScrollTop(2860, 2880, 2500, 2740, 2500), 2750);
    assert.equal(selectionScrollTop(2610, 2630, 2500, 2740, 2500), null);
});

test('a row above the viewport scrolls up and a collapsed viewport does nothing', () => {
    assert.equal(selectionScrollTop(80, 100, 200, 400, 500), 290);
    assert.equal(selectionScrollTop(80, 100, 200, 200, 500), null);
});
