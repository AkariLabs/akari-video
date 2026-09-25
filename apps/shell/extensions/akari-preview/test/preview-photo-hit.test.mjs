import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { previewPhotoSourcePoint, frontmostPreviewHit } from '../lib/common/preview-photo-hit.js';

const size = { width: 400, height: 200 };
const output = { width: 1000, height: 500 };
const crop = { x: 0, y: 0, w: 1, h: 1 };
const transform = { x: 0, y: 0, scale: 1, rotate: 0 };

test('photo hit uses visible source pixels and passes through outside or transparent parts', () => {
    const pixel = previewPhotoSourcePoint(size, output, transform, crop, { x: 500, y: 250 });
    assert.deepEqual(pixel, { x: 200, y: 100 });
    assert.equal(previewPhotoSourcePoint(size, output, transform, crop, { x: 800, y: 250 }), null);
    const alpha = new Uint8Array(size.width * size.height).fill(255);
    alpha[pixel.y * size.width + pixel.x] = 0;
    const hit = alpha[pixel.y * size.width + pixel.x] > 16 ? 'photo' : null;
    assert.equal(frontmostPreviewHit([{ element: 'video', z: 1, order: 0 },
        ...(hit ? [{ element: hit, z: 3, order: 1 }] : [])]), 'video');
});

test('top photo wins and edge stretch keeps the inverse hit region aligned', () => {
    assert.equal(frontmostPreviewHit([
        { element: 'video', z: 1, order: -1 },
        { element: 'back photo', z: 3, order: 0 },
        { element: 'front photo', z: 3, order: 1 }
    ]), 'front photo');
    assert.deepEqual(previewPhotoSourcePoint(size, output,
        { ...transform, scaleX: 2, scaleY: 1 }, crop, { x: 850, y: 250 }), { x: 375, y: 100 });
    assert.equal(previewPhotoSourcePoint(size, output,
        { ...transform, scaleX: 2, scaleY: 1 }, crop, { x: 901, y: 250 }), null);
});

test('flipped and rounded photo samples the displayed source pixel', () => {
    assert.deepEqual(previewPhotoSourcePoint(size, output, transform, crop,
        { x: 600, y: 250 }, { h: true }), { x: 100, y: 100 });
    assert.equal(previewPhotoSourcePoint(size, output, transform, crop,
        { x: 301, y: 151 }, undefined, 100), null);
});

test('preview shows brush mode and a sized circular cursor', () => {
    const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(source, /layerVideo\.readyState < HTMLMediaElement\.HAVE_METADATA\s*&& !\(frameEngineMediaIdle && layer\.isImage === true\)/u);
    assert.match(source, /消しゴム中 — Esc で終わる/u);
    assert.match(source, /photoBrushCursor\.style\.width = diameter/u);
    assert.match(source, /window\.akari\.reportPhotoStroke\(photoBrush\.itemId/u);
});
