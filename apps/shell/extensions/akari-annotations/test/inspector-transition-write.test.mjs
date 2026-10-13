import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cutOverlapFrames, areCutsAdjacent, transitionFamilyOf,
    planTrackTransitions, chooseTransitionAlign, isTransitionAlign, isTransitionType } from '@akari-video/edit-store';




import { setLanguage } from '@akari-video/i18n';
import { after as resetLanguageAfter } from 'node:test';
setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));
const { timelineMethod, timelineSource } = await import('./helpers/perspective-transition-fixture.mjs');
const { transitionDurationValue, transitionDurationTextIsValid, transitionInspectorFields,
    createTransitionSelection } = await import('../lib/common/transition-selection-model.js');
const { updateItem: updateV2Item } = await import('../lib/common/edit-v2-mutations.js');
const { formatTransitionSeconds, roundTransitionDurationForWrite } = await import('../lib/common/transition-duration.js');
const { resolveBoundaryInDocument, validateTransitionBoundaryWrite } = await import('../lib/common/transition-boundary-write.js');
const { primaryBoundaryBlock, mergeTransitionDeclaration } = await import('../lib/common/transition-boundary-model.js');
const { transitionWriteIsBlocked } = await import('../lib/common/transition-boundary-state.js');
const { transitionWritePlan, transitionDeclarationPatch } = await import('../lib/common/transition-write-plan.js');


setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });

const ref = { earlierItemId: 'cut-1', laterItemId: 'cut-2' };
const selection = patch => createTransitionSelection({ ref,
    earlier: { index: 1, name: 'A' }, later: { index: 2, name: 'B' }, locked: false, ...patch });

test('transition boundary fields cover empty, unknown, blocked, locked and removal', () => {
    const empty = transitionInspectorFields(selection());
    assert.equal(empty.type.labelKey, 'transition.inspector.type.none');
    assert.equal(empty.type.disabled, false);
    assert.equal(empty.duration.disabled, true);
    assert.equal(empty.remove, undefined);
    const unknown = transitionInspectorFields(selection({ declaration: { type: 'future-kind', duration: 0.7 } }));
    assert.equal(unknown.type.labelKey, 'transition.family.label.unknown');
    assert.equal(unknown.type.disabled, false);
    assert.equal(unknown.duration.disabled, true);
    assert.equal(unknown.directions.length, 0);
    assert.equal(unknown.remove.disabled, false);
    const blocked = transitionInspectorFields(selection({ block: 'multi-track', declaration: { type: 'fade', duration: 0.5 } }));
    assert.equal(blocked.type.disabled, true);
    assert.equal(blocked.remove.disabled, false);
    assert.equal(blocked.status.key, 'transition.boundary.dead.multiTrack');
    assert.deepEqual(blocked.handles, []);
    const locked = transitionInspectorFields(selection({ locked: true, declaration: { type: 'fade', duration: 0.5 } }));
    assert.equal(locked.type.disabled, true);
    assert.equal(locked.remove.disabled, true);
    assert.equal(locked.status.key, 'transition.inspector.status.locked');
    const lockedWithRoom = transitionInspectorFields(selection({ locked: true, block: 'locked',
        declaration: { type: 'fade', duration: 0.5 }, outgoingTailRoomSeconds: 1,
        incomingHeadRoomSeconds: 0.5 }));
    assert.equal(lockedWithRoom.handles.length, 2);
});

test('transition duration clamps, rounds and resets; invalid input is rejected', () => {
    assert.equal(transitionDurationValue(0.01), 0.1);
    assert.equal(transitionDurationValue(3.8), 3);
    assert.equal(transitionDurationValue(1.23), 1.25);
    assert.equal(transitionDurationValue(null), 0.5);
    assert.throws(() => transitionDurationValue('NaN'));
    for (const input of ['', '  ', 'abc']) assert.equal(transitionDurationTextIsValid(input), false);
    assert.equal(transitionDurationTextIsValid('0.5'), true);
});

test('position buttons preserve unknown values until clicked and disable matching recommendation', () => {
    const declared = { type: 'dissolve', duration: 0.5, align: 'future-side' };
    const unknown = transitionInspectorFields(selection({ declaration: declared,
        recommendedAlign: 'after-cut', placement: { state: 'ok', effectiveSeconds: 0.5,
            reasons: [], legacyOverlap: false } }));
    assert.deepEqual(unknown.align.buttons.map(button => button.pressed), [false, false, false]);
    assert.equal(unknown.align.recommendDisabled, false);
    assert.equal(unknown.status.key, 'transition.inspector.status.unknownAlign');
    const known = transitionInspectorFields(selection({ declaration: { ...declared, align: 'after-cut' },
        recommendedAlign: 'after-cut', placement: { state: 'ok', effectiveSeconds: 0.5,
            reasons: [], legacyOverlap: false } }));
    assert.deepEqual(known.align.buttons.map(button => button.pressed), [false, false, true]);
    assert.equal(known.align.recommendDisabled, true);
    assert.equal(transitionInspectorFields(selection({ declaration: declared,
        placement: { state: 'ok', effectiveSeconds: 0.5, reasons: [], legacyOverlap: true } })).align, undefined);
});

