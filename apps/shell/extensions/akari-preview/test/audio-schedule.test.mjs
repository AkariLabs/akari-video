import assert from 'node:assert/strict';
import test from 'node:test';

import {
    bgmLoopOffsetSeconds,
    resolveBgmSourceOffset,
    resolveSfxTrimWindow,
    resolveTimedScheduleWindow
} from '../lib/common/audio-schedule.js';

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (R6b lane): unit-level coverage of the
// same functions createPreviewAudio (akari-preview-open-handler.ts's injected preview webview
// script) serializes via Function.prototype.toString() -- see audio-schedule.ts's header comment.
// Real playback verification (does the AudioContext actually schedule/produce these values) is
// covered at L1 via CDP/previewAudioDebug per the task brief; this file locks down the pure math.

test('resolveSfxTrimWindow: in/out both present resolves to the material window', () => {
    const result = resolveSfxTrimWindow(1.0, 2.5, 5, 'sfx s-1');
    assert.equal(result.skip, false);
    assert.equal(result.sourceOffset, 1.0);
    assert.equal(result.durationSec, 1.5);
    assert.equal(result.warning, null);
});

test('resolveSfxTrimWindow: in omitted defaults to 0', () => {
    const result = resolveSfxTrimWindow(undefined, 2.5, 5, 'sfx s-1');
    assert.equal(result.skip, false);
    assert.equal(result.sourceOffset, 0);
    assert.equal(result.durationSec, 2.5);
});

test('resolveSfxTrimWindow: out omitted defaults to the material end', () => {
    const result = resolveSfxTrimWindow(1.0, undefined, 5, 'sfx s-1');
    assert.equal(result.skip, false);
    assert.equal(result.sourceOffset, 1.0);
    assert.equal(result.durationSec, 4);
});

test('resolveSfxTrimWindow: in/out both omitted plays the whole material (regression baseline)', () => {
    const result = resolveSfxTrimWindow(undefined, undefined, 5, 'sfx s-1');
    assert.equal(result.skip, false);
    assert.equal(result.sourceOffset, 0);
    assert.equal(result.durationSec, 5);
    assert.equal(result.warning, null);
});

test('resolveSfxTrimWindow: out beyond the material duration clamps to it, with a warning', () => {
    const result = resolveSfxTrimWindow(0, 13, 3, 'sfx s-1');
    assert.equal(result.skip, false);
    assert.equal(result.sourceOffset, 0);
    assert.equal(result.durationSec, 3);
    assert.match(result.warning, /out 13s exceeds the material duration \(3s\); clamped to 3s/);
});

test('resolveSfxTrimWindow: in at or beyond the material duration silently skips, with a warning', () => {
    const atDuration = resolveSfxTrimWindow(3, undefined, 3, 'sfx s-1');
    assert.equal(atDuration.skip, true);
    assert.equal(atDuration.durationSec, 0);
    assert.match(atDuration.warning, /in 3s is at or beyond the material duration \(3s\); skipped \(silent\)/);

    const beyondDuration = resolveSfxTrimWindow(10, undefined, 3, 'sfx s-1');
    assert.equal(beyondDuration.skip, true);
});

test('resolveSfxTrimWindow: out<=in after clamping is a safe silent skip, not a negative-duration window', () => {
    const equal = resolveSfxTrimWindow(2, 2, 5, 'sfx s-1');
    assert.equal(equal.skip, true);
    assert.equal(equal.durationSec, 0);

    const reversed = resolveSfxTrimWindow(3, 1, 5, 'sfx s-1');
    assert.equal(reversed.skip, true);
    assert.equal(reversed.durationSec, 0);
});

test('resolveBgmSourceOffset: in within the material duration passes through unchanged', () => {
    const result = resolveBgmSourceOffset(3.0, 5);
    assert.equal(result.sourceOffset, 3.0);
    assert.equal(result.warning, null);
});

test('resolveBgmSourceOffset: in omitted defaults to 0 (regression baseline)', () => {
    const result = resolveBgmSourceOffset(undefined, 5);
    assert.equal(result.sourceOffset, 0);
    assert.equal(result.warning, null);
});

test('resolveBgmSourceOffset: in at/beyond the material duration clamps to 0, with a warning', () => {
    const atDuration = resolveBgmSourceOffset(5, 5);
    assert.equal(atDuration.sourceOffset, 0);
    assert.match(atDuration.warning, /in 5s is at or beyond the material duration \(5s\); clamped to 0s/);

    const beyondDuration = resolveBgmSourceOffset(20, 5);
    assert.equal(beyondDuration.sourceOffset, 0);
    assert.match(beyondDuration.warning, /in 20s is at or beyond/);
});

