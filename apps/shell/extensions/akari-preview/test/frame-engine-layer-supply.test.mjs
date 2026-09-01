import assert from 'node:assert/strict';
import test from 'node:test';

import { filterRenderableFrameEngineLayers } from '../lib/common/frame-engine-layer-supply.js';

test('frame-engine は src の無い deferred telop を総尺計算のため保持する', () => {
    const warnings = [];
    const media = { id: 'pip', kind: 'video', src: 'http://127.0.0.1/media/pip', t: 1, duration: 4 };
    const deferredTelop = { id: 'chapter', kind: 'baked', deferredTelop: true, t: 0, duration: 8 };
    const future = { id: 'future', kind: 'future', t: 8, duration: 2 };
    const layers = filterRenderableFrameEngineLayers([
        media,
        deferredTelop,
        future
    ], message => warnings.push(message));

    assert.deepEqual(layers, [media, deferredTelop, future]);
    assert.deepEqual(warnings, []);
});

test('frame-engine は非 object layer だけを 1 回の警告付きでスキップする', () => {
    const warnings = [];
    const valid = { id: 'valid', kind: 'video', src: 'media.mp4', t: 0, duration: 1 };
    const layers = filterRenderableFrameEngineLayers([
        null,
        42,
        undefined,
        'invalid',
        valid
    ], message => warnings.push(message));

    assert.deepEqual(layers, [valid]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /invalid/u);
});
