import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLayerElement,
    buildSfxElement,
    computeMaterialGhostRange,
    ensuredAudioTimelineTracks,
    firstFreeCutStart,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS,
    insertCutIntoEdit,
    planCutDrop,
    insertedLayerTimelineTracks,
    insertedTimelineTracksOfKind,
    materialDropDecision,
    materialGhostVisibility,
    shiftLayerTracksForInsert
} from '../lib/common/timeline-material-insert.js';
import { computeCutTrackSegments } from '../lib/common/edit-store.js';
import { readLegacyView, toV2Edit } from './helpers/v2-fixture.mjs';

// --- buildLayerElement（layers[] 挿入要素） ---

test('buildLayerElement: 素材全長をそのまま duration にする', () => {
    const element = buildLayerElement([], 'assets/clip.mp4', 2, 4);
    assert.deepEqual(element, {
        id: 'layer-clip', t: 2, duration: 4, kind: 'video', src: 'assets/clip.mp4', track: 0
    });
});

test('buildLayerElement: 総尺より後ろでも尺を切らない（P1-b・2026-08-18 でクランプ撤廃）', () => {
    const element = buildLayerElement([], 'assets/clip.mp4', 18, 10);
    assert.equal(element.t, 18);
    assert.equal(element.duration, 10);
});

test('buildLayerElement: t が負でも 0 で下限を切る（防御）', () => {
    assert.equal(buildLayerElement([], 'assets/clip.mp4', -3, 4).t, 0);
});

test('buildLayerElement: id が既存 layer id と衝突しなければベース名をそのまま使う', () => {
    assert.equal(buildLayerElement(['layer-other'], 'assets/clip.mp4', 0, 3).id, 'layer-clip');
});

test('buildLayerElement: id 衝突は -2, -3... と採番して回避する（nextCopyId の流儀）', () => {
    assert.equal(buildLayerElement(['layer-clip'], 'assets/clip.mp4', 0, 3).id, 'layer-clip-2');
    assert.equal(
        buildLayerElement(['layer-clip', 'layer-clip-2'], 'assets/clip.mp4', 0, 3).id,
        'layer-clip-3'
    );
});

test('buildLayerElement: 拡張子・記号を含むファイル名でも安全な id スラグへ畳む', () => {
    assert.equal(buildLayerElement([], '素材/My Clip (final).MOV', 0, 3).id, 'layer-my-clip-final');
});

test('buildLayerElement: track を指定すると要素へそのまま反映する / 省略時は 0', () => {
    assert.equal(buildLayerElement([], 'assets/clip.mp4', 2, 4, 3).track, 3);
    assert.equal(buildLayerElement([], 'assets/clip.mp4', 2, 4).track, 0);
});

test('buildLayerElement: image 素材は 5 秒で挿入される（kind は video 固定）', () => {
    const element = buildLayerElement([], 'assets/photo.png', 2, IMAGE_LAYER_DEFAULT_DURATION_SECONDS, 1);
    assert.deepEqual(element, {
        id: 'layer-photo', t: 2, duration: 5, kind: 'video', src: 'assets/photo.png', track: 1
    });
});

test('IMAGE_LAYER_DEFAULT_DURATION_SECONDS は 5', () => {
    assert.equal(IMAGE_LAYER_DEFAULT_DURATION_SECONDS, 5);
});

// --- buildSfxElement（audio.sfx[] 挿入要素） ---

test('buildSfxElement: path/t/track のみの最小形を返す（duration/id は含まない）', () => {
    assert.deepEqual(buildSfxElement('assets/se.wav', 5), { path: 'assets/se.wav', t: 5, track: 0 });
});

test('buildSfxElement: 総尺より後ろでも拒否しない（P1-b・2026-08-18 で拒否撤廃）', () => {
    assert.deepEqual(buildSfxElement('assets/se.wav', 300), { path: 'assets/se.wav', t: 300, track: 0 });
});

test('buildSfxElement: track を指定すると要素へそのまま反映する', () => {
    assert.deepEqual(buildSfxElement('assets/se.wav', 5, 2), { path: 'assets/se.wav', t: 5, track: 2 });
});

// --- materialDropDecision（ドロップ受理判定） ---

