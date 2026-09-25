import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewLiveValues } from '../lib/common/preview-live-values.js';

test('live preview accepts one item and a finite transform subset', () => {
    assert.deepEqual(previewLiveValues({ id: 'shape-1', values: { x: 12, rotate: 30, opacity: 0.5, y: Infinity } }),
        { id: 'shape-1', values: { x: 12, rotate: 30 }, clear: false });
    assert.deepEqual(previewLiveValues({ id: 'shape-1', clear: true }),
        { id: 'shape-1', values: {}, clear: true });
    assert.equal(previewLiveValues({ id: '', values: { x: 12 } }), undefined);
    assert.equal(previewLiveValues({ id: 'shape-1', values: { x: NaN } }), undefined);
});
