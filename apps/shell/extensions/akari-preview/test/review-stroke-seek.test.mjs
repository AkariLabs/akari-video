// Exercises the pure review-stroke-seek helper (apps/shell/extensions/akari-preview/src/common/
// review-stroke-seek.ts) against its compiled output, independent of the Electron/Theia runtime.
// Run: `npm run build` (or `tsc -b`) in this extension first, then `node --test test/*.test.mjs`
// from apps/shell/extensions/akari-preview/ — see package.json's "test" script for the combined
// command. createRequire is used (not a static ESM import) so this doesn't depend on Node's
// cjs-module-lexer correctly inferring named exports from the tsc-emitted CommonJS output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveAnnotationStrokeCompositionSeconds } = require('../lib/common/review-stroke-seek.js');

// 2026-07-24-review-board レーンの L1 実機実測をそのまま fixture 化した回帰ケース:
// cut0 = source[0,8] -> timeline[0,8]、cut1 = source[10,18] -> timeline[8,16]。
// sourceT=12・cutIndex=1 のストロークをクリックすると本来 composition 秒 10 になるべきところ、
// 無変換実装では 14（sourceT をそのまま composition 秒として解釈した逆算結果）になっていた。
const TWO_CUT_FIXTURE = [
    { in: 0, out: 8 },
    { in: 10, out: 18 }
];

test('resolveAnnotationStrokeCompositionSeconds: non-first trimmed cut (report repro, sourceT=12/cutIndex=1 -> 10)', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 12, 1), 10);
});

test('resolveAnnotationStrokeCompositionSeconds: first cut is an identity mapping', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 3, 0), 3);
});

test('resolveAnnotationStrokeCompositionSeconds: no cuts falls back to identity (legacy single-source behavior)', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds([], 12, 1), 12);
    assert.equal(resolveAnnotationStrokeCompositionSeconds([], 12, null), 12);
});

test('resolveAnnotationStrokeCompositionSeconds: same source second appears in two cuts, cutIndex disambiguates', () => {
    const overlapping = [
        { in: 0, out: 20 },
        { in: 5, out: 25 }
    ];
    // sourceT=12 falls inside both cuts; cutIndex picks which one the stroke was actually drawn on.
    assert.equal(resolveAnnotationStrokeCompositionSeconds(overlapping, 12, 0), 12);
    assert.equal(resolveAnnotationStrokeCompositionSeconds(overlapping, 12, 1), 20 + (12 - 5));
});

test('resolveAnnotationStrokeCompositionSeconds: missing cutIndex falls back to time-based containment', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 12, null), 10);
});

test('resolveAnnotationStrokeCompositionSeconds: cutIndex out of range falls back to time-based containment', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 12, 99), 10);
});

test('resolveAnnotationStrokeCompositionSeconds: cutIndex references a non-track-0 cut, ignored', () => {
    const withOverlayTrack = [
        { in: 0, out: 8, track: 0 },
        { in: 10, out: 18, track: 1 }
    ];
    // cutIndex 1 is on track 1 (unsupported multi-track case) -> falls back to track 0 cuts only.
    assert.equal(resolveAnnotationStrokeCompositionSeconds(withOverlayTrack, 3, 1), 3);
});

test('resolveAnnotationStrokeCompositionSeconds: respects cut.speed when computing composition offset', () => {
    const withSpeed = [
        { in: 0, out: 8 },
        { in: 10, out: 18, speed: 2 }
    ];
    // cut1 plays at 2x, so 8 source seconds compress into 4 timeline seconds (outStart=8).
    assert.equal(resolveAnnotationStrokeCompositionSeconds(withSpeed, 14, 1), 8 + (14 - 10) / 2);
});

test('resolveAnnotationStrokeCompositionSeconds: sourceT outside every cut clamps to the nearest cut boundary', () => {
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 9, null), 8);
    assert.equal(resolveAnnotationStrokeCompositionSeconds(TWO_CUT_FIXTURE, 100, null), 16);
});