test('materialDropDecision: video/image は layers 行を受理する', () => {
    assert.deepEqual(materialDropDecision('video', 'layers'), { accept: true, zone: 'layers' });
    assert.deepEqual(materialDropDecision('image', 'layers'), { accept: true, zone: 'layers' });
});

test('materialDropDecision: video/image は cuts 行も受理する（P1-a・本編へ置ける）', () => {
    assert.deepEqual(materialDropDecision('video', 'cuts'), { accept: true, zone: 'cuts' });
    assert.deepEqual(materialDropDecision('image', 'cuts'), { accept: true, zone: 'cuts' });
});

test('materialDropDecision: video/image は overlays/captions/audio 行を理由付きで拒否する', () => {
    for (const trackKind of ['overlays', 'captions', 'audio']) {
        const decision = materialDropDecision('video', trackKind);
        assert.equal(decision.accept, false);
        assert.match(decision.reason, /本編トラックかレイヤートラック/);
    }
});

test('materialDropDecision: video/image は対象行が 1 本も無い（undefined）ときも layers で受理する', () => {
    assert.deepEqual(materialDropDecision('video', undefined), { accept: true, zone: 'layers' });
    assert.deepEqual(materialDropDecision('image', undefined), { accept: true, zone: 'layers' });
});

test('materialDropDecision: audio は audio 行を受理する', () => {
    assert.deepEqual(materialDropDecision('audio', 'audio'), { accept: true, zone: 'audio' });
});

test('materialDropDecision: audio は音源行が 1 本も無い（undefined）ときも受理する（P0-a・旧版の実質バグ）', () => {
    assert.deepEqual(materialDropDecision('audio', undefined), { accept: true, zone: 'audio' });
});

test('materialDropDecision: audio は音源以外の行を理由付きで拒否する', () => {
    for (const trackKind of ['cuts', 'overlays', 'captions', 'layers']) {
        const decision = materialDropDecision('audio', trackKind);
        assert.equal(decision.accept, false);
        assert.match(decision.reason, /音源トラック/);
    }
});

// --- computeMaterialGhostRange（ゴースト幅） ---

test('computeMaterialGhostRange: end は t + durationSeconds', () => {
    assert.deepEqual(computeMaterialGhostRange(2, 4), { start: 2, end: 6 });
});

test('computeMaterialGhostRange: 総尺の外でもクランプも拒否もしない（P1-b）', () => {
    assert.deepEqual(computeMaterialGhostRange(18, 10), { start: 18, end: 28 });
    assert.deepEqual(computeMaterialGhostRange(120, 4), { start: 120, end: 124 });
});

test('computeMaterialGhostRange: 負値は 0 で下限を切る（防御）', () => {
    assert.deepEqual(computeMaterialGhostRange(0, -5), { start: 0, end: 0 });
    assert.deepEqual(computeMaterialGhostRange(-2, 4), { start: 0, end: 4 });
});

// --- materialGhostVisibility ---

test('materialGhostVisibility: rejected なら本体ゴースト・挿入インジケータとも非表示（司令塔裁定1）', () => {
    assert.deepEqual(
        materialGhostVisibility('video', { rejected: true }),
        { showGhost: false, showInsertIndicator: false }
    );
    assert.deepEqual(
        materialGhostVisibility('video', { rejected: true, insertTrack: 1 }),
        { showGhost: false, showInsertIndicator: false }
    );
});

test('materialGhostVisibility: 非rejected・insertTrack ありの video/image は本体 + 挿入インジケータ', () => {
    assert.deepEqual(
        materialGhostVisibility('video', { rejected: false, insertTrack: 1 }),
        { showGhost: true, showInsertIndicator: true }
    );
    assert.deepEqual(
        materialGhostVisibility('image', { rejected: false, insertTrack: 0 }),
        { showGhost: true, showInsertIndicator: true }
    );
});

test('materialGhostVisibility: 非rejected・insertTrack 無しは本体ゴーストのみ', () => {
    assert.deepEqual(
        materialGhostVisibility('video', { rejected: false }),
        { showGhost: true, showInsertIndicator: false }
    );
});

test('materialGhostVisibility: audio は insertTrack があっても挿入インジケータを出さない（裁定4）', () => {
    assert.deepEqual(
        materialGhostVisibility('audio', { rejected: false, insertTrack: 1 }),
        { showGhost: true, showInsertIndicator: false }
    );
});