const handleWrite = timelineMethod('handleInspectorWrite', { transitionFamilyOf, isTransitionType, isTransitionAlign });
test('transition-boundary は applyTransitionOut に委譲し、成功・拒否・通知をそのまま返す', async () => {
    const request = { kind: 'transition-boundary', ref, value: { type: 'dissolve', duration: 0.5 } };
    for (const result of [{ ok: true }, { ok: false, message: 'blocked' }, { ok: true, message: 'clamped' }]) {
        const calls = [];
        const context = { location: {}, editDocument: { tracks: [] },
            async applyTransitionOut(...args) { calls.push(args); return result; },
            rememberTransitionDirection() {} };
        assert.deepEqual(await handleWrite.call(context, request), result);
        assert.deepEqual(calls, [[request.ref, request.value]]);
    }
    assert.deepEqual(await handleWrite.call({ location: {}, legacyReadOnly: true }, request), {
        ok: false, message: 'この項目の編集は edit.json v2 のみ対応です。'
    });
    assert.deepEqual(await handleWrite.call({ location: {}, editDocument: { tracks: [] },
        async applyTransitionOut() { throw new Error('save failed'); } }, request), { ok: false, message: 'save failed' });
});

test('transition-boundary rejects out-of-range duration before writing', async () => {
    for (const duration of [0, 0.09, 3.01, NaN, Infinity]) {
        const result = await handleWrite.call({ location: {}, editDocument: { tracks: [] },
            applyTransitionOut: () => assert.fail('invalid duration reached mutation') },
        { kind: 'transition-boundary', ref, value: { type: 'dissolve', duration } });
        assert.equal(result.ok, false);
        assert.match(result.message, /0.1〜3/u);
    }
});

test('transition-boundary rejects unknown types, permits removal and preserves legacy duration on direction change', async () => {
    const calls = [];
    const context = { location: {}, editDocument: { tracks: [] }, currentDuration: 4,
    rawV2Item() { return { source: { transition_out: { duration: this.currentDuration } } }; },
    async applyTransitionOut(...args) { calls.push(args); return { ok: true }; },
    rememberTransitionDirection() {} };
    const request = value => ({ kind: 'transition-boundary', ref, value });
    assert.equal((await handleWrite.call(context, request({ type: 'future-kind', duration: 0.5 }))).ok, false);
    assert.deepEqual(calls, []);
    assert.equal((await handleWrite.call(context, request(null))).ok, true);
    assert.equal((await handleWrite.call(context, request({ type: 'wipe-right', duration: 4 }))).ok, true);
    assert.equal((await handleWrite.call(context, request({ type: 'wipe-right', duration: 3.5 }))).ok, false);
    assert.equal(calls.length, 2);
    context.currentDuration = 0.5;
    assert.equal((await handleWrite.call(context, request({ type: 'wipe-right', duration: 4 }))).ok, false);
    assert.equal(calls.length, 2);
});

test('transition-boundary validates position and recommendation request shape', async () => {
    const seen = [];
    const context = { location: {}, editDocument: { tracks: [] },
        async applyTransitionOut(_ref, value) { seen.push(value); return { ok: true }; },
        rememberTransitionDirection() {} };
    const send = value => handleWrite.call(context, { kind: 'transition-boundary', ref, value });
    for (const align of ['future-side', 42, false, undefined]) {
        assert.equal((await send({ type: 'dissolve', duration: 0.5, align })).ok, false);
    }
    assert.equal((await send({ type: 'dissolve', duration: 0.5, recommendAlign: false })).ok, false);
    for (const align of [null, 'center', 'before-cut', 'after-cut']) {
        assert.equal((await send({ type: 'dissolve', duration: 0.5, align })).ok, true);
    }
    assert.equal((await send({ type: 'dissolve', duration: 0.5 })).ok, true);
    assert.equal((await send({ type: 'dissolve', duration: 0.5, recommendAlign: true })).ok, true);
    assert.equal(seen.length, 6);
});

