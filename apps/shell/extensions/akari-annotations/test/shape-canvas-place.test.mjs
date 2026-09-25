import assert from 'node:assert/strict';
import test from 'node:test';
import { placePreviewShapeInCanvas } from '../lib/browser/shape-canvas-place.js';

const document = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
    tracks: [{ id: 'v1', lane: 'visual', items: [{ id: 'g-1', at: 300, duration: 150,
        source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed', background: { type: 'none' } } },
        items: [] }] }, { id: 'a1', lane: 'audio', items: [] }] });
const shape = at => ({ id: 'shape-1', at, duration: 150, transform: { x: 200, y: 100 },
    source: { kind: 'shape', shape: 'line', params: { width: 360, height: 72 } } });

test('プレビューからの図形だけキャンバスの子へ置き、相対時刻と尺を合わせる', () => {
    const before = document();
    const after = placePreviewShapeInCanvas(before, shape(360), true, false);
    assert.ok(after);
    assert.equal(before.tracks[0].items[0].items.length, 0);
    const child = after.tracks[0].items[0].items[0];
    assert.equal(child.at, 60);
    assert.equal(child.duration, 90);
    assert.deepEqual(child.transform, { x: 200, y: 100 });
    assert.equal(after.tracks[1].id, 'a1');
});

test('⌥・押して置く・キャンバスの区間外では従来の段へ委ねる', () => {
    assert.equal(placePreviewShapeInCanvas(document(), shape(360), true, true), undefined);
    assert.equal(placePreviewShapeInCanvas(document(), shape(360), false, false), undefined);
    assert.equal(placePreviewShapeInCanvas(document(), shape(450), true, false), undefined);
});
