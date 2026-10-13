import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TRANSITION_VOCABULARY, cutOverlapFrames, areCutsAdjacent,
    planTransitionHandleWindow } from '@akari-video/edit-store';




import { setLanguage } from '@akari-video/i18n';
import { after as resetLanguageAfter } from 'node:test';
setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));
const { transitionFields, cutSnapshot, timelineMethod, timelineSource } = await import('./helpers/perspective-transition-fixture.mjs');
const { transitionOptionLabel, transitionTypeForLabel, createCutTransitionWriteRequest } = await import('../lib/browser/inspector/transition-fields.js');
const { updateItem: updateV2Item } = await import('../lib/common/edit-v2-mutations.js');
const { formatTransitionSeconds, roundTransitionDurationForWrite } = await import('../lib/common/transition-duration.js');
const { resolveBoundaryInDocument, validateTransitionBoundaryWrite } = await import('../lib/common/transition-boundary-write.js');
const { primaryBoundaryBlock, mergeTransitionDeclaration } = await import('../lib/common/transition-boundary-model.js');
const { cachedTransitionHandleInput, clampTransitionHandleForWrite,
    planFetchedTransitionHandle, planNoUriTransitionHandle } = await import('../lib/common/transition-handle-plan.js');
const { transitionWriteIsBlocked } = await import('../lib/common/transition-boundary-state.js');


setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });

test('transition select は「なし」+ 正準語彙の labelJa 配列順を使用する', () => {
    const [row] = transitionFields(cutSnapshot(), () => {});
    assert.equal(row.inputKind, 'select');
    assert.equal(row.options.length, TRANSITION_VOCABULARY.length + 1);
    assert.deepEqual(row.options, ['なし', ...TRANSITION_VOCABULARY.map(entry => entry.labelJa)]);
    assert.equal(row.getValue(), 'なし');
    for (const { id, labelJa } of TRANSITION_VOCABULARY) {
        assert.equal(transitionOptionLabel(id), labelJa);
        assert.equal(transitionTypeForLabel(labelJa), id);
    }
    assert.equal(transitionTypeForLabel('なし'), null);
    assert.equal(transitionTypeForLabel('unknown'), undefined);
});

test('transition の未知種別は raw id を末尾に表示し、書き込み候補としては拒否する', async () => {
    const snapshot = cutSnapshot({ transitionOut: { type: 'future-transition', duration: 0.7 } });
    const [row, duration] = transitionFields(snapshot, async () => assert.fail('unknown write'));
    assert.equal(row.options.at(-1), 'future-transition');
    assert.equal(row.getValue(), 'future-transition');
    assert.equal((await row.write(snapshot, 'future-transition')).ok, false);
    assert.equal((await duration.write(snapshot, '1.2')).ok, false);
    assert.equal(createCutTransitionWriteRequest(snapshot, 'transition-type', 'なし').value, null);
});

test('ディゾルブ選択は既定尺0.5、既存の尺があればその値を保持する', async () => {
    const requests = [];
    for (const duration of [undefined, 1.2]) {
        const snapshot = cutSnapshot({ index: 2, ...(duration ? { transitionOut: { type: 'fade', duration } } : {}) });
        const [row] = transitionFields(snapshot, async request => { requests.push(request); return { ok: true }; });
        assert.deepEqual(await row.write(snapshot, 'ディゾルブ'), { ok: true });
        assert.deepEqual(requests.at(-1), {
            kind: 'cut-transition-out', index: 2, value: { type: 'dissolve', duration: duration ?? 0.5 }
        });
    }
});

