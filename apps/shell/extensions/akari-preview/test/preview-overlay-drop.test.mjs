import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { previewOverlayKind } from '../lib/common/preview-overlay-drop.js';
import { previewDropBox } from '../lib/common/preview-drop-geometry.js';

const require = createRequire(import.meta.url);
const { PreviewLibraryDrop } = require('../lib/browser/preview-library-drop.js');

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

test('同じ 3D ドロップを複数の出力層が受けても一言は 1 回', async () => {
    const session = { kind: 'scene3d', category: 'scene3d', key: 'scene3d/phone' };
    const geometry = { rect: { x: 0, y: 0, width: 100, height: 100 }, time: 3,
        output: { width: 1280, height: 720 } };
    const notices = [];
    const receiver = () => ({ active: session, dragSession: session, geometry,
        fullscreen: () => false, editUri: () => 'file:///edit.json',
        queryGeometry: async () => geometry,
        clear() { this.active = undefined; },
        messages: { info: message => notices.push(message) } });
    const event = { clientX: 50, clientY: 50,
        dataTransfer: { getData: () => JSON.stringify(session) },
        preventDefault() {}, stopPropagation() {} };
    const first = receiver(), second = receiver();
    await Promise.all([
        PreviewLibraryDrop.prototype.drop.call(first, event),
        PreviewLibraryDrop.prototype.drop.call(first, event),
        PreviewLibraryDrop.prototype.drop.call(second, event)
    ]);
    assert.deepEqual(notices, ['3D は近日対応します。']);
});
