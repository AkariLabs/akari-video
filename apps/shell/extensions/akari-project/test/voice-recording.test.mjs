import assert from 'node:assert/strict';
import test from 'node:test';
import {
    voiceRecordingFileName, formatRecordingClock, mixToMono, rmsLevel, levelToBars, resampleToPcm16
} from '../lib/common/voice-recording.js';

test('local recording name and clock', () => {
    const when = new Date(2026, 9, 7, 15, 3, 9);
    assert.equal(voiceRecordingFileName(when), 'afreco-2026-10-07-150309.wav');
    assert.equal(formatRecordingClock(0), '00:00:00');
    assert.equal(formatRecordingClock(3661.9), '01:01:01');
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
