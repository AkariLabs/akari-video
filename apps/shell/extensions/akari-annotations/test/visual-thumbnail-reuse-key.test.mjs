import assert from 'node:assert/strict';
import test from 'node:test';
import { visualThumbnailReuseKey } from '../lib/browser/visual-thumbnail-reuse-key.js';

const fixture = () => ({ output: { width: 1920, height: 1080 }, sources: [
    { id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }
], tracks: [{ id: 'main', lane: 'visual', items: [
    { id: 'a-1', at: 0, duration: 60, source: { kind: 'media', src: 'a', in: 0, out: 2 } },
    { id: 'b-1', at: 60, duration: 60, source: { kind: 'media', src: 'b', in: 0, out: 2 } }
] }] });
const key = (doc, id, revision = 0) => visualThumbnailReuseKey(doc, id, null, '120px', '24px', 10, revision, 0);

test('同じ素材・区間・寸法なら位置移動や別クリップの変更で描き直さない', () => {
    const doc = fixture();
    const first = key(doc, 'a-1');
    assert.equal(key(structuredClone(doc), 'a-1'), first);
    doc.tracks[0].items[0].at = 90;
    doc.tracks[0].items[1].source.in = 1;
    assert.equal(key(doc, 'a-1'), first);
    assert.notEqual(key(doc, 'b-1'), key(fixture(), 'b-1'));
});

test('区間・寸法・素材・依存版の変更は対象だけを描き直す', () => {
    const doc = fixture();
    const first = key(doc, 'a-1');
    doc.tracks[0].items[0].source.in = 0.5;
    assert.notEqual(key(doc, 'a-1'), first);
    assert.notEqual(key(fixture(), 'a-1', 1), first);
    assert.notEqual(visualThumbnailReuseKey(fixture(), 'a-1', null, '140px', '24px', 10, 0, 0), first);
    const replaced = fixture();
    replaced.sources[0].path = 'replacement.mp4';
    assert.notEqual(key(replaced, 'a-1'), first);
});

test('旧形式のクリップも表示位置だけなら画像を使い回す', () => {
    const doc = { output: { width: 1920, height: 1080 } };
    const input = at => [{ at }, { src: 'main', t: at, in: 1, out: 3 }];
    const keyAt = value => visualThumbnailReuseKey(doc, 'cut-1', input(value), '100px', '24px', 10, 0, 0);
    assert.equal(keyAt(0), keyAt(60));
    assert.notEqual(keyAt(0), visualThumbnailReuseKey(doc, 'cut-1', [{}, { src: 'main', in: 2, out: 3 }],
        '100px', '24px', 10, 0, 0));
});
