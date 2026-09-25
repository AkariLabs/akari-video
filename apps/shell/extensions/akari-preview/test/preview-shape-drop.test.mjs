import assert from 'node:assert/strict';
import test from 'node:test';
import { previewShapeDropBox, previewShapePayload } from '../lib/common/preview-shape-drop.js';

test('図形の payload を絞り込み、縦横比は正の有限値だけ使う', () => {
    assert.equal(previewShapePayload({ kind: 'shape', preset: '' }), undefined);
    assert.deepEqual(previewShapePayload({ kind: 'shape', preset: 'star-5', name: '星', vb: [100, 95] }),
        { kind: 'shape', preset: 'star-5', name: '星', vb: [100, 95] });
    assert.deepEqual(previewShapePayload({ kind: 'shape', preset: 'line', vb: [0, 20] }),
        { kind: 'shape', preset: 'line' });
});

test('図形の仮枠は長い辺が出力の短辺の 1/3', () => {
    const output = { width: 1920, height: 1080 };
    assert.deepEqual(previewShapeDropBox(output, [100, 95]), { width: 360, height: 342 });
    assert.deepEqual(previewShapeDropBox(output, [100, 20]), { width: 360, height: 72 });
    assert.deepEqual(previewShapeDropBox(output, [20, 100]), { width: 72, height: 360 });
});
