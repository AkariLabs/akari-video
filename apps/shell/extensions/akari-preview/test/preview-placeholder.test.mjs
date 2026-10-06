import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { previewPlaceholderHtml } = require('../lib/common/preview-placeholder.js');

test('placeholder shows a dark stage, loading state and a formatted output time', () => {
    const html = previewPlaceholderHtml({ width: 1920, height: 1080, timeSeconds: 125.26 });
    assert.match(html, /^<style>/u);
    assert.doesNotMatch(html, /<html|<body|<!doctype/iu);
    assert.match(html, /background: #000/u);
    assert.match(html, /aspect-ratio: 1920 \/ 1080/u);
    assert.match(html, /読み込み中 · 2:05\.3/u);
    assert.doesNotMatch(html, /<img/u);
});

test('placeholder uses 16:9 for invalid geometry and embeds only a local JPEG data URL', () => {
    assert.match(previewPlaceholderHtml({ width: 0, height: -1 }), /aspect-ratio: 16 \/ 9/u);
    assert.match(previewPlaceholderHtml({ imageUrl: 'data:image/jpeg;base64,AA==' }), /<img src="data:image\/jpeg;base64,AA=="/u);
    assert.doesNotMatch(previewPlaceholderHtml({ imageUrl: 'https://example.invalid/poster.jpg' }), /<img/u);
});

test('placeholder escapes HTML in interpolated image URL', () => {
    const html = previewPlaceholderHtml({ imageUrl: 'data:image/jpeg;base64,"<script>alert(1)</script>' });
    assert.doesNotMatch(html, /<script>/u);
    assert.match(html, /&quot;&lt;script&gt;/u);
});
