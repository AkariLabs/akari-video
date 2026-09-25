import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitPhotoInstance } from '../lib/browser/inspector/photo-instance-hit.js';

test('preview source point chooses the smallest already computed instance', () => {
    const masks = [
        { id: 'all', width: 2, height: 2, pixels: Uint8Array.from([255, 255, 0, 0]), area: 2 },
        { id: 'person-1', width: 2, height: 2, pixels: Uint8Array.from([255, 0, 0, 0]), area: 1 }
    ];
    assert.equal(hitPhotoInstance([0.1, 0.1], masks), 'person-1');
    assert.equal(hitPhotoInstance([0.8, 0.1], masks), 'all');
    assert.equal(hitPhotoInstance([0.8, 0.8], masks), null);
    assert.equal(hitPhotoInstance([-0.1, 0.1], masks), null);
});

test('inverse candidate hits the background only', () => {
    const mask = { id: 'background', width: 2, height: 1, pixels: Uint8Array.from([255, 0]), invert: true };
    assert.equal(hitPhotoInstance([0.1, 0.5], [mask]), null);
    assert.equal(hitPhotoInstance([0.8, 0.5], [mask]), 'background');
});