// --- shiftLayerTracksForInsert / insertedLayerTimelineTracks（行間挿入の繰り上げ） ---

test('shiftLayerTracksForInsert: insertTrack 以上の track を +1 する', () => {
    const layers = [
        { id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4', track: 0 },
        { id: 'layer-b', t: 0, duration: 1, kind: 'video', src: 'b.mp4', track: 1 },
        { id: 'layer-c', t: 0, duration: 1, kind: 'video', src: 'c.mp4', track: 2 }
    ];
    assert.deepEqual(shiftLayerTracksForInsert(layers, 1).map(layer => layer.track), [0, 2, 3]);
});

test('shiftLayerTracksForInsert: 繰り上げ不要な要素は同一参照を返す（track を新規に生やさない）', () => {
    const untouched = { id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4' };
    const [result] = shiftLayerTracksForInsert([untouched], 1);
    assert.equal(result, untouched);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'track'), false);
});

test('shiftLayerTracksForInsert: track 省略（既定 0）でも insertTrack 以上なら明示的に繰り上げる', () => {
    const [result] = shiftLayerTracksForInsert(
        [{ id: 'layer-a', t: 0, duration: 1, kind: 'video', src: 'a.mp4' }], 0
    );
    assert.equal(result.track, 1);
});

test('insertedLayerTimelineTracks: layers 以外の kind は繰り上げの対象にならない', () => {
    const result = insertedLayerTimelineTracks(
        [{ id: 't1', kind: 'cuts', ref: 0 }, { id: 't2', kind: 'layers', ref: 0 }], 0
    );
    assert.deepEqual(result.filter(track => track.kind === 'cuts'), [{ id: 't1', kind: 'cuts', ref: 0 }]);
});

test('insertedLayerTimelineTracks: layers 行 0 本でも insertTrack:0 で新規 1 本を受理する（司令塔裁定5）', () => {
    const layerTracks = insertedLayerTimelineTracks([], 0).filter(track => track.kind === 'layers');
    assert.equal(layerTracks.length, 1);
    assert.equal(layerTracks[0].ref, 0);
});

test('insertedLayerTimelineTracks + shiftLayerTracksForInsert: [track1, track0] の行間(insertTrack=1)へ挿入した最終状態', () => {
    const source = JSON.stringify({
        cuts: [{ in: 0, out: 5 }],
        overlays: [],
        layers: [
            { id: 'layer-bottom', t: 0, duration: 2, kind: 'video', src: 'bottom.mp4', track: 0 },
            { id: 'layer-top', t: 0, duration: 2, kind: 'video', src: 'top.mp4', track: 1 }
        ],
        timeline: {
            tracks: [
                { id: 't0', kind: 'cuts', ref: 0 },
                { id: 't1', kind: 'layers', ref: 0 },
                { id: 't2', kind: 'layers', ref: 1 }
            ]
        }
    });
    const parsed = readLegacyView(JSON.parse(source));
    assert.deepEqual(parsed.warnings, []);

    const insertTrack = 1;
    const tracksAfter = insertedLayerTimelineTracks(parsed.timeline.tracks, insertTrack);
    const layersAfter = shiftLayerTracksForInsert(parsed.layers, insertTrack);

    assert.equal(tracksAfter.filter(track => track.kind === 'layers').length, 3);
    assert.equal(tracksAfter.find(track => track.id === 't1').ref, 0);
    assert.equal(tracksAfter.find(track => track.id === 't2').ref, 2);
    const newTrackEntries = tracksAfter.filter(track => !['t0', 't1', 't2'].includes(track.id));
    assert.equal(newTrackEntries.length, 1);
    assert.equal(newTrackEntries[0].ref, 1);

    assert.equal(layersAfter.find(layer => layer.id === 'layer-bottom').track, 0);
    assert.equal(layersAfter.find(layer => layer.id === 'layer-top').track, 2);
    assert.equal(
        buildLayerElement(parsed.layers.map(layer => layer.id), 'assets/new-clip.mp4', 0, 2, insertTrack).track,
        insertTrack
    );
});

// --- task 2026-08-18-timeline-dnd-p0p1: insertedTimelineTracksOfKind / shiftCutTracksForInsert ---

