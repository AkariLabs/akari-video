import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import store from '@akari-video/edit-store';
import * as lengths from '../lib/common/still-cut-length.js';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import { toV2Edit } from './helpers/v2-fixture.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const widget = read('../lib/browser/akari-annotations-widget.js');
const inspector = read('../lib/browser/akari-inspector-widget.js');
const source = read('../src/browser/akari-annotations-widget.ts');
const inspectorSource = read('../src/browser/akari-inspector-widget.ts');
function between(text, start, end, offset = 0) {
    const a = text.indexOf(start, offset);
    assert.ok(a >= 0, start);
    const b = text.indexOf(end, a + start.length);
    assert.ok(b > a, end);
    return text.slice(a, b);
}
// Execute compiled production branches without loading Theia's DOM/DI runtime.
const previewCode = between(widget, "if (state.kind === 'cut-trim') {", "if (state.kind === 'cut-move') {", widget.indexOf('updateDragPreview(state, clientX, clientY, allowGuide)'));
const previewFn = new Function('state', 'delta', 'showGuide', 'still_cut_length_1', previewCode);
const commitCode = between(widget, "case 'cut-trim': {", "case 'cut-move': {");
const commitFn = new Function('preview', 'still_cut_length_1', 'edit_v2_mutations_1', `const MINIMUM_ITEM_DURATION = 0.15; let mutate, label, message; switch (preview.kind) { ${commitCode} } return mutate;`);
const patchCode = between(widget, "const input = request.kind === 'cut-source-in'", "label = '素材の範囲を変更';");
const patchFn = new Function('request', 'cut', 'indexed', 'still_cut_length_1', `let patch; ${patchCode} return patch;`);
const overlapCode = between(widget, 'cutWouldOverlap(index, at, duration, track) {', '/**');
const overlap = new Function(`return ({ ${overlapCode} }).cutWouldOverlap;`)();
function fixture(path = 'frame.png', next = Infinity) {
    const calls = { cache: 0, fetch: 0, notice: 0, footer: '', durationWarning: false };
    const cut = { in: 0, out: 2, src: 'main' };
    const ctx = {
        fps: 30, cuts: [cut], segments: [{ index: 0, tlStart: 1, tlEnd: 3, speed: 1, track: 0 }],
        isStillImageCut: () => store.isStillImageSourcePath(path), cutVideoUri: () => path,
        videoDurationCache: { get: () => { calls.cache++; return 'unavailable'; } },
        ensureVideoDurationFetch: () => { calls.fetch++; }, showVideoDurationUnavailableNotice: () => { calls.notice++; },
        snapTimeInOutputSpaceWithResult: time => ({ time, snapped: false }),
        cutWouldOverlap: overlap, allowedTransitionOverlap: () => 0,
        setGhostDurationWarning: (_, value) => { calls.durationWarning = value; },
        updateDragFeedback: (_, value) => { calls.footer = value; }, formatTimestamp: String,
        frameAt: value => Math.round(value * 30), cutItemId: () => 'cut-1'
    };
    for (const name of ['setGhostRange', 'setGhostRejected', 'setGhostSnapped', 'hideSnapGuide', 'updateGhostHeaderDuration']) ctx[name] = () => {};
    if (Number.isFinite(next)) ctx.segments.push({ index: 1, tlStart: next, tlEnd: next + 2, track: 0 });
    return { ctx, calls, cut };
}
function preview(ctx, delta, edge = 'right') {
    return previewFn.call(ctx, { kind: 'cut-trim', index: 0, edge, originalIn: ctx.cuts[0].in, originalOut: ctx.cuts[0].out }, delta, false, lengths);
}
function commit(ctx, value, freeze) {
    const doc = toV2Edit({ source: { path: 'source.mp4' }, cuts: [{ at: 1, in: 0, out: 2, ...(freeze ? { freeze } : {}) }] });
    return commitFn.call(ctx, value, lengths, mutations)(doc).tracks[0].items[0];
}
for (const path of ['still.PNG', 'photo.jpg', 'photo.jpeg', 'card.webp', 'card.bmp', 'card.gif', 'assets/generated/frame-empty.png', 'planned-video.png']) {
    test(`${path}: 右端を伸ばして実尺キャッシュ・取得・警告が全て 0 回`, () => {
        const { ctx, calls } = fixture(path);
        const result = preview(ctx, 1.2);
        assert.equal(result.output, 3.2);
        assert.equal(result.maxOutSeconds, undefined);
        assert.deepEqual([calls.cache, calls.fetch, calls.notice, calls.durationWarning], [0, 0, 0, false]);
        assert.doesNotMatch(calls.footer, /実尺確認中|実尺不明/);
        const item = commit(ctx, result);
        assert.equal(item.duration, 96);
        assert.equal(item.source.in, 0);
        assert.equal(item.source.out, 3.2);
    });
}
test('通常・トリマー両方の pointerdown が静止画の実尺先読みをスキップする', () => {
    assert.equal(source.match(/if \(state.kind === 'cut-trim' && state.edge === 'right' && !this.isStillImageCut\(this.cuts\[state.index\]\)\)/g)?.length, 2);
});
test('静止画の両端は 0.5 秒以上・左端延長は at だけ移し source.in を 0 にする', () => {
    const { ctx } = fixture();
    for (const [edge, delta] of [['right', -99], ['left', 99]]) {
        const result = preview(ctx, delta, edge);
        assert.equal(result.output, 0.5);
        assert.equal(commit(ctx, result).duration, 15);
    }
    const extended = commit(ctx, preview(ctx, -0.5, 'left'));
    assert.equal(extended.at, 15);
    assert.equal(extended.duration, 75);
    assert.equal(extended.source.in, 0);
    assert.equal(extended.source.out, 2.5);
    assert.equal(commit(ctx, preview(ctx, -99, 'left')).at, 0);
});
test('端ドラッグは同じ段の隣への食い込みを既存 cutWouldOverlap で拒否', () => {
    const { ctx } = fixture('frame.png', 4);
    assert.equal(preview(ctx, 1).rejected, false);
    assert.equal(preview(ctx, 1.2).rejected, true);
    ctx.segments[1].track = 1;
    assert.equal(preview(ctx, 1.2).rejected, false);
});
test('動画は従来の最小 0.15 秒を保持（音声共用定数も変更なし）', () => {
    const { ctx } = fixture('generated.mp4');
    assert.equal(commit(ctx, { kind: 'cut-trim', index: 0, input: 0, output: 0.15 }).source.out, 0.15);
    assert.throws(() => commit(ctx, { kind: 'cut-trim', index: 0, input: 0, output: 0.14 }), /0.15/);
    assert.match(source, /const MINIMUM_ITEM_DURATION = 0.15;/);
    assert.match(source, /minDuration: MINIMUM_ITEM_DURATION/);
});
test('生成済み mp4 のプレビュー・確定は maxOutSeconds にクランプされる', () => {
    const { ctx } = fixture('generated.mp4');
    ctx.videoDurationCache.get = () => 2.5;
    const result = preview(ctx, 99);
    assert.equal(result.output, 2.5);
    assert.equal(result.maxOutSeconds, 2.5);
    const item = commit(ctx, { ...result, output: 99 });
    assert.equal(item.source.out, 2.5);
    assert.equal(item.duration, 75);
});
test('現状記述: freeze 付き動画を縮めても freeze は残り、at_sec が新しい再生尺を超える', () => {
    const { ctx } = fixture('generated.mp4');
    const freeze = { at_sec: 2, duration_sec: 1 };
    const item = commit(ctx, { kind: 'cut-trim', index: 0, input: 0, output: 1, maxOutSeconds: 2 }, freeze);
    assert.deepEqual(item.source.freeze, freeze);
    assert.equal(item.duration, 30);
    assert.ok(item.source.freeze.at_sec > item.source.out - item.source.in);
    // Existing trim omits freeze.duration_sec from duration; deliberately not repaired here.
    assert.notEqual(item.duration / 30, item.source.out + item.source.freeze.duration_sec);
});
const durationCode = between(inspector, "/\\.(png|jpe?g|webp|bmp|gif)$/iu.test(snapshot.sourcePath ?? '') ? {", '...cutTransitionFields').trim().replace(/,$/, '');
const durationField = snapshot => new Function('snapshot', 'requestWrite', 'formatDurationSeconds', `return (${durationCode});`)(snapshot, async request => request, String);
test('長さ欄 → cut-source-out → duration/source.out を同時更新・手入力は 0.1 秒精度', async () => {
    const snapshot = { sourcePath: 'frame.png', index: 0, outputStart: 1, outputEnd: 3 };
    const field = durationField(snapshot);
    assert.equal(field.label, '長さ');
    assert.equal(field.inputKind, 'scrub-number');
    assert.equal(field.scrubStep, 0.5);
    assert.equal(field.displayPrecision, 1);
    assert.equal(field.min, 0.5);
    const request = await field.write(snapshot, '3.54');
    assert.deepEqual(request, { kind: 'cut-source-out', index: 0, value: 3.5 });
    const { ctx, cut } = fixture();
    assert.deepEqual(patchFn.call(ctx, request, cut, { index: 0 }, lengths), { duration: 105, source: { in: 0, out: 3.5 } });
    assert.deepEqual(patchFn.call(ctx, request, { ...cut, in: 1 }, { index: 0 }, lengths),
        { duration: 105, source: { in: 0, out: 3.5 } }, '既存の source.in が非ゼロでも入力は表示尺');
    assert.equal(field.liveField, undefined, '途中入力は保存しない');
});
test('長さ入力は隣までの最大尺に丸める・最小 0.5 秒・別段には制限されない', () => {
    const { ctx, cut } = fixture('frame.png', 4.2);
    const patch = value => patchFn.call(ctx, { kind: 'cut-source-out', value }, cut, { index: 0 }, lengths);
    assert.deepEqual(patch(99), { duration: 96, source: { in: 0, out: 3.2 } });
    assert.equal(patch(-2).source.out, 0.5);
    ctx.segments[1].track = 1;
    assert.equal(patch(99).source.out, 99);
    ctx.segments[1].track = 0;
    ctx.segments[1].tlStart = 1.2;
    assert.throws(() => patch(1), /0.5/);
});
test('丸めは小数 fps でも 0.5 秒以上かつ隣の手前のフレームに収まる', () => {
    for (const fps of [24, 25, 29.97, 30, 60]) {
        assert.ok(lengths.clampStillCutLength(0.1, fps) >= 0.5);
        assert.ok(lengths.clampStillCutLength(9, fps, 3.51) <= 3.51);
        assert.equal(lengths.clampStillCutLength(9, fps, 0.49), undefined);
    }
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(lengths.clampStillCutLength(value, 30), undefined);
});
test('動画の尺は write のない読み取り専用・音声の尺も読み取り専用', () => {
    const field = durationField({ sourcePath: 'generated.mp4', outputStart: 0, outputEnd: 2 });
    assert.equal(field.label, '尺');
    assert.equal(field.write, undefined);
    assert.equal(field.inputKind, undefined);
    const audio = between(inspectorSource, 'function AUDIO_SECTIONS(', 'function ');
    assert.match(audio, /name: 'audio-duration', label: '尺', getValue:/);
});
test('undo は共通 mutation の 1 手、数値欄のスクラブ途中は onPreview のみ', () => {
    assert.equal(durationField({ sourcePath: 'frame.png', outputStart: 0, outputEnd: 2 }).liveField, undefined);
    const number = read('../src/browser/inspector/number-field.ts');
    assert.doesNotMatch(between(number, 'const move = (event: PointerEvent)', 'const finish ='), /onCommit/);
    assert.match(number, /if \(moved\) void options.onCommit\(current\)/);
    const mutation = between(source, 'protected async performEditMutation(', 'protected async prepareMotionChanges(');
    assert.equal((mutation.match(/this.pushHistory\(entry\)/g) ?? []).length, 1);
});
test('通知は reloadEdit → selection snapshot → onChanged/render → 生成尺再検証につながる', () => {
    assert.match(between(source, 'protected async reloadEdit(', 'protected '), /this.pushSelectionSnapshot\(\)/);
    const model = read('../src/browser/timeline-selection-model.ts');
    assert.match(model, /set snapshot\(value: TimelineSelectionSnapshot\)[\s\S]*?this.onChangedEmitter.fire\(\)/);
    assert.match(inspectorSource, /this.model.onChanged\(\(\) => \{[\s\S]*?this.render\(\)/);
    assert.match(inspectorSource, /draft.output.duration_s !== identity.duration[\s\S]*?draft.output.duration_s = identity.duration;[\s\S]*?this.validateGenerationDraft/);
});
