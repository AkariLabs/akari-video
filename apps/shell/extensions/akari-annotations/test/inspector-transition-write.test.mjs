import assert from 'node:assert/strict';
import test from 'node:test';
import { TRANSITION_VOCABULARY, cutOverlapFrames, areCutsAdjacent } from '@akari-video/edit-store';
import {
    transitionOptionLabel, transitionTypeForLabel, createCutTransitionWriteRequest
} from '../lib/browser/inspector/transition-fields.js';
import { updateItem as updateV2Item } from '../lib/common/edit-v2-mutations.js';
import { formatTransitionSeconds, roundTransitionDurationForWrite } from '../lib/common/transition-duration.js';
import { transitionFields, cutSnapshot, timelineMethod, timelineSource } from './helpers/perspective-transition-fixture.mjs';

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
    ZERO_OVERLAP_TRANSITION_MESSAGE: 'zero overlap'
});
function transitionContext(overrides = {}) {
    return {
        location: { editUri: 'edit.json' }, fps: 30, segments: [], footer: {}, notices: [],
        messages: { warn() {} }, unsupportedTransitionTrack() {}, nonAdjacentTransitionTarget() {},
        unsupportedTransitionMessage() { return 'unsupported'; }, cutItemId() { return 'cut-1'; },
        showNotice(message) { this.notices.push(message); }, hideNotice() {},
        document: { version: 2, tracks: [{ id: 'video', lane: 'visual', items: [{
            id: 'cut-1', at: 0, duration: 150, source: { kind: 'media', src: 'main', in: 0, out: 5 }
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

test('applyTransitionOut の複数トラック・非隣接ガードは保存せず ok:false と既存通知を返す', async () => {
    for (const guard of ['unsupportedTransitionTrack', 'nonAdjacentTransitionTarget']) {
        const context = transitionContext({ [guard]: () => 0, commitEditMutation: () => assert.fail('guarded write') });
        assert.deepEqual(await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 }), {
            ok: false, message: 'unsupported'
        });
        assert.deepEqual(context.notices, ['unsupported']);
    }
});

test('applyTransitionOut の clamp とゼロ重なりは ok:true + 通知を返す', async () => {
    for (const outcome of ['clamped', 'none']) {
        const context = transitionContext({
            segments: [{ index: 0, tlStart: 0, tlEnd: 5 }],
            nextSameTrackSegment: () => ({ index: 1, tlStart: 5, tlEnd: 10 }),
            transitionHandlePlan: async () => ({ outcome, effectiveSeconds: outcome === 'clamped' ? 0.2 : 0 })
        });
        const result = await applyTransitionOut.call(context, 0, { type: 'dissolve', duration: 0.5 });
        assert.equal(result.ok, true);
        assert.equal(result.message, context.notices[0]);
        assert.ok(result.message);
        assert.equal(context.document.tracks[0].items[0].source.transition_out.duration, outcome === 'clamped' ? 0.2 : 0.5);
    }
});

test('transition の snapshot・kind 委譲・Promise 結果と popup 呼び出しが配線される', () => {
    assert.match(timelineSource, /transitionOutBlocked: this\.unsupportedTransitionMessage\(selection\.index\)/u);
    assert.match(timelineSource, /this\.unsupportedTransitionTrack\(selection\.index\) !== undefined\s*\|\| this\.nonAdjacentTransitionTarget\(selection\.index\) !== undefined/u);
    assert.match(timelineSource, /request\.kind === 'cut-transition-out'[\s\S]*?return await this\.applyTransitionOut\(request\.index, request\.value\)/u);
    const body = timelineSource.slice(timelineSource.indexOf('protected async applyTransitionOut('), timelineSource.indexOf('protected nextSameTrackSegment('));
    assert.match(body, /Promise<\{ ok: boolean; message\?: string \}>/u);
    assert.match(body, /return \{ ok: false, message \}/u);
    assert.match(body, /return \{ ok: true, message \}/u);
    assert.match(body, /removeV2TransitionOutWithHandleRetractInSource/u);
    assert.doesNotMatch(body, /return;/u);
    assert.match(timelineSource, /void this\.applyTransitionOut\(earlierIndex, null\)\.then\(\(\) => this\.closeAnnotationPopup\(\)\)/u);
});
