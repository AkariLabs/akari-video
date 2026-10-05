import assert from 'node:assert/strict';
import test from 'node:test';
import { completeTimelineRange, setTimelineRangeEdge, timelineRangeFromClip, timelineRangeFromDrag }
    from '../lib/common/timeline-range.js';
import { timelineDeletePlan } from '../lib/common/timeline-delete-plan.js';
import { AKARI_SHORTCUTS } from '../lib/browser/akari-shortcuts.js';
import { runTimelineCutKernel } from '../lib/common/timeline-cut-kernel.js';

test('I/O overwrites the opposite edge when order becomes invalid', () => {
    assert.deepEqual(setTimelineRangeEdge({ inFrame: 8, outFrame: 12 }, 'in', 12), { inFrame: 12 });
    assert.deepEqual(setTimelineRangeEdge({ inFrame: 8, outFrame: 12 }, 'out', 8), { outFrame: 8 });
    assert.deepEqual(completeTimelineRange(setTimelineRangeEdge({ inFrame: 240 }, 'out', 360)),
        { start: 240, end: 360 });
});

test('clip and ruler drag ranges use frame coordinates', () => {
    assert.deepEqual(timelineRangeFromClip(240, 120), { inFrame: 240, outFrame: 360 });
    assert.deepEqual(timelineRangeFromDrag(360, 240), { inFrame: 240, outFrame: 360 });
    assert.deepEqual(timelineRangeFromDrag(240, 240), {});
});

test('Delete priority and auto ripple decision table', () => {
    for (const autoRipple of [false, true]) for (const shift of [false, true]) {
        const input = { keyframe: true, gap: true, range: true, selection: true, autoRipple, shift, oneSide: false };
        assert.deepEqual(timelineDeletePlan(input), { target: 'keyframe', ripple: false });
        assert.deepEqual(timelineDeletePlan({ ...input, keyframe: false }), { target: 'gap', ripple: true });
        assert.deepEqual(timelineDeletePlan({ ...input, keyframe: false, gap: false }),
            { target: 'range', ripple: autoRipple || shift });
        assert.deepEqual(timelineDeletePlan({ ...input, keyframe: false, gap: false, range: false }),
            { target: 'selection', ripple: autoRipple || shift });
    }
    assert.deepEqual(timelineDeletePlan({ keyframe: false, gap: false, range: false, selection: true,
        autoRipple: true, shift: false, oneSide: true }), { target: 'selection', ripple: false });
    assert.deepEqual(timelineDeletePlan({ keyframe: false, gap: false, range: true, selection: true,
        autoRipple: true, shift: false, oneSide: true }), { target: 'selection', ripple: false });
});

test('new shortcuts use timeline gates and avoid playback keys', () => {
    const ids = ['setIn', 'setOut', 'selectClipRange', 'clearRange', 'rippleDelete', 'toggleAutoRipple',
        'rippleTrimPrevious', 'rippleTrimNext', 'splitAtPlayhead'].map(id => `akari.timeline.${id}`);
    const rows = AKARI_SHORTCUTS.filter(row => ids.includes(row.command.id));
    assert.equal(rows.length, ids.length);
    for (const row of rows) {
        assert.match(row.when, /!akariEditableFocus && !akariImeComposing/);
        assert.ok(!row.keys.some(key => ['j', 'k', 'l', 'up', 'down'].includes(key)));
        assert.ok(row.command.label);
    }
    assert.deepEqual(rows.find(row => row.command.id.endsWith('rippleDelete')).keys,
        ['shift+delete', 'shift+backspace']);
    assert.deepEqual(rows.find(row => row.command.id.endsWith('splitAtPlayhead')).keys, ['ctrlcmd+b']);
});

test('timeline commands pass exact frame, selection, gap, side, and locks to the kernel', () => {
    const edit = { version: 2, output: { fps: 30 }, tracks: [] };
    const calls = [];
    const kernel = Object.fromEntries(['splitAtFrame', 'liftRange', 'extractRange', 'closeGapAt',
        'rippleDeleteItems', 'rippleTrimToPlayhead', 'compactTrackGaps'].map(name =>
        [name, (...args) => { calls.push([name, args]); return { edit, changed: true }; }]));
    const locks = ['locked-a'];
    const run = command => runTimelineCutKernel(edit, { ...command, lockedTrackIds: locks }, kernel);
    run({ kind: 'split', frame: 240, itemIds: ['clip'] });
    run({ kind: 'split', frame: 240 });
    run({ kind: 'range', range: { start: 240, end: 360 }, ripple: false });
    run({ kind: 'range', range: { start: 240, end: 360 }, ripple: true });
    run({ kind: 'gap', trackId: 'v1', frame: 300 });
    run({ kind: 'items', itemIds: ['clip'], oneSide: false });
    run({ kind: 'trim', frame: 300, side: 'prev' });
    run({ kind: 'trim', frame: 300, side: 'next' });
    run({ kind: 'compact', fromItemId: 'clip' });
    assert.deepEqual(calls, [
        ['splitAtFrame', [edit, 240, { itemIds: ['clip'], lockedTrackIds: locks }]],
        ['splitAtFrame', [edit, 240, { lockedTrackIds: locks }]],
        ['liftRange', [edit, { start: 240, end: 360 }, { lockedTrackIds: locks }]],
        ['extractRange', [edit, { start: 240, end: 360 }, { lockedTrackIds: locks }]],
        ['closeGapAt', [edit, 'v1', 300, { lockedTrackIds: locks }]],
        ['rippleDeleteItems', [edit, ['clip'], { lockedTrackIds: locks, oneSide: false }]],
        ['rippleTrimToPlayhead', [edit, 300, 'prev', { lockedTrackIds: locks }]],
        ['rippleTrimToPlayhead', [edit, 300, 'next', { lockedTrackIds: locks }]],
        ['compactTrackGaps', [edit, { lockedTrackIds: locks, fromItemId: 'clip' }]]
    ]);
});
