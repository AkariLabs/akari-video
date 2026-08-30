import assert from 'node:assert/strict';
import test from 'node:test';

import { filterRenderableFrameEngineLayers } from '../lib/common/frame-engine-layer-supply.js';

test('frame-engine は src の無い deferred telop を warning once でスキップする', () => {
    const warnings = [];
    const media = { id: 'pip', kind: 'video', src: 'http://127.0.0.1/media/pip', t: 1, duration: 4 };
    const layers = filterRenderableFrameEngineLayers([
        media,
        { id: 'chapter', kind: 'baked', deferredTelop: true, t: 1, duration: 3 },
        { id: 'chapter-2', kind: 'baked', deferredTelop: true, t: 5, duration: 2 }
    ], message => warnings.push(message));

    assert.deepEqual(layers, [media]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /deferred telop/u);
});

test('frame-engine は未知の src 無し layer も種別ごとに 1 回だけ警告してスキップする', () => {
    const warnings = [];
    const layers = filterRenderableFrameEngineLayers([
        { id: 'future-a', kind: 'future', t: 0, duration: 1 },
        { id: 'future-b', kind: 'future', t: 1, duration: 1 },
        null
    ], message => warnings.push(message));

    assert.deepEqual(layers, []);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /future/u);
    assert.match(warnings[1], /invalid/u);
});