test('insertedTimelineTracksOfKind: kind=cuts でも layers と同じ繰り上げ規則で新規行を差し込む', () => {
    const tracks = [
        { id: 't1', kind: 'cuts', ref: 0 },
        { id: 't2', kind: 'cuts', ref: 1 },
        { id: 't3', kind: 'layers', ref: 0 }
    ];
    const result = insertedTimelineTracksOfKind(tracks, 'cuts', 1);
    assert.equal(result.find(track => track.id === 't1').ref, 0);
    assert.equal(result.find(track => track.id === 't2').ref, 2);
    assert.equal(result.find(track => track.id === 't3').ref, 0, 'layers 行は影響を受けない');
    const added = result.filter(track => !['t1', 't2', 't3'].includes(track.id));
    assert.equal(added.length, 1);
    assert.deepEqual({ kind: added[0].kind, ref: added[0].ref }, { kind: 'cuts', ref: 1 });
});

// --- task 2026-08-18-timeline-dnd-p0p1 / P0-a: ensuredAudioTimelineTracks ---

test('ensuredAudioTimelineTracks: audio 行が無ければ ref 0 を先頭（画面最下段）へ足す', () => {
    const result = ensuredAudioTimelineTracks([{ id: 't1', kind: 'cuts', ref: 0 }]);
    assert.equal(result.length, 2);
    assert.deepEqual({ kind: result[0].kind, ref: result[0].ref }, { kind: 'audio', ref: 0 });
});

test('ensuredAudioTimelineTracks: 既に audio 行があれば増やさない', () => {
    const tracks = [{ id: 't1', kind: 'audio', ref: 0 }, { id: 't2', kind: 'cuts', ref: 0 }];
    assert.deepEqual(ensuredAudioTimelineTracks(tracks), tracks);
});

test('ensuredAudioTimelineTracks: 新規 id は既存 id と衝突しない', () => {
    const tracks = [{ id: 't2', kind: 'cuts', ref: 0 }];
    const result = ensuredAudioTimelineTracks(tracks);
    assert.equal(new Set(result.map(track => track.id)).size, result.length);
});

// --- task 2026-08-18-timeline-dnd-p0p1 / P1-a: planCutDrop（本編ドロップの着地計画） ---

const V2_EDIT = Object.freeze(toV2Edit({
    version: 0,
    output: { width: 1920, height: 1080, fps: 30 },
    source: { path: 'media/source.mov', proxy: null },
    cuts: [{ in: 0, out: 10 }]
}));

test('planCutDrop: v2 の絶対配置互換ビューは free', () => {
    const plan = planCutDrop(readLegacyView(V2_EDIT).cuts, 0, 4, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at }, { mode: 'free', at: 10 });
});

test('planCutDrop: 既存カットの上に落としたら「そのカットの直後」へ割り込む', () => {
    const cuts = [{ in: 0, out: 4 }, { in: 0, out: 6 }];
    const plan = planCutDrop(cuts, 0, 1.5, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at, insertIndex: plan.insertIndex },
        { mode: 'sequential', at: 4, insertIndex: 1 });
});

test('planCutDrop: 先頭より手前へ落としたら先頭へ割り込む（at 0）', () => {
    const cuts = [{ in: 0, out: 4 }, { in: 0, out: 6 }];
    const plan = planCutDrop(cuts, 0, 0, 3);
    assert.deepEqual({ at: plan.at, insertIndex: plan.insertIndex }, { at: 0, insertIndex: 0 });
});

test('planCutDrop: v2 では総尺より後ろの絶対位置を保つ', () => {
    const plan = planCutDrop(readLegacyView(V2_EDIT).cuts, 0, 90, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at, insertIndex: plan.insertIndex },
        { mode: 'free', at: 90, insertIndex: 1 });
});

test('planCutDrop: 明示 at を持つ互換ビュー（gap-aware）は free（落とした位置へ置く）', () => {
    const cuts = [{ at: 0, in: 0, out: 4 }, { at: 10, in: 0, out: 2 }];
    const plan = planCutDrop(cuts, 0, 6, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at }, { mode: 'free', at: 6 });
});

test('planCutDrop: free でも重なる位置なら空きへ寄せる（cuts.track-overlap は error）', () => {
    const cuts = [{ at: 0, in: 0, out: 4 }, { at: 10, in: 0, out: 2 }];
    const plan = planCutDrop(cuts, 0, 2, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at }, { mode: 'free', at: 4 });
});

