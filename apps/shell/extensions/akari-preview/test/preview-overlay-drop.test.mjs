import assert from 'node:assert/strict';
import test from 'node:test';
import { previewOverlayKind } from '../lib/common/preview-overlay-drop.js';
import { previewDropBox } from '../lib/common/preview-drop-geometry.js';

test('ペイロードの種別とカテゴリが一致したときだけ受ける', () => {
    assert.equal(previewOverlayKind({ kind: 'overlay', category: 'overlay', key: 'overlay/lower-third-clean' }), 'overlay');
    assert.equal(previewOverlayKind({ kind: 'scene3d', category: 'scene3d', key: 'scene3d/phone' }), 'scene3d');
    assert.equal(previewOverlayKind({ kind: 'overlay', category: 'still', key: 'still/a' }), undefined);
    assert.equal(previewOverlayKind({ kind: 'overlay', category: 'overlay' }), undefined);
});

test('仮枠は出力幅の 4/10 で縦横比を保つ', () => {
    assert.deepEqual(previewDropBox({ width: 1920, height: 1080 }, undefined, 0.4), { width: 768, height: 432 });
    assert.deepEqual(previewDropBox({ width: 1920, height: 1080 }, { width: 4, height: 3 }, 0.4),
        { width: 768, height: 576 });
});