test('transition 尺は1.2を書き、resetは0.5、「なし」はnullを書く', async () => {
    const snapshot = cutSnapshot({ transitionOut: { type: 'dissolve', duration: 0.8 } });
    const requests = [];
    const [select, duration] = transitionFields(snapshot, async request => { requests.push(request); return { ok: true }; });
    assert.deepEqual([duration.min, duration.max, duration.scrubStep, duration.displayPrecision, duration.unit], [0.1, 3, 0.05, 2, 's']);
    await duration.write(snapshot, '1.2');
    await duration.reset(snapshot);
    await select.write(snapshot, 'なし');
    assert.deepEqual(requests.map(request => request.value), [
        { type: 'dissolve', duration: 1.2 }, { type: 'dissolve', duration: 0.5 }, null
    ]);
});

test('transitionOut 未設定では尺だけ disabled、blocked なら両行 disabled と理由を表示する', async () => {
    const rows = transitionFields(cutSnapshot(), () => {});
    assert.equal(rows[0].disabled, false);
    assert.equal(rows[1].disabled, true);
    assert.equal(rows[1].title, 'トランジションを選ぶと変更できます');
    for (const transitionOut of [undefined, { type: 'dissolve', duration: 0.5 }]) {
        const snapshot = cutSnapshot({ transitionOut, transitionOutBlocked: '非隣接のため変更できません' });
        const fields = transitionFields(snapshot, async () => assert.fail('blocked write'));
        for (const row of fields) {
            assert.equal(row.disabled, true);
            assert.equal(row.title, snapshot.transitionOutBlocked);
            assert.deepEqual(await row.write(snapshot, '1.2'), { ok: false, message: snapshot.transitionOutBlocked });
        }
    }
});

test('transition 尺の範囲外と非有限入力は ok:false で、境界値は書ける', async () => {
    const snapshot = cutSnapshot({ transitionOut: { type: 'dissolve', duration: 0.5 } });
    const requests = [];
    const row = transitionFields(snapshot, async request => { requests.push(request); return { ok: true }; })[1];
    for (const input of ['0', '0.09', '3.01', '-1', 'NaN', 'Infinity', '']) {
        assert.deepEqual(await row.write(snapshot, input), {
            ok: false, message: 'トランジション尺は 0.1〜3 秒の範囲で入力してください。'
        });
    }
    assert.equal(requests.length, 0);
    for (const input of ['0.1', '3']) assert.equal((await row.write(snapshot, input)).ok, true);
});

const handleWrite = timelineMethod('handleInspectorWrite');
test('cut-transition-out は applyTransitionOut に委譲し、成功・拒否・通知をそのまま返す', async () => {
    const request = createCutTransitionWriteRequest(cutSnapshot(), 'transition-type', 'ディゾルブ');
    for (const result of [{ ok: true }, { ok: false, message: 'blocked' }, { ok: true, message: 'clamped' }]) {
        const calls = [];
        const context = { location: {}, editDocument: { tracks: [] },
            async applyTransitionOut(...args) { calls.push(args); return result; } };
        assert.deepEqual(await handleWrite.call(context, request), result);
        assert.deepEqual(calls, [[request.index, request.value]]);
    }
    assert.deepEqual(await handleWrite.call({ location: {}, legacyReadOnly: true }, request), {
        ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。'
    });
    assert.deepEqual(await handleWrite.call({ location: {}, editDocument: { tracks: [] },
        async applyTransitionOut() { throw new Error('save failed'); } }, request), { ok: false, message: 'save failed' });
});