test('transition snapshot only reports measured outgoing room and keeps readable room when locked', () => {
    const snapshotFor = timelineMethod('transitionSelectionSnapshot', {
        sameBoundary: () => true, cutOverlapFrames: () => 0,
        placeBoundary: () => ({ state: 'full', effectiveSeconds: 0.5 }),
        createTransitionSelection, primaryBoundaryBlock
    });
    const state = {
        activeBoundary: ref, editDocument: {}, fps: 30,
        transitionBoundaryCandidates: () => [{ ref, earlierIndex: 0, laterIndex: 1,
            transitionOut: { type: 'dissolve', duration: 0.5 }, blocks: ['locked'] }],
        segments: [{ index: 0 }, { index: 1 }], cutItemIds: ['cut-1', 'cut-2'],
        cuts: [{ out: 5 }, { in: 0.25 }], videoDurationCache: new Map(),
        isStillImageCut: () => false, cutVideoUri: () => 'clip.mp4',
        transitionHandleInputSync: () => ({ outgoingTailRoomSeconds: 0,
            incomingHeadRoomSeconds: 0.25 }), rawKeyframeItem: () => undefined,
        rawV2Item: () => ({ source: { transition_out: {} } }),
        transitionPlanFor: () => ({ state: 'ok', effectiveSeconds: 0.5, reasons: [], legacyOverlap: false }),
        transitionPlanTrackFor: () => undefined,
        cutSourceName: () => 'clip', transitionPreviewUrls: {}
    };
    for (const cached of [undefined, 'pending', 'unavailable']) {
        state.videoDurationCache = new Map(cached === undefined ? [] : [['clip.mp4', cached]]);
        const snapshot = snapshotFor.call(state);
        assert.equal(snapshot.outgoingTailRoomSeconds, undefined);
        assert.equal(snapshot.incomingHeadRoomSeconds, 0.25);
        assert.equal(transitionInspectorFields(snapshot).handles.length, 1);
    }
    state.videoDurationCache = new Map([['clip.mp4', 5]]);
    assert.equal(transitionInspectorFields(snapshotFor.call(state)).handles.length, 2);
    state.transitionBoundaryCandidates = () => [{ ref, earlierIndex: 0, laterIndex: 1,
        transitionOut: { type: 'dissolve', duration: 0.5 }, blocks: ['gap'] }];
    assert.equal(transitionInspectorFields(snapshotFor.call(state)).handles.length, 0);
});

const applyTransitionOut = timelineMethod('applyTransitionOut', {
    updateV2Item, cutOverlapFrames, areCutsAdjacent, formatTransitionSeconds, roundTransitionDurationForWrite,
    validateTransitionBoundaryWrite, resolveBoundaryInDocument, primaryBoundaryBlock,
    transitionDeclarationPatch, transitionWritePlan, chooseTransitionAlign,
    transitionWriteIsBlocked,
    ZERO_OVERLAP_TRANSITION_MESSAGE: () => 'zero overlap'
});
function transitionContext(overrides = {}) {
    return {
        location: { editUri: 'edit.json' }, fps: 30, footer: {}, notices: [],
        cutItemIds: ['cut-1', 'cut-2'], compatibilityTimelineTracks: [{ kind: 'cuts' }],
        segments: [{ index: 0, itemId: 'cut-1', track: 0, tlStart: 0, tlEnd: 5 },
            { index: 1, itemId: 'cut-2', track: 0, tlStart: 5, tlEnd: 10 }],
        messages: { warn() { assert.fail('duplicate transition toast'); } },
        unsupportedTransitionTrack() {}, nonAdjacentTransitionTarget() {},
        nextSameTrackSegment() { return this.segments[1]; },
        cuts: [{ in: 0, out: 5 }, { in: 5, out: 10 }],
        waitForTransitionMaterial: async () => {},
        rawV2Item(id) { return this.document.tracks[0].items.find(item => item.id === id); },
        transitionPlanTrackFor() {
            const declaration = this.document.tracks[0].items[0].source.transition_out;
            return { clips: [
                { id: '0', startSeconds: 0, lengthSeconds: 5, headRoomSeconds: 0,
                    tailRoomSeconds: this.tailRoom ?? 5,
                    ...(declaration ? { transitionOut: { declaredSeconds: declaration.duration,
                        align: declaration.align ?? 'center', fill: false } } : {}) },
                { id: '1', startSeconds: 5, lengthSeconds: 5,
                    headRoomSeconds: this.cuts[1].in, tailRoomSeconds: 5 }
            ] };
        },
        transitionPlans() { return { plans: planTrackTransitions(this.transitionPlanTrackFor().clips, { fps: this.fps }) }; },
        transitionReasonText: () => 'short clip',
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

test('the document write path clears center, preserves extra fields, and stores recommended positions', async () => {
    for (const originalAlign of ['after-cut', 'future-side']) {
        const context = transitionContext();
        const source = context.document.tracks[0].items[0].source;
        source.transition_out = { type: 'fade', duration: 0.5, align: originalAlign,
            fill: 'future-fill', extra: { keep: true } };
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'dissolve', duration: 0.5 })).ok, true);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.align, originalAlign);
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'dissolve', duration: 0.5, align: null })).ok, true);
        const saved = context.document.tracks[0].items[0].source.transition_out;
        assert.equal(Object.hasOwn(saved, 'align'), false);
        assert.equal(saved.fill, 'future-fill');
        assert.deepEqual(saved.extra, { keep: true });
    }
    for (const requestedAlign of ['after-cut', null]) {
        const context = transitionContext();
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'fade', duration: 0.5, align: requestedAlign })).ok, true);
        const saved = context.document.tracks[0].items[0].source.transition_out;
        assert.equal(saved.align, requestedAlign ?? undefined);
        assert.equal(Object.hasOwn(saved, 'align'), requestedAlign !== null);
    }
    for (const originalAlign of ['after-cut', 'future-side']) {
        const context = transitionContext();
        context.document.tracks[0].items[0].source.transition_out = {
            type: 'fade', duration: 0.5, align: originalAlign, fill: 'future-fill', extra: true };
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'fade', duration: 0.5, recommendAlign: true })).ok, true);
        const saved = context.document.tracks[0].items[0].source.transition_out;
        assert.equal(saved.fill, 'future-fill');
        assert.equal(saved.extra, true);
        assert.equal(saved.align, undefined);
    }
    const recommended = transitionContext({ cuts: [{ in: 0, out: 5 }, { in: 0.1, out: 5.1 }] });
    assert.equal((await applyTransitionOut.call(recommended, 0,
        { type: 'fade', duration: 0.5, recommendAlign: true })).ok, true);
    assert.equal(recommended.document.tracks[0].items[0].source.transition_out.align, 'after-cut');
});