test('planCutDrop: 非 0 track を持つプロジェクトも gap-aware 扱い', () => {
    const cuts = [{ in: 0, out: 4 }, { track: 1, in: 0, out: 4 }];
    assert.equal(planCutDrop(cuts, 0, 2, 3).mode, 'free');
});

test('planCutDrop: カットが 1 本も無いプロジェクトは先頭 sequential', () => {
    const plan = planCutDrop([], 0, 5, 3);
    assert.deepEqual({ mode: plan.mode, at: plan.at, insertIndex: plan.insertIndex },
        { mode: 'sequential', at: 0, insertIndex: 0 });
});

// --- task 2026-08-18-timeline-dnd-p0p1 / P1-a: insertCutIntoEdit ---

const SEQ_PLAN = { mode: 'sequential', at: 10, insertIndex: 1 };

test('insertCutIntoEdit: v2 の既存ソースを再利用して本編 item を挿入する', () => {
    const result = insertCutIntoEdit(V2_EDIT, 'media/source.mov', SEQ_PLAN, 4, 0);
    assert.equal(result.value.version, 2);
    assert.equal(result.value.sources.length, 1);
    assert.deepEqual(readLegacyView(result.value).cuts[1], {
        in: 0, out: 4, src: 'main', at: 10, track: 0
    });
});

test('insertCutIntoEdit: v2 では sequential の位置と尺を整数フレームで書く', () => {
    const result = insertCutIntoEdit(V2_EDIT, 'media/source.mov', SEQ_PLAN, 4, 0);
    const item = result.value.tracks[0].items[1];
    assert.deepEqual({ at: item.at, duration: item.duration }, { at: 300, duration: 120 });
    assert.deepEqual(result.warnings, []);
});

test('insertCutIntoEdit: free では at / track を明示して書く', () => {
    const edit = toV2Edit({
        version: 0,
        output: { width: 1920, height: 1080, fps: 30 },
        source: { path: 'media/source.mov', proxy: null },
        cuts: [{ at: 0, in: 0, out: 4 }]
    });
    const result = insertCutIntoEdit(edit, 'media/source.mov', { mode: 'free', at: 12, insertIndex: 1 }, 4, 0);
    assert.deepEqual(readLegacyView(result.value).cuts[1], {
        at: 12, track: 0, src: 'main', in: 0, out: 4
    });
});

test('insertCutIntoEdit: insertIndex の位置へ割り込む（末尾 append ではない）', () => {
    const edit = toV2Edit({
        version: 0,
        output: { width: 1920, height: 1080, fps: 30 },
        source: { path: 'media/source.mov', proxy: null },
        cuts: [{ in: 0, out: 4 }, { in: 10, out: 13 }], overlays: []
    });
    const result = insertCutIntoEdit(
        edit, 'media/source.mov', { mode: 'sequential', at: 4, insertIndex: 1 }, 2, 0
    );
    assert.deepEqual(readLegacyView(result.value).cuts.map(cut => cut.out), [4, 2, 13]);
});

test('insertCutIntoEdit: v2 で同じ path の source があれば再利用して増やさない', () => {
    const edit = toV2Edit({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'base', path: 'assets/a.mp4', proxy: null }],
        cuts: [{ src: 'base', in: 0, out: 10 }], overlays: []
    });
    const result = insertCutIntoEdit(edit, 'assets/a.mp4', SEQ_PLAN, 3, 0);
    assert.equal(result.value.sources.length, 1);
    assert.deepEqual(readLegacyView(result.value).cuts[1], {
        src: 'base', in: 0, out: 3, at: 10, track: 0
    });
});

test('insertCutIntoEdit: v2 で未知の path なら id を採番して sources[] へ足す', () => {
    const edit = toV2Edit({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 's1', path: 'assets/a.mp4', proxy: null }],
        cuts: [{ src: 's1', in: 0, out: 10 }], overlays: []
    });
    const result = insertCutIntoEdit(edit, 'assets/photo.png', SEQ_PLAN, 5, 0);
    assert.deepEqual(result.value.sources[1], { id: 's2', path: 'assets/photo.png', proxy: null });
    assert.equal(readLegacyView(result.value).cuts[1].src, 's2');
});