const applyTransitionOut = timelineMethod('applyTransitionOut', {
    updateV2Item, cutOverlapFrames, areCutsAdjacent, formatTransitionSeconds, roundTransitionDurationForWrite,
    validateTransitionBoundaryWrite, resolveBoundaryInDocument, primaryBoundaryBlock,
    mergeTransitionDeclaration, clampTransitionHandleForWrite,
    transitionWriteIsBlocked,
    ZERO_OVERLAP_TRANSITION_MESSAGE: () => 'zero overlap'
});
function transitionContext(overrides = {}) {
    return {
        location: { editUri: 'edit.json' }, fps: 30, footer: {}, notices: [],
        cutItemIds: ['cut-1', 'cut-2'], compatibilityTimelineTracks: [{ kind: 'cuts' }],
        segments: [{ index: 0, itemId: 'cut-1', track: 0, tlStart: 0, tlEnd: 5 },
            { index: 1, itemId: 'cut-2', track: 0, tlStart: 5, tlEnd: 10 }],
        messages: { warn() {} }, unsupportedTransitionTrack() {}, nonAdjacentTransitionTarget() {},
        nextSameTrackSegment() { return this.segments[1]; },
        async transitionHandlePlan() { return { outcome: 'full', effectiveSeconds: 0.5, halfSeconds: 0.25 }; },
        transitionBoundaryInputs() { return this.segments.map(segment => ({ ...segment,
            trackOrderValid: this.unsupportedTransitionTrack(segment.index) === undefined })); },
        boundaryBlockMessage() { return 'unsupported'; },
        timelineLockedTrackIds() { return []; },
        rawKeyframeItem() { return this.document.tracks[0].items[0]; },
        unsupportedTransitionMessage() { return 'unsupported'; }, cutItemId() { return 'cut-1'; },
        showNotice(message) { this.notices.push(message); }, hideNotice() {},
        document: { version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
            id: 'cut-1', at: 0, duration: 150, source: { kind: 'media', src: 'main', in: 0, out: 5 }
        }, {
            id: 'cut-2', at: 150, duration: 150, source: { kind: 'media', src: 'main', in: 5, out: 10 }
        }] }] },
        async commitEditMutation(_label, mutate) { this.document = mutate(this.document); },
        ...overrides
    };
}

test('applyTransitionOut は通常の保存・削除を ok:true で返す', async () => {
    const context = transitionContext();
    const value = { type: 'dissolve', duration: 0.5 };
    assert.deepEqual(await applyTransitionOut.call(context, 0, value), { ok: true });
    assert.deepEqual(context.document.tracks[0].items[0].source.transition_out, value);
    assert.deepEqual(await applyTransitionOut.call(context, 0, null), { ok: true });
    assert.equal(Object.hasOwn(context.document.tracks[0].items[0].source, 'transition_out'), false);
});

test('applyTransitionOut の複数トラック・非隣接ガードは保存せず ok:false と通知を返す', async () => {
    for (const patch of [{ compatibilityTimelineTracks: [{ kind: 'cuts' }, { kind: 'cuts' }] },
        { segments: [{ index: 0, itemId: 'cut-1', track: 0, tlStart: 0, tlEnd: 5 },
            { index: 1, itemId: 'cut-2', track: 0, tlStart: 6, tlEnd: 10 }] }]) {
        const context = transitionContext({ ...patch, commitEditMutation: () => assert.fail('guarded write') });
        assert.deepEqual(await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 }), {
            ok: false, message: 'unsupported'
        });
        assert.deepEqual(context.notices, ['unsupported']);
    }
});

test('ロック中は「なしにする」も書き込まない', async () => {
    const context = transitionContext({
        segments: [{ index: 0, itemId: 'cut-1', track: 0, tlStart: 0, tlEnd: 5, locked: true },
            { index: 1, itemId: 'cut-2', track: 0, tlStart: 5, tlEnd: 10 }],
        commitEditMutation: () => assert.fail('locked write'),
        commitEditTextMutation: () => assert.fail('locked text write')
    });
    assert.deepEqual(await applyTransitionOut.call(context, 0, null), { ok: false, message: 'unsupported' });
    assert.deepEqual(context.notices, ['unsupported']);
});

test('applyTransitionOut の clamp とゼロ重なりは ok:true + 通知を返す', async () => {
    for (const outcome of ['clamped', 'none']) {
        const context = transitionContext({
            transitionHandlePlan: async () => ({ outcome, effectiveSeconds: outcome === 'clamped' ? 0.2 : 0 })
        });
        const result = await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 });
        assert.equal(result.ok, true);
        assert.equal(result.message, context.notices[0]);
        assert.ok(result.message);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.duration, outcome === 'clamped' ? 0.2 : 0.5);
    }
});

