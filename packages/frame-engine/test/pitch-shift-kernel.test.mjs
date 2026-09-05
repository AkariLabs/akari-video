import assert from 'node:assert/strict';
import test from 'node:test';

import { PitchShiftKernel } from '../dist/index.js';

const SAMPLE_RATE = 48000;

function sine(frequency, seconds = 2, channels = 1) {
  const frames = Math.round(SAMPLE_RATE * seconds);
  return Array.from({ length: channels }, () => {
    const values = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      values[frame] = Math.sin(2 * Math.PI * frequency * frame / SAMPLE_RATE) * 0.5;
    }
    return values;
  });
}

function process(input, ratio, quantum = input[0].length) {
  const kernel = new PitchShiftKernel(SAMPLE_RATE, input.length);
  kernel.setRatio(ratio);
  const output = input.map(() => new Float32Array(input[0].length));
  for (let offset = 0; offset < input[0].length; offset += quantum) {
    const length = Math.min(quantum, input[0].length - offset);
    const inputBlock = input.map(channel => channel.subarray(offset, offset + length));
    const outputBlock = output.map(channel => channel.subarray(offset, offset + length));
    kernel.process(inputBlock, outputBlock);
  }
  return { output, latencyFrames: kernel.latencyFrames };
}

function dominantFrequency(values, start, frames = SAMPLE_RATE) {
  const end = Math.min(values.length, start + frames);
  let crossings = 0;
  for (let index = start + 1; index < end; index += 1) {
    if (values[index - 1] <= 0 && values[index] > 0) crossings += 1;
  }
  return crossings * SAMPLE_RATE / (end - start);
}

function rms(values, start, frames = SAMPLE_RATE) {
  const end = Math.min(values.length, start + frames);
  let sum = 0;
  for (let index = start; index < end; index += 1) sum += values[index] ** 2;
  return Math.sqrt(sum / Math.max(1, end - start));
}

function assertFrequencyPitchShift(inputFrequency, ratio, tolerance) {
  const input = sine(inputFrequency);
  const { output, latencyFrames } = process(input, ratio, 128);
  assert.ok(latencyFrames <= SAMPLE_RATE * 0.1, `latency ${latencyFrames} frames exceeds 100 ms`);
  const steadyStart = latencyFrames + Math.round(SAMPLE_RATE * 0.1);
  const frequency = dominantFrequency(output[0], steadyStart);
  assert.ok(Math.abs(frequency - 440) <= 440 * tolerance,
    `expected 440 Hz ± ${tolerance * 100}%, received ${frequency} Hz`);
  assert.ok(Math.abs(output[0].length - input[0].length) <= input[0].length * 0.01);
  return { input: input[0], output: output[0], steadyStart };
}

test('k1 ratio 1 は入力をサンプル単位で完全バイパスする', () => {
  const input = sine(440, 0.25, 2);
  const { output } = process(input, 1, 128);
  for (let channel = 0; channel < input.length; channel += 1) {
    let maximumDifference = 0;
    for (let frame = 0; frame < input[channel].length; frame += 1) {
      maximumDifference = Math.max(maximumDifference,
        Math.abs(input[channel][frame] - output[channel][frame]));
    }
    assert.ok(maximumDifference <= 1e-6);
  }
});

test('k2 playbackRate 2 相当の 880 Hz を ratio 0.5 で 440 Hz に保つ', () => {
  const { input, output, steadyStart } = assertFrequencyPitchShift(880, 0.5, 0.02);
  const inputRms = rms(input, Math.round(SAMPLE_RATE * 0.1));
  const outputRms = rms(output, steadyStart);
  const differenceDb = 20 * Math.log10(outputRms / inputRms);
  assert.ok(Math.abs(differenceDb) <= 3, `RMS difference ${differenceDb} dB exceeds ±3 dB`);
});

test('k3 previewRate 0.5 / 3 相当の入力も 440 Hz に保つ', () => {
  assertFrequencyPitchShift(220, 2, 0.03);
  assertFrequencyPitchShift(1320, 1 / 3, 0.03);
});

test('k4 stereo は mid 相関の同一オフセットを両 channel に適用する', () => {
  const input = sine(880, 1, 2);
  const { output } = process(input, 0.5, 128);
  let maximumDifference = 0;
  for (let frame = 0; frame < output[0].length; frame += 1) {
    maximumDifference = Math.max(maximumDifference, Math.abs(output[0][frame] - output[1][frame]));
  }
  assert.ok(maximumDifference < 1e-3);
});

test('k5 128-frame streaming と一括処理の出力が一致する', () => {
  const input = sine(880, 1, 2);
  const streamed = process(input, 0.5, 128).output;
  const batched = process(input, 0.5, input[0].length).output;
  let maximumDifference = 0;
  for (let channel = 0; channel < input.length; channel += 1) {
    for (let frame = 0; frame < input[channel].length; frame += 1) {
      maximumDifference = Math.max(maximumDifference,
        Math.abs(streamed[channel][frame] - batched[channel][frame]));
    }
  }
  assert.ok(maximumDifference < 1e-5, `maximum difference ${maximumDifference}`);
});