test('inspector request replaces an unknown type through applyTransitionOut and preserves its extra fields', async () => {
    const context = transitionContext();
    context.document.tracks[0].items[0].source.transition_out = {
        type: 'future-kind', duration: 0.7, align: 'start'
    };
    context.location = { editUri: 'edit.json' };
    context.editDocument = { tracks: [] };
    context.applyTransitionOut = (...args) => applyTransitionOut.call(context, ...args);
    context.rememberTransitionDirection = () => {};
    const result = await handleWrite.call(context, { kind: 'transition-boundary', ref,
        value: { type: 'wipe-right', duration: 0.5 } });
    assert.equal(result.ok, true);
    assert.deepEqual(context.document.tracks[0].items[0].source.transition_out,
        { type: 'wipe-right', duration: 0.5, align: 'start' });
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

test('empty boundary Delete does not issue a write', async () => {
    const remove = timelineMethod('removeActiveTransition');
    const state = { activeBoundary: ref, cutItemIds: ['cut-1', 'cut-2'], segments: [],
        applyTransitionOut: () => assert.fail('empty boundary must not write') };
    assert.equal(await remove.call(state), false);
});

test('applyTransitionOut の clamp とゼロ重なりは ok:true + 通知を返す', async () => {
    for (const [head, expected] of [[0.2, 0.2], [0, 0.5]]) {
        const context = transitionContext({ tailRoom: 0,
            cuts: [{ in: 0, out: 5 }, { in: head, out: head + 5 }] });
        const result = await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 });
        assert.equal(result.ok, true);
        assert.equal(context.notices.length, 1);
        assert.equal(result.message, context.notices[0]);
        assert.ok(result.message);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.duration, expected);
    }
});

test('applyTransitionOut は素材の余りを待って位置と保存尺を決める', async () => {
    const cases = [
        { name: 'fetched tail', incomingIn: 0.1, tail: 5, align: 'after-cut' },
        { name: 'unavailable duration', incomingIn: 2, tail: 0, align: 'before-cut' },
        { name: 'missing URI', incomingIn: 2, tail: 0, align: 'before-cut' },
        { name: 'still image', incomingIn: 2, tail: Infinity, align: undefined }
    ];
    for (const sample of cases) {
        const context = transitionContext({
            cuts: [{ src: 'outgoing', in: 0, out: 5, speed: 1 },
                { src: 'incoming', in: sample.incomingIn, out: sample.incomingIn + 5, speed: 1 }],
            tailRoom: sample.tail,
            async waitForTransitionMaterial() { this.waited = true; }
        });
        assert.equal((await applyTransitionOut.call(context, 0,
            { type: 'dissolve', duration: 0.5 })).ok, true, sample.name);
        assert.equal(context.waited, true);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.duration, 0.5);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.align,
            sample.align, sample.name);
    }
});