test('bgmLoopOffsetSeconds: composes the material offset with the timeline position, wrapping at the material duration', () => {
    // timelinePosition=0 plays from the material's own `in` offset.
    assert.equal(bgmLoopOffsetSeconds(3, 0, 5), 3);
    // Advancing the timeline advances the source position 1:1, up to the material's own end...
    assert.equal(bgmLoopOffsetSeconds(3, 1, 5), 4);
    // ...then wraps (loop semantics: back to material position 0, not back to the `in` offset).
    assert.equal(bgmLoopOffsetSeconds(3, 2, 5), 0);
    assert.equal(bgmLoopOffsetSeconds(3, 7, 5), 0);
    assert.equal(bgmLoopOffsetSeconds(3, 8, 5), 1);
});

test('bgmLoopOffsetSeconds: no offset (in omitted) is the identity mapping modulo material duration (regression baseline)', () => {
    assert.equal(bgmLoopOffsetSeconds(0, 0, 5), 0);
    assert.equal(bgmLoopOffsetSeconds(0, 3, 5), 3);
    assert.equal(bgmLoopOffsetSeconds(0, 12, 5), 2);
});

test('resolveTimedScheduleWindow: starting exactly at an item plays it from its own source offset', () => {
    const result = resolveTimedScheduleWindow(2, 1.5, 1.0, 2, 6, 4);
    assert.equal(result.shouldSchedule, true);
    assert.equal(result.delaySec, 0);
    assert.equal(result.sourceOffsetSec, 1.0);
    assert.equal(result.availableSec, 1.5);
});

test('resolveTimedScheduleWindow: starting before an item delays its start by the gap', () => {
    const result = resolveTimedScheduleWindow(2, 1.5, 1.0, 0, 6, 6);
    assert.equal(result.shouldSchedule, true);
    assert.equal(result.delaySec, 2);
    assert.equal(result.sourceOffsetSec, 1.0);
    assert.equal(result.availableSec, 1.5);
});

test('resolveTimedScheduleWindow: resuming mid-item composes the material source offset with elapsed playback', () => {
    // Item plays material [1.0, 2.5) at timeline t=2 (so timeline [2, 3.5)). Resuming from
    // timeline t=2.6 is 0.6s into the item -- material position should be 1.0+0.6=1.6, with
    // 0.9s of the item's own 1.5s span remaining.
    const result = resolveTimedScheduleWindow(2, 1.5, 1.0, 2.6, 6, 3.4);
    assert.equal(result.shouldSchedule, true);
    assert.equal(result.delaySec, 0);
    assert.ok(Math.abs(result.sourceOffsetSec - 1.6) < 1e-9, `expected sourceOffsetSec ~1.6, got ${result.sourceOffsetSec}`);
    assert.ok(Math.abs(result.availableSec - 0.9) < 1e-9, `expected availableSec ~0.9, got ${result.availableSec}`);
});

test('resolveTimedScheduleWindow: no sourceOffset (narration / sfx without in-out) matches the original mid-resume formula (regression baseline)', () => {
    // Original pre-R6b formula: delay=max(0,t-startAt), offset=max(0,startAt-t), available=min(durationSec-offset, remaining-delay).
    const t = 3;
    const durationSec = 4;
    const startAt = 4;
    const remaining = 10;
    const result = resolveTimedScheduleWindow(t, durationSec, 0, startAt, 20, remaining);
    const expectedOffset = Math.max(0, startAt - t);
    const expectedDelay = Math.max(0, t - startAt);
    const expectedAvailable = Math.min(durationSec - expectedOffset, remaining - expectedDelay);
    assert.equal(result.delaySec, expectedDelay);
    assert.equal(result.sourceOffsetSec, expectedOffset);
    assert.equal(result.availableSec, expectedAvailable);
});

test('resolveTimedScheduleWindow: an item that has already fully ended by startAt is not scheduled', () => {
    const result = resolveTimedScheduleWindow(0, 1, 0, 5, 10, 5);
    assert.equal(result.shouldSchedule, false);
});

test('resolveTimedScheduleWindow: an item starting at/after the timeline duration is not scheduled', () => {
    const result = resolveTimedScheduleWindow(10, 1, 0, 0, 10, 10);
    assert.equal(result.shouldSchedule, false);
});
