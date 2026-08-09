import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLayerElement,
    buildSfxElement,
    computeMaterialGhostRange,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS,
    materialDropAcceptance
} from '../lib/common/timeline-material-insert.js';

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

// --- task 2026-08-10-material-dnd-timeline: track 引数（既定 0 の後方互換） ---

test('buildLayerElement: track を指定すると要素へそのまま反映する', () => {
    const result = buildLayerElement([], 'assets/clip.mp4', 2, 4, 20, 3);
    assert.equal(result.ok, true);
    assert.equal(result.element.track, 3);
});

test('buildLayerElement: track 省略時は 0（既存呼び出し = 再生ヘッド追加コマンドとの後方互換）', () => {
    const result = buildLayerElement([], 'assets/clip.mp4', 2, 4, 20);
    assert.equal(result.ok, true);
    assert.equal(result.element.track, 0);
});

test('buildLayerElement: image 素材は IMAGE_LAYER_DEFAULT_DURATION_SECONDS を渡すと 5 秒で挿入される（kind は video 固定）', () => {
    const result = buildLayerElement([], 'assets/photo.png', 2, IMAGE_LAYER_DEFAULT_DURATION_SECONDS, 20, 1);
    assert.equal(result.ok, true);
    assert.deepEqual(result.element, {
        id: 'layer-photo', t: 2, duration: 5, kind: 'video', src: 'assets/photo.png', track: 1
    });
});

test('IMAGE_LAYER_DEFAULT_DURATION_SECONDS は 5', () => {
    assert.equal(IMAGE_LAYER_DEFAULT_DURATION_SECONDS, 5);
});

test('buildSfxElement: track を指定すると要素へそのまま反映する', () => {
    const result = buildSfxElement('assets/se.wav', 5, 20, 2);
    assert.equal(result.ok, true);
    assert.deepEqual(result.element, { path: 'assets/se.wav', t: 5, track: 2 });
});

test('buildSfxElement: track 省略時は 0（既存呼び出しとの後方互換）', () => {
    const result = buildSfxElement('assets/se.wav', 5, 20);
    assert.equal(result.ok, true);
    assert.equal(result.element.track, 0);
});

// --- task 2026-08-10-material-dnd-timeline: materialDropAcceptance（ドロップ受理判定） ---

test('materialDropAcceptance: video/image は layers 行を受理する', () => {
    assert.equal(materialDropAcceptance('video', 'layers'), 'accept');
    assert.equal(materialDropAcceptance('image', 'layers'), 'accept');
});

test('materialDropAcceptance: video/image は cuts/overlays/captions/audio 行を拒否する', () => {
    for (const trackKind of ['cuts', 'overlays', 'captions', 'audio']) {
        assert.equal(materialDropAcceptance('video', trackKind), 'reject');
        assert.equal(materialDropAcceptance('image', trackKind), 'reject');
    }
});

test('materialDropAcceptance: video/image は layers 行が 1 本も無い（trackKind undefined）ときも受理する（司令塔裁定2）', () => {
    assert.equal(materialDropAcceptance('video', undefined), 'accept');
    assert.equal(materialDropAcceptance('image', undefined), 'accept');
});

test('materialDropAcceptance: audio は audio 行のみ受理する', () => {
    assert.equal(materialDropAcceptance('audio', 'audio'), 'accept');
    for (const trackKind of ['cuts', 'overlays', 'captions', 'layers']) {
        assert.equal(materialDropAcceptance('audio', trackKind), 'reject');
    }
});

test('materialDropAcceptance: audio は行が 1 本も無い（undefined）ときは拒否する（video/image と異なり救済しない）', () => {
    assert.equal(materialDropAcceptance('audio', undefined), 'reject');
});

// --- task 2026-08-10-material-dnd-timeline: computeMaterialGhostRange（ゴースト幅・クランプ計算） ---

test('computeMaterialGhostRange: 素材全長が残り時間以内なら end はそのまま t+durationSeconds', () => {
    const result = computeMaterialGhostRange(2, 4, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.range, { start: 2, end: 6 });
});

test('computeMaterialGhostRange: 実尺 > 残り時間なら総尺でクランプする', () => {
    const result = computeMaterialGhostRange(18, 10, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.range, { start: 18, end: 20 });
});

test('computeMaterialGhostRange: t が総尺以上なら拒否する', () => {
    const atEqual = computeMaterialGhostRange(20, 4, 20);
    assert.equal(atEqual.ok, false);
    assert.equal(atEqual.reason, 'beyond-content-duration');
    const beyond = computeMaterialGhostRange(25, 4, 20);
    assert.equal(beyond.ok, false);
});

test('computeMaterialGhostRange: t が 0 かつ総尺が正なら受理する（境界値）', () => {
    const result = computeMaterialGhostRange(0, 4, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.range, { start: 0, end: 4 });
});

test('computeMaterialGhostRange: durationSeconds が負でも 0 未満にはクランプしない（防御）', () => {
    const result = computeMaterialGhostRange(0, -5, 20);
    assert.equal(result.ok, true);
    assert.deepEqual(result.range, { start: 0, end: 0 });
});
