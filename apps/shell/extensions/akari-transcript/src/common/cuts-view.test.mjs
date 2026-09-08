import test from 'node:test';
import assert from 'node:assert/strict';
import { cutsJumpButtonLabel, cutsSummary, handEditedLines, isHandEditedCandidate } from '../../lib/common/cuts-view.js';
test('cuts jump label shows selected / total for absent, empty, mixed, and all selected candidates', () => {
    assert.equal(cutsJumpButtonLabel(null), 'カット候補へ（0 / 0）');
    assert.equal(cutsJumpButtonLabel({ candidates: [] }), 'カット候補へ（0 / 0）');
    const cuts = { candidates: Array.from({ length: 22 }, (_, i) => ({ on: i < 3 })) };
    assert.equal(cutsJumpButtonLabel(cuts), 'カット候補へ（3 / 22）');
    cuts.candidates.forEach(candidate => { candidate.on = true; });
    assert.equal(cutsJumpButtonLabel(cuts), 'カット候補へ（22 / 22）');
    cuts.candidates.forEach(candidate => { candidate.on = false; });
    assert.equal(cutsJumpButtonLabel(cuts), 'カット候補へ（0 / 22）');
});
test('selection changes total seconds immediately; overlapping audio is counted once', () => {
    const cuts = { candidates: [{ id: 'a', start: 1, end: 3, on: true, kind: 'filler' }, { id: 'b', start: 2, end: 4, on: true, kind: 'redo' }, { start: 6, end: 8, on: false, kind: 'silence' }] };
    assert.equal(cutsSummary(cuts).seconds, 3); assert.equal(cutsSummary(cuts).count, 2);
    cuts.candidates[1].on = false; assert.equal(cutsSummary(cuts).seconds, 2);
    assert.equal(cutsSummary(cuts).kinds.silence, 1);
});
test('hand-edited lines use one-based numbers, deduplicate, and mark candidates by id', () => {
    const cuts = { hand_edited: [{ candidate: 'a', line: 3 }, { candidate: 'b', line: 3 }, { candidate: 'c', line: 0 }] };
    assert.deepEqual(handEditedLines(cuts), [3]); assert.equal(isHandEditedCandidate(cuts, 'a'), true); assert.equal(isHandEditedCandidate(cuts, 'd'), false);
});
test('absent artifacts have an empty summary and no hand-edited marks', () => {
    assert.equal(cutsSummary(null).seconds, 0); assert.deepEqual(handEditedLines(null), []); assert.equal(isHandEditedCandidate(null, 'a'), false);
});
