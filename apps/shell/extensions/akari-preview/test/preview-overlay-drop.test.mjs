import { setLanguage } from '@akari-video/i18n';
import { after } from 'node:test';
setLanguage('ja');
after(() => setLanguage(undefined));
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

test('同じ 3D ドロップを複数の出力層が受けても配置は 1 回', async () => {
    const session = { kind: 'scene3d', category: 'scene3d', key: 'scene3d/phone' };
    const geometry = { rect: { x: 0, y: 0, width: 100, height: 100 }, time: 3,
        output: { width: 1280, height: 720 } };
    const calls = [];
    const receiver = () => ({ active: session, dragSession: session, geometry,
        pendingGeometryRequests: new Set(),
        fullscreen: () => false, editUri: () => 'file:///edit.json',
        queryGeometry: async () => geometry,
        clear() { this.active = undefined; },
        commands: { executeCommand: async (id, request) => {
            calls.push([id, request]);
            return id === 'akari.timeline.addOverlayAtOutputPoint' ? 'overlay-1' : undefined;
        } } });
    const event = { clientX: 50, clientY: 50,
        dataTransfer: { getData: () => JSON.stringify(session) },
        preventDefault() {}, stopPropagation() {} };
    const first = receiver(), second = receiver();
    await Promise.all([
        PreviewLibraryDrop.prototype.drop.call(first, event),
        PreviewLibraryDrop.prototype.drop.call(first, event),
        PreviewLibraryDrop.prototype.drop.call(second, event)
    ]);
    assert.equal(calls.filter(([id]) => id === 'akari.timeline.addOverlayAtOutputPoint').length, 1);
    assert.deepEqual(calls.filter(([id]) => id === 'akari.timeline.focusItem'), [
        ['akari.timeline.focusItem', { itemId: 'overlay-1', reveal: true, pulse: true }]
    ]);
    assert.ok(calls.findIndex(([id]) => id === 'akari.timeline.focusItem')
        > calls.findIndex(([id]) => id === 'akari.preview.seekOutput'));
});

test('オーバーレイは落下点とキャンバス内外の指定を配置コマンドへ渡す', async () => {
    const payload = { kind: 'overlay', category: 'overlay', key: 'overlay/lower-third-clean' };
    const geometry = { rect: { x: 0, y: 0, width: 100, height: 100 }, time: 3,
        output: { width: 1280, height: 720 } };
    const calls = [];
    const receiver = { active: payload, geometry, fullscreen: () => false,
        pendingGeometryRequests: new Set(),
        editUri: () => 'file:///edit.json', queryGeometry: async () => geometry,
        clear() { this.active = undefined; },
        commands: { executeCommand: async (id, request) => {
            calls.push([id, request]);
            return id === 'akari.timeline.addOverlayAtOutputPoint' ? 'overlay-1' : undefined;
        } } };
    const event = altKey => ({ clientX: 25, clientY: 50, altKey,
        dataTransfer: { getData: () => JSON.stringify(payload) },
        preventDefault() {}, stopPropagation() {} });
    await PreviewLibraryDrop.prototype.drop.call(receiver, event(false));
    await PreviewLibraryDrop.prototype.drop.call(receiver, event(true));
    assert.deepEqual(calls.filter(([id]) => id === 'akari.timeline.addOverlayAtOutputPoint').map(([, request]) => request), [
        { key: payload.key, t: 3, center: { x: 320, y: 360 }, editUri: 'file:///edit.json', outsideCanvas: false },
        { key: payload.key, t: 3, center: { x: 320, y: 360 }, editUri: 'file:///edit.json', outsideCanvas: true }
    ]);
    assert.equal(calls.filter(([id]) => id === 'akari.preview.seekOutput').length, 2);
});

test('素材がドラッグ中に 3D に当たれば待たずに画面へ適用する', async () => {
    const payload = { kind: 'video', relativePath: 'assets/video/sample.mp4' };
    const geometry = { rect: { x: 0, y: 0, width: 100, height: 100 }, time: 3,
        output: { width: 1280, height: 720 } };
    const calls = [];
    const receiver = { active: { ...payload, source: 'material' }, geometry,
        hoverHit: { kind: 'item', id: 'item-1' }, pendingGeometryRequests: new Set(),
        fullscreen: () => false, editUri: () => 'file:///edit.json', queryGeometry: async () => geometry,
        queryHit: () => assert.fail('落下時に当たり判定を待たない'),
        clear() { this.active = undefined; },
        commands: { executeCommand: async (id, request) => { calls.push([id, request]); } } };
    const event = { clientX: 50, clientY: 50, altKey: false,
        dataTransfer: { getData: type => type === 'application/x-akari-material' ? JSON.stringify(payload) : '' },
        preventDefault() {}, stopPropagation() {} };
    await PreviewLibraryDrop.prototype.drop.call(receiver, event);
    assert.deepEqual(calls, [['akari.timeline.applyLibraryItem', {
        payload: { ...payload, source: 'material', category: 'video', in: undefined, out: undefined },
        target: { kind: 'item', id: 'item-1' },
        editUri: 'file:///edit.json'
    }]]);
});

test('drop の直後に dragend が当たり判定を消しても、3D の画面へ適用する', async () => {
    const payload = { kind: 'video', relativePath: 'assets/video/sample.mp4' };
    const geometry = { rect: { x: 0, y: 0, width: 100, height: 100 }, time: 3,
        output: { width: 1280, height: 720 } };
    const calls = [];
    const receiver = { active: { ...payload, source: 'material' }, geometry,
        hoverHit: { kind: 'item', id: 'item-1' }, pendingGeometryRequests: new Set(),
        fullscreen: () => false, editUri: () => 'file:///edit.json',
        // ブラウザは drop と同じタスクで dragend を送る。最初の await の間に当たり判定が消える
        queryGeometry: async function () { this.hoverHit = undefined; this.active = undefined; return geometry; },
        queryHit: () => assert.fail('落下時に当たり判定を待たない'),
        clear() { this.active = undefined; this.hoverHit = undefined; },
        commands: { executeCommand: async (id, request) => { calls.push([id, request]); } } };
    const event = { clientX: 50, clientY: 50, altKey: false,
        dataTransfer: { getData: type => type === 'application/x-akari-material' ? JSON.stringify(payload) : '' },
        preventDefault() {}, stopPropagation() {} };
    await PreviewLibraryDrop.prototype.drop.call(receiver, event);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'akari.timeline.applyLibraryItem');
    assert.deepEqual(calls[0][1].target, { kind: 'item', id: 'item-1' });
});