test('a new transition reports a shorter neighbor and the planned windows do not overlap', async () => {
    const context = transitionContext({
        cutItemIds: ['cut-1', 'cut-2', 'cut-3'],
        cuts: [{ in: 0, out: 2 }, { in: 1, out: 1.6 }, { in: 1, out: 3 }],
        segments: [
            { index: 0, itemId: 'cut-1', track: 0, tlStart: 0, tlEnd: 2, transitionOut: { type: 'fade', duration: 0.5 } },
            { index: 1, itemId: 'cut-2', track: 0, tlStart: 2, tlEnd: 2.6 },
            { index: 2, itemId: 'cut-3', track: 0, tlStart: 2.6, tlEnd: 4.6 }
        ],
        document: { version: 2, output: { fps: 30 }, tracks: [{ id: 'video', lane: 'visual', items: [
            { id: 'cut-1', at: 0, duration: 60, source: { kind: 'media', in: 0, out: 2,
                transition_out: { type: 'fade', duration: 0.5, align: 'after-cut' } } },
            { id: 'cut-2', at: 60, duration: 18, source: { kind: 'media', in: 1, out: 1.6 } },
            { id: 'cut-3', at: 78, duration: 60, source: { kind: 'media', in: 1, out: 3 } }
        ] }] },
        nextSameTrackSegment(index) { return this.segments[index + 1]; },
        transitionPlanTrackFor() {
            const items = this.document.tracks[0].items;
            return { clips: items.map((item, index) => ({ id: String(index),
                startSeconds: item.at / 30, lengthSeconds: item.duration / 30,
                headRoomSeconds: item.source.in, tailRoomSeconds: index === 1 ? 0 : 2,
                ...(item.source.transition_out ? { transitionOut: {
                    declaredSeconds: item.source.transition_out.duration,
                    align: item.source.transition_out.align ?? 'center', fill: false } } : {}) })) };
        }
    });
    const result = await applyTransitionOut.call(context, 1, { type: 'dissolve', duration: 0.5 });
    assert.equal(result.ok, true);
    assert.match(result.message, /C1 と C2 の境目も 0\.3 秒に短くなります/u);
    assert.equal(context.footer.textContent, result.message);
    assert.deepEqual(context.notices, []);
    const plans = context.transitionPlans().plans;
    assert.ok(plans[0].cutSeconds + plans[0].endOffsetSeconds
        <= plans[1].cutSeconds + plans[1].startOffsetSeconds + 1e-9);
});

test('a declaration added while material loads keeps its position and recalculates the saved duration', async () => {
    const context = transitionContext({
        cuts: [{ in: 0, out: 5 }, { in: 0.2, out: 5.2 }], tailRoom: 5,
        async commitEditMutation(_label, mutate) {
            this.document.tracks[0].items[0].source.transition_out = {
                type: 'fade', duration: 0.5, align: 'before-cut' };
            this.document = mutate(this.document);
        }
    });
    const result = await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 });
    assert.equal(result.ok, true);
    assert.deepEqual(context.document.tracks[0].items[0].source.transition_out,
        { type: 'dissolve', duration: 0.2, align: 'before-cut' });
});

test('transition の snapshot・kind 委譲・Promise 結果と picker 呼び出しが配線される', () => {
    assert.match(timelineSource, /transitionOutBlocked: this\.unsupportedTransitionMessage\(selection\.index\)/u);
    assert.match(timelineSource, /this\.unsupportedTransitionTrack\(selection\.index\) !== undefined\s*\|\| this\.nonAdjacentTransitionTarget\(selection\.index\) !== undefined/u);
    assert.match(timelineSource, /request\.kind === 'transition-boundary'[\s\S]*?this\.applyTransitionOut\(request\.ref, request\.value\)/u);
    const body = timelineSource.slice(timelineSource.indexOf('protected async applyTransitionOut('), timelineSource.indexOf('protected nextSameTrackSegment('));
    assert.match(body, /Promise<\{ ok: boolean; message\?: string \}>/u);
    assert.match(body, /return \{ ok: false, message \}/u);
    assert.match(body, /return \{ ok: true, message \}/u);
    assert.match(body, /removeV2TransitionOutWithHandleRetractInSource/u);
    assert.doesNotMatch(body, /return;/u);
    assert.match(timelineSource, /remove: async \(\) => \(await this\.applyTransitionOut\(ref, null\)\)\.ok/u);
});
