import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPreviewLiveOverride } from '../lib/common/preview-live-override.js';

test('partial live values follow one item and clear on cancel or commit', () => {
    const x = nextPreviewLiveOverride(undefined, 'item:a', 'x', 480);
    assert.deepEqual(nextPreviewLiveOverride(x, 'item:a', 'rotate', 30),
        { key: 'item:a', values: { x: 480, rotate: 30 } });
    assert.deepEqual(nextPreviewLiveOverride(x, 'item:b', 'x', 50),
        { key: 'item:b', values: { x: 50 } });
    assert.equal(nextPreviewLiveOverride(x, 'item:a', 'x', 300, true), undefined);
    assert.deepEqual(nextPreviewLiveOverride(x, 'item:a', 'x', Infinity), x);
});
