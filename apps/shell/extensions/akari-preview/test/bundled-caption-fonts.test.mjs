import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { BUNDLED_CAPTION_FONT_FACES, bundledCaptionFontFaceCss } = require('../lib/common/bundled-caption-fonts.js');
const root = resolve(import.meta.dirname, '../../../../../');

test('棚の family 名と同梱フォントの実体が 8 書体すべて対応する', () => {
    const families = new Set();
    for (const face of BUNDLED_CAPTION_FONT_FACES) {
        const meta = JSON.parse(readFileSync(resolve(root, 'catalog/font', face.id, 'meta.json'), 'utf8'));
        assert.equal(face.family, meta.title.replace(/（.*$/, '').trim());
        assert.ok(existsSync(resolve(root, 'assets/font', face.id, face.file)), `${face.id}/${face.file}`);
        families.add(face.family);
    }
    assert.equal(families.size, 8);
});

test('webview の CSS は各 family と配信 URL を @font-face に使う', () => {
    const css = bundledCaptionFontFaceCss(BUNDLED_CAPTION_FONT_FACES.map(face => ({ ...face,
        url: `http://127.0.0.1:4567/static/hash/${face.id}.ttf` })));
    for (const face of BUNDLED_CAPTION_FONT_FACES) {
        assert.ok(css.includes(`font-family: "${face.family}"`));
        assert.ok(css.includes(`/${face.id}.ttf`));
    }
    assert.equal((css.match(/@font-face/g) ?? []).length, BUNDLED_CAPTION_FONT_FACES.length);
});
