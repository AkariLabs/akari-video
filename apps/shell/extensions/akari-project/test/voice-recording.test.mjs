import assert from 'node:assert/strict';
import test from 'node:test';
import {
    VOICE_RECORDING_DENOISE, voiceRecordingFileName, formatRecordingClock, canonicalEditUri, preferWorkspaceEditUri,
    mixToMono, rmsLevel, levelToBars, resampleToPcm16
} from '../lib/common/voice-recording.js';

test('recorded voice uses the measured non-muffling denoise preset', () => {
    assert.deepEqual(VOICE_RECORDING_DENOISE, { method: 'nlm', strength: 0.75 });
});

test('local recording name and clock', () => {
    const when = new Date(2026, 9, 7, 15, 3, 9);
    assert.equal(voiceRecordingFileName(when), 'afreco-2026-10-07-150309.wav');
    assert.equal(formatRecordingClock(0), '00:00:00');
    assert.equal(formatRecordingClock(3661.9), '01:01:01');
});

test('edit URI canonicalization matches preview root aliases and path tails', () => {
    assert.equal(canonicalEditUri('file:///tmp/a/edit.json'), 'file:///private/tmp/a/edit.json');
    assert.equal(canonicalEditUri('file:///private/tmp/a/edit.json'), 'file:///private/tmp/a/edit.json');
    assert.equal(canonicalEditUri('file:///Users/x/edit.json'), 'file:///Users/x/edit.json');
    assert.equal(canonicalEditUri('file:///tmp/a/./edit.json/'), 'file:///private/tmp/a/edit.json');
    assert.equal(canonicalEditUri('file:///var/a/../b/edit.json'), 'file:///private/var/b/edit.json');
    assert.equal(canonicalEditUri('file:///etc/a/edit.json'), 'file:///private/etc/a/edit.json');
});

test('the workspace URI is preferred only when it identifies the given edit file', () => {
    assert.equal(preferWorkspaceEditUri('file:///private/tmp/p/edit.json', 'file:///tmp/p/edit.json'),
        'file:///tmp/p/edit.json');
    assert.equal(preferWorkspaceEditUri('file:///Users/x/edit.json', 'file:///Users/y/edit.json'),
        'file:///Users/x/edit.json');
    assert.equal(preferWorkspaceEditUri(undefined, 'file:///tmp/p/edit.json'), undefined);
});

test('level meter, mixing and RMS', () => {
    assert.deepEqual([0, .1, .25, 1].map(level => levelToBars(level, 40)), [0, 16, 40, 40]);
    assert.deepEqual(Array.from(mixToMono([new Float32Array([1, -1]), new Float32Array([-1, 1])])), [0, 0]);
    assert.equal(rmsLevel(new Float32Array([1, -1])), 1);
    assert.equal(rmsLevel(new Float32Array()), 0);
});

test('PCM 16-bit conversion and interval-average resampling', () => {
    const same = resampleToPcm16(new Float32Array([1, -1]), 48000, 48000);
    const sameView = new DataView(same.buffer);
    assert.equal(sameView.getInt16(0, true), 32767);
    assert.equal(sameView.getInt16(2, true), -32768);
    const half = resampleToPcm16(new Float32Array([1, -1, .5, .5]), 96000, 48000);
    const halfView = new DataView(half.buffer);
    assert.equal(half.length, 4);
    assert.equal(halfView.getInt16(0, true), 0);
    assert.equal(halfView.getInt16(2, true), 16383);
});
