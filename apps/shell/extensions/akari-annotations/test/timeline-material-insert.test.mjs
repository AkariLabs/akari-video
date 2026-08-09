import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayerElement, buildSfxElement } from '../lib/common/timeline-material-insert.js';

test('buildLayerElement: 素材全長が残り時間以内なら duration はそのまま', () => {
    const result = buildLayerElement([], 'assets/clip.mp4', 2, 4, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.element, {
        id: 'layer-clip', t: 2, duration: 4, kind: 'video', src: 'assets/clip.mp4', track: 0
    });
});

test('buildLayerElement: 実尺 > 残り時間ならクランプする（duration = 総尺 - t）', () => {
    const result = buildLayerElement([], 'assets/clip.mp4', 18, 10, 20);
    assert.equal(result.ok, true);
    assert.equal(result.element.duration, 2);
});

test('buildLayerElement: t が総尺以上なら拒否する', () => {
    const atEqual = buildLayerElement([], 'assets/clip.mp4', 20, 4, 20);
    assert.equal(atEqual.ok, false);
    assert.equal(atEqual.reason, 'beyond-content-duration');
    const beyond = buildLayerElement([], 'assets/clip.mp4', 25, 4, 20);
    assert.equal(beyond.ok, false);
});

test('buildLayerElement: id が既存 layer id と衝突しなければベース名をそのまま使う', () => {
    const result = buildLayerElement(['layer-other'], 'assets/clip.mp4', 0, 3, 20);
    assert.equal(result.ok, true);
    assert.equal(result.element.id, 'layer-clip');
});

test('buildLayerElement: id 衝突は -2, -3... と採番して回避する（nextCopyId の流儀）', () => {
    const first = buildLayerElement(['layer-clip'], 'assets/clip.mp4', 0, 3, 20);
    assert.equal(first.ok, true);
    assert.equal(first.element.id, 'layer-clip-2');
    const second = buildLayerElement(['layer-clip', 'layer-clip-2'], 'assets/clip.mp4', 0, 3, 20);
    assert.equal(second.ok, true);
    assert.equal(second.element.id, 'layer-clip-3');
});

test('buildLayerElement: 拡張子・記号を含むファイル名でも安全な id スラグへ畳む', () => {
    const result = buildLayerElement([], '素材/My Clip (final).MOV', 0, 3, 20);
    assert.equal(result.ok, true);
    assert.equal(result.element.id, 'layer-my-clip-final');
});

test('buildSfxElement: path/t/track のみの最小形を返す（duration/id は含まない）', () => {
    const result = buildSfxElement('assets/se.wav', 5, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.element, { path: 'assets/se.wav', t: 5, track: 0 });
});

test('buildSfxElement: t が総尺以上なら拒否する', () => {
    const atEqual = buildSfxElement('assets/se.wav', 20, 20);
    assert.equal(atEqual.ok, false);
    assert.equal(atEqual.reason, 'beyond-content-duration');
    const beyond = buildSfxElement('assets/se.wav', 30, 20);
    assert.equal(beyond.ok, false);
});

test('buildSfxElement: t が 0 かつ総尺が正なら受理する（境界値）', () => {
    const result = buildSfxElement('assets/se.wav', 0, 20);
    assert.equal(result.ok, true);
});
