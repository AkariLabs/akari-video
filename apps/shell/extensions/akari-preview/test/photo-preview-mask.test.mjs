import test from 'node:test';
import assert from 'node:assert/strict';
import { composePhotoPreviewMask } from '../lib/common/photo-preview-mask.js';
import { composeStillMask } from '../../../../../packages/frame-engine/dist/mask/compose-still-mask.js';

test('DOM photo mask matches the frame evaluator before crop, flip, and frame', () => {
    const base = new Uint8Array(12 * 8).fill(255);
    const alpha = new Uint8Array(12 * 8).fill(255);
    alpha[0] = 0;
    const strokes = [
        { mode: 'erase', points: [[.3, .4], [.8, .4]], size: .25, hardness: .6 },
        { mode: 'restore', points: [[.45, .4]], size: .15, hardness: 1 }
    ];
    assert.deepEqual(composePhotoPreviewMask(base, 12, 8, strokes, alpha),
        composeStillMask(base, 12, 8, strokes, alpha));
    assert.equal(composePhotoPreviewMask(null, 12, 8, strokes, alpha)[0], 255);
});