test('insertCutIntoEdit: v2 の free 配置は整数フレーム位置へそのまま着地する', () => {
    const edit = toV2Edit({
        version: 1,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 's1', path: 'assets/a.mp4', proxy: null }],
        cuts: [{ src: 's1', at: 0, in: 0, out: 10 }], overlays: []
    });
    const result = insertCutIntoEdit(edit, 'assets/a.mp4', { mode: 'free', at: 20, insertIndex: 1 }, 3, 0);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.value.tracks[0].items[1].at, 600);
});

test('insertCutIntoEdit: 入力オブジェクトを変更しない（純関数）', () => {
    const before = JSON.stringify(V2_EDIT);
    insertCutIntoEdit(V2_EDIT, 'assets/insert.mp4', SEQ_PLAN, 4, 0);
    assert.equal(JSON.stringify(V2_EDIT), before);
});

test('insertCutIntoEdit: duration が 0 でも v2 の最小 1 フレーム尺を敷く', () => {
    const result = insertCutIntoEdit(V2_EDIT, 'media/source.mov', SEQ_PLAN, 0, 0);
    assert.equal(result.value.tracks[0].items[1].duration, 5);
    const inserted = readLegacyView(result.value).cuts[1];
    assert.ok(inserted.out > inserted.in);
});

test('planCutDrop + insertCutIntoEdit: v2 挿入で既存カットの絶対位置が保たれる', () => {
    const cuts = [{ in: 0, out: 4 }, { in: 10, out: 13 }, { in: 20, out: 22 }];
    const input = toV2Edit({
        version: 0,
        output: { width: 1920, height: 1080, fps: 30 },
        source: { path: 'media/source.mov', proxy: null }, cuts, overlays: []
    });
    const plan = planCutDrop(readLegacyView(input).cuts, 0, 5, 2);
    const result = insertCutIntoEdit(input, 'media/source.mov', plan, 2, 0);
    const projected = readLegacyView(result.value).cuts;
    const segments = computeCutTrackSegments(projected);
    // t=5 は 2 本目（4..7）の中。v2 は既存の 7..9 を動かさず、最初の空き 9 秒へ置く。
    assert.deepEqual(segments.map(segment => segment.at), [0, 4, 9, 7]);
    assert.equal(projected[2].out, 2, '新しいカットは宣言配列の 3 番目');
});

// --- task 2026-08-18-timeline-dnd-p0p1 / P1-a: firstFreeCutStart（本編の重なり回避） ---

test('firstFreeCutStart: 空きに落としたらその位置のまま', () => {
    assert.equal(firstFreeCutStart([{ start: 0, end: 6 }], 8, 3), 8);
});

test('firstFreeCutStart: 既存カットの上に落としたらそのカットの直後へ寄せる', () => {
    assert.equal(firstFreeCutStart([{ start: 0, end: 6 }], 2.8, 6), 6);
});

test('firstFreeCutStart: 尺が入らない隙間は飛ばして次の空きへ', () => {
    const occupied = [{ start: 0, end: 6 }, { start: 8, end: 12 }];
    assert.equal(firstFreeCutStart(occupied, 6, 5), 12, '6..8 の 2 秒の隙間には 5 秒は入らない');
    assert.equal(firstFreeCutStart(occupied, 6, 2), 6, '2 秒なら 6..8 に収まる');
});

test('firstFreeCutStart: 末尾より後ろへ落とすのはそのまま許す（穴あき配置）', () => {
    assert.equal(firstFreeCutStart([{ start: 0, end: 6 }], 30, 4), 30);
});

test('firstFreeCutStart: 占有区間が空なら落とした位置のまま', () => {
    assert.equal(firstFreeCutStart([], 4.2, 3), 4.2);
});

test('firstFreeCutStart: 負の位置は 0 で下限を切る', () => {
    assert.equal(firstFreeCutStart([], -2, 3), 0);
});

test('firstFreeCutStart: 連続する占有区間を順に飛び越えて着地する', () => {
    const occupied = [{ start: 0, end: 4 }, { start: 4, end: 9 }, { start: 9, end: 11 }];
    assert.equal(firstFreeCutStart(occupied, 1, 3), 11);
});