test('applyTransitionOut は実際の handle 計算で保存尺を決める', async () => {
    const actualPlan = timelineMethod('transitionHandlePlan', {
        planFetchedTransitionHandle, planNoUriTransitionHandle
    });
    const actualSyncPlan = timelineMethod('transitionHandlePlanSync', { planTransitionHandleWindow });
    const actualSyncInput = timelineMethod('transitionHandleInputSync', { cachedTransitionHandleInput });
    const cases = [
        { name: 'fetched tail and short incoming head', incomingIn: 0.1, fetched: 10, uri: 'clip.mp4', expected: 0.2 },
        { name: 'unavailable duration', incomingIn: 2, fetched: 'unavailable', uri: 'clip.mp4', expected: 0.5 },
        { name: 'missing URI', incomingIn: 2, fetched: undefined, uri: '', expected: 0.5 },
        { name: 'still image', incomingIn: 2, fetched: undefined, uri: '', still: true, expected: 0.5 }
    ];
    for (const sample of cases) {
        const context = transitionContext({
            cuts: [{ src: 'outgoing', in: 0, out: 5, speed: 1 },
                { src: 'incoming', in: sample.incomingIn, out: sample.incomingIn + 5, speed: 1 }],
            videoDurationCache: new Map(),
            isStillImageCut(cut) { return sample.still === true && cut === this.cuts[0]; },
            cutVideoUri() { return sample.uri; },
            async ensureVideoDurationFetch() { return sample.fetched; },
            transitionHandleInputSync: actualSyncInput,
            transitionHandlePlanSync: actualSyncPlan,
            transitionHandlePlan: actualPlan
        });
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'dissolve', duration: 0.5 })).ok, true, sample.name);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.duration,
            sample.expected, sample.name);
    }
    for (const cached of [undefined, 'pending', 'unavailable']) {
        const context = transitionContext({
            cuts: [{ src: 'outgoing', in: 0, out: 5, speed: 1 },
                { src: 'incoming', in: 0.1, out: 5.1, speed: 1 }],
            videoDurationCache: new Map(cached === undefined ? [] : [['clip.mp4', cached]]),
            isStillImageCut() { return false; },
            cutVideoUri() { return 'clip.mp4'; },
            transitionHandleInputSync: actualSyncInput,
            transitionHandlePlanSync: actualSyncPlan
        });
        assert.equal(actualSyncPlan.call(context, context.segments[0], context.segments[1], 0.5).effectiveSeconds,
            cached === 'unavailable' ? 0 : 0.2);
    }
});

test('transition の snapshot・kind 委譲・Promise 結果と picker 呼び出しが配線される', () => {
    assert.match(timelineSource, /transitionOutBlocked: this\.unsupportedTransitionMessage\(selection\.index\)/u);
    assert.match(timelineSource, /this\.unsupportedTransitionTrack\(selection\.index\) !== undefined\s*\|\| this\.nonAdjacentTransitionTarget\(selection\.index\) !== undefined/u);
    assert.match(timelineSource, /request\.kind === 'cut-transition-out'[\s\S]*?return await this\.applyTransitionOut\(request\.index, request\.value\)/u);
    const body = timelineSource.slice(timelineSource.indexOf('protected async applyTransitionOut('), timelineSource.indexOf('protected nextSameTrackSegment('));
    assert.match(body, /Promise<\{ ok: boolean; message\?: string \}>/u);
    assert.match(body, /return \{ ok: false, message \}/u);
    assert.match(body, /return \{ ok: true, message \}/u);
    assert.match(body, /removeV2TransitionOutWithHandleRetractInSource/u);
    assert.doesNotMatch(body, /return;/u);
    assert.match(timelineSource, /remove: async \(\) => \(await this\.applyTransitionOut\(ref, null\)\)\.ok/u);
});
