import test from 'node:test';
import assert from 'node:assert/strict';
import {
    computeMaterialGhostRange,
    insertCutIntoEdit,
    planCutDrop,
    materialDropDecision,
    materialGhostVisibility
} from '../lib/common/timeline-material-insert.js';
import { computeCutTrackSegments } from '../lib/common/edit-store.js';
import { readLegacyView, toV2Edit } from './helpers/v2-fixture.mjs';

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
        assert.match(decision.reason, /映像は映像の段へ/);
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
        assert.match(decision.reason, /音は音の段へ/);
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
