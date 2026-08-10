import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLayerElement,
    buildSfxElement,
    computeMaterialGhostRange,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS,
    insertedLayerTimelineTracks,
    materialDropAcceptance,
    materialGhostVisibility,
    shiftLayerTracksForInsert
} from '../lib/common/timeline-material-insert.js';
import { parseEdit } from '../lib/common/edit-store.js';

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

// --- task 2026-08-10-dnd-ghost-and-insert-fix: materialGhostVisibility（rejected 時にゴーストを出さない判定） ---

test('materialGhostVisibility: rejected なら本体ゴースト・挿入インジケータとも非表示（司令塔裁定1）', () => {
    const result = materialGhostVisibility('video', { rejected: true });
    assert.deepEqual(result, { showGhost: false, showInsertIndicator: false });
});

test('materialGhostVisibility: rejected なら insertTrack があっても非表示のまま', () => {
    const result = materialGhostVisibility('video', { rejected: true, insertTrack: 1 });
    assert.deepEqual(result, { showGhost: false, showInsertIndicator: false });
});

test('materialGhostVisibility: 非rejected・insertTrack ありの video/image は本体ゴースト + 挿入インジケータを併用（司令塔裁定2）', () => {
    assert.deepEqual(
        materialGhostVisibility('video', { rejected: false, insertTrack: 1 }),
        { showGhost: true, showInsertIndicator: true }
    );
    assert.deepEqual(
        materialGhostVisibility('image', { rejected: false, insertTrack: 0 }),
        { showGhost: true, showInsertIndicator: true }
    );
});

test('materialGhostVisibility: 非rejected・insertTrack 無しは本体ゴーストのみ（挿入インジケータ無し）', () => {
    const result = materialGhostVisibility('video', { rejected: false });
    assert.deepEqual(result, { showGhost: true, showInsertIndicator: false });
});

test('materialGhostVisibility: audio は insertTrack があっても挿入インジケータを出さない（裁定4、行間挿入非対応）', () => {
    const result = materialGhostVisibility('audio', { rejected: false, insertTrack: 1 });
    assert.deepEqual(result, { showGhost: true, showInsertIndicator: false });
});

// --- task 2026-08-10-dnd-ghost-and-insert-fix: shiftLayerTracksForInsert（既存アイテムの繰り上げ） ---

test('shiftLayerTracksForInsert: insertTrack 以上の track を +1 する', () => {
    const layers = [
        { id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4', track: 0 },
        { id: 'layer-b', t: 0, duration: 1, kind: 'video', src: 'b.mp4', track: 1 },
        { id: 'layer-c', t: 0, duration: 1, kind: 'video', src: 'c.mp4', track: 2 }
    ];
    const result = shiftLayerTracksForInsert(layers, 1);
    assert.deepEqual(result.map(layer => layer.track), [0, 2, 3]);
});

test('shiftLayerTracksForInsert: 繰り上げ不要な要素は同一参照を返す（track フィールドを新規に生やさない）', () => {
    const untouched = { id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4' };
    const [result] = shiftLayerTracksForInsert([untouched], 1);
    assert.equal(result, untouched);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'track'), false);
});

test('shiftLayerTracksForInsert: track 省略（既定 0）でも insertTrack 以上なら明示的に繰り上げる', () => {
    const layer = { id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4' };
    const [result] = shiftLayerTracksForInsert([layer], 0);
    assert.equal(result.track, 1);
});

// --- task 2026-08-10-dnd-ghost-and-insert-fix: insertedLayerTimelineTracks（宣言トラックの繰り上げ + 新規挿入） ---

test('insertedLayerTimelineTracks: layers 以外の kind は繰り上げの対象にならない', () => {
    const tracks = [
        { id: 't1', kind: 'cuts', ref: 0 },
        { id: 't2', kind: 'layers', ref: 0 }
    ];
    const result = insertedLayerTimelineTracks(tracks, 0);
    const cuts = result.filter(track => track.kind === 'cuts');
    assert.deepEqual(cuts, [{ id: 't1', kind: 'cuts', ref: 0 }]);
});

test('insertedLayerTimelineTracks: layers 行 0 本（宣言トラック無し）でも insertTrack:0 で新規 1 本を受理する（司令塔裁定5）', () => {
    const result = insertedLayerTimelineTracks([], 0);
    const layerTracks = result.filter(track => track.kind === 'layers');
    assert.equal(layerTracks.length, 1);
    assert.equal(layerTracks[0].ref, 0);
});

test('insertedLayerTimelineTracks + shiftLayerTracksForInsert: [track1, track0] の行間(insertTrack=1)へ挿入した最終状態が既存アイテムドラッグの行間挿入コミット(:6885-6899)と同一になる', () => {
    // 司令塔実測の対象プロジェクト同型: 表示順 [track1(上, ref1), track0(下, ref0)]。
    // レイヤー行 2 本・各行に既存アイテムが 1 つずつ載っている状態を再現する。
    const source = JSON.stringify({
        cuts: [{ in: 0, out: 5 }],
        overlays: [],
        layers: [
            { id: 'layer-bottom', t: 0, duration: 2, kind: 'video', src: 'bottom.mp4', track: 0 },
            { id: 'layer-top', t: 0, duration: 2, kind: 'video', src: 'top.mp4', track: 1 }
        ],
        timeline: {
            tracks: [
                { id: 't1', kind: 'layers', ref: 0 },
                { id: 't2', kind: 'layers', ref: 1 }
            ]
        }
    });
    const parsed = parseEdit(source);
    assert.deepEqual(parsed.warnings, []);

    const insertTrack = 1;
    const tracksAfter = insertedLayerTimelineTracks(parsed.timeline.tracks, insertTrack);
    const layersAfter = shiftLayerTracksForInsert(parsed.layers, insertTrack);

    // 宣言トラックが 3 本・既存 track1(t2) が ref 2 へ繰り上がり・新規が ref 1。
    const layerTracksAfter = tracksAfter.filter(track => track.kind === 'layers');
    assert.equal(layerTracksAfter.length, 3);
    assert.equal(tracksAfter.find(track => track.id === 't1').ref, 0);
    assert.equal(tracksAfter.find(track => track.id === 't2').ref, 2);
    const newTrackEntries = tracksAfter.filter(track => track.id !== 't1' && track.id !== 't2');
    assert.equal(newTrackEntries.length, 1);
    assert.equal(newTrackEntries[0].ref, 1);

    // 既存アイテムの帰属行が変わらない: layer-bottom は元 track0 のまま、layer-top は
    // 繰り上がった宣言(旧 track1 → ref2)へ追随して track:2 になる（同じ行を指し続ける）。
    assert.equal(layersAfter.find(layer => layer.id === 'layer-bottom').track, 0);
    assert.equal(layersAfter.find(layer => layer.id === 'layer-top').track, 2);

    // 新規素材は insertTrack の位置(track:1)へ挿入される（buildLayerElement 側の track 引数と同じ）。
    const built = buildLayerElement(
        parsed.layers.map(layer => layer.id), 'assets/new-clip.mp4', 0, 2, 20, insertTrack
    );
    assert.equal(built.ok, true);
    assert.equal(built.element.track, insertTrack);
});
