import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { outputTimeForSourceClock, resolveSourceClockPosition } from '../lib/common/preview-playback-clock.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

test('two-source boundary holds the output clock while the next media clock is not ready', () => {
    const secondCut = { outStart: 6, outEnd: 11, in: 0.5, speed: 1 };
    assert.equal(outputTimeForSourceClock(secondCut, 0, 6, false), 6);
    assert.equal(outputTimeForSourceClock(secondCut, 0.5, 6, true), 6);
    assert.equal(outputTimeForSourceClock(secondCut, 1.25, 6, true), 6.75);
});

test('source swap gates every output-clock consumer until metadata seek completes', () => {
    assert.match(source, /let sourceSwapPending = false/);
    assert.match(source, /sourceSwapPending = true;[\s\S]*onReady\(\);[\s\S]*sourceSwapPending = false;[\s\S]*tick\(true\)/);
    assert.match(source, /outputTimeForSourceClockFn\([\s\S]*!sourceSwapPending[\s\S]*\)/);
    assert.match(source, /if \(!sourceSwapPending\) applyKeepRangeBoundary\(\)/);
});

test('overlapping source seconds never select a segment from another source', () => {
    const segments = [
        { kind: 'src', src: 'a', in: 0, out: 6, outStart: 0, outEnd: 6 },
        { kind: 'src', src: 'b', in: 0.5, out: 5.5, outStart: 6, outEnd: 11 }
    ];
    assert.deepEqual(
        resolveSourceClockPosition(segments, 0, 1),
        { index: 1, time: 0.5, ended: false }
    );
    assert.deepEqual(
        resolveSourceClockPosition(segments, 1, 1),
        { index: 1, time: 1, ended: false }
    );
    assert.match(source, /resolveSourceClockPositionFn\(segments, sourceTime, preferredIndex\)/);
});
