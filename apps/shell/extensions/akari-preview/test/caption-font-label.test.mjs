import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captionFontLabel, captionToolbarFontLabel } from '../lib/common/caption-font-label.js';
import { CAPTION_FONT_FAMILY } from '../lib/common/caption-visual-contract.js';

test('caption toolbar shows the first rendered font for each caption language', async () => {
    const source = await readFile(new URL('../src/browser/preview-context-bar.ts', import.meta.url), 'utf8');
    assert.match(source, /captionToolbarFontLabel\(this\.state\?\.item\?\.captionLocale, style\.fontFamily\)/u);
    assert.equal(captionToolbarFontLabel('en'), 'Noto Sans');
    assert.equal(captionToolbarFontLabel('en', CAPTION_FONT_FAMILY), 'Noto Sans');
    assert.equal(captionToolbarFontLabel('en', 'AKARI Noto Sans'), 'Noto Sans');
    assert.equal(captionToolbarFontLabel('en', 'AKARI Custom Face'), 'AKARI Custom Face');
    assert.equal(captionToolbarFontLabel('ja'), 'Noto Sans JP');
    assert.equal(captionToolbarFontLabel('ja', CAPTION_FONT_FAMILY), CAPTION_FONT_FAMILY);
    assert.equal(captionToolbarFontLabel('ja', 'AKARI Custom Face'), 'AKARI Custom Face');
    assert.equal(captionFontLabel('en'), 'Noto Sans');
});
