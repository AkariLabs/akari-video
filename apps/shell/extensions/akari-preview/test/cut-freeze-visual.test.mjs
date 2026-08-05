import assert from 'node:assert/strict';
import test from 'node:test';

import { checkCutFreezeCrossing } from '../lib/common/cut-freeze-visual.js';

// docs/contract-2026-07-22-render-basics.md #7 (cuts[].freeze): unit-level coverage of the pure
// crossing check the preview webview uses to engage its freeze-hold approximation (real-time
// video+audio pause -- see akari-preview-open-handler.ts and contract-2026-08-02-preview-parity.md
// for the disclosed "no timeline extension" trade-off this drives).

test('no freeze declared: never holds', () => {
    assert.deepEqual(checkCutFreezeCrossing(undefined, 5), { shouldHold: false, holdSeconds: 0 });
    assert.deepEqual(checkCutFreezeCrossing(null, 5), { shouldHold: false, holdSeconds: 0 });
});

test('missing/invalid at_sec never holds', () => {
    assert.equal(checkCutFreezeCrossing({ duration_sec: 1 }, 5).shouldHold, false);
    assert.equal(checkCutFreezeCrossing({ at_sec: -1, duration_sec: 1 }, 5).shouldHold, false);
    assert.equal(checkCutFreezeCrossing({ at_sec: NaN, duration_sec: 1 }, 5).shouldHold, false);
});

test('non-positive duration_sec never holds', () => {
    assert.equal(checkCutFreezeCrossing({ at_sec: 1, duration_sec: 0 }, 5).shouldHold, false);
    assert.equal(checkCutFreezeCrossing({ at_sec: 1, duration_sec: -2 }, 5).shouldHold, false);
});

test('before the freeze point: does not hold', () => {
    const result = checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 1.999);
    assert.equal(result.shouldHold, false);
});

test('exactly at the freeze point: holds (>= boundary, matches cut-freeze.mjs clamp semantics)', () => {
    const result = checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 2);
    assert.equal(result.shouldHold, true);
    assert.equal(result.holdSeconds, 1.5);
});

test('past the freeze point: still reports shouldHold true (caller de-dupes single-trigger)', () => {
    const result = checkCutFreezeCrossing({ at_sec: 2, duration_sec: 1.5 }, 10);
    assert.equal(result.shouldHold, true);
    assert.equal(result.holdSeconds, 1.5);
});

test('at_sec = 0 (freeze at the very start of the cut) holds immediately', () => {
    const result = checkCutFreezeCrossing({ at_sec: 0, duration_sec: 0.5 }, 0);
    assert.equal(result.shouldHold, true);
});

test('non-finite cutLocalPlayedSeconds is treated as 0 rather than propagating NaN', () => {
    const result = checkCutFreezeCrossing({ at_sec: 0, duration_sec: 0.5 }, NaN);
    assert.equal(result.shouldHold, true);
    const notYet = checkCutFreezeCrossing({ at_sec: 1, duration_sec: 0.5 }, NaN);
    assert.equal(notYet.shouldHold, false);
});
