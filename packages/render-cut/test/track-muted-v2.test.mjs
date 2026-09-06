import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readRenderEdit } from '../src/internal-render.mjs';
import {
  buildAudioMixCommand,
  buildGapAwareMultiSourceAudioCutCommand,
  buildMultiSourceAudioCutCommand,
} from '../src/plan.mjs';

const temporaryDirectory = join(tmpdir(), 'render-track-muted');

function fixture(muted) {
  const flag = muted === undefined ? {} : { muted };
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [
      { id: 'main', path: 'camera.mp4' },
      ...['sfx', 'narration', 'bgm'].map(id => ({ id, path: `${id}.wav` })),
    ],
    tracks: [
      { id: 'video', lane: 'visual', ...flag, items: [{
        id: 'camera', at: 0, duration: 120,
        source: { kind: 'media', src: 'main', in: 2, out: 10, speed: 2, mute: false },
      }] },
      { id: 'audio', lane: 'audio', ...flag, items:
        ['sfx', 'narration', 'bgm'].map(role => ({
          id: role, role, at: 0, duration: 120,
          source: { kind: 'media', src: role, in: 0, out: 4 },
        })),
      },
    ],
  };
}

test('muted visual tracks produce silent cut commands with the same duration in sequential and gap routes', () => {
  const raw = fixture(true);
  const { edit, internal } = readRenderEdit(raw, temporaryDirectory);
  assert.equal(edit.cuts.length, 1);
  assert.equal(edit.cuts[0].mute, true);
  assert.equal(internal.tracks[0].items[0].declaration.mute, false);
  assert.equal(raw.tracks[0].items[0].source.mute, false);
  for (const build of [buildMultiSourceAudioCutCommand, buildGapAwareMultiSourceAudioCutCommand]) {
    const command = build({
      sourceInputs: [{ id: 'main', path: 'camera.mp4', hasAudio: true, inputIndex: 0 }],
      cuts: edit.cuts, cutPath: join(temporaryDirectory, 'cut-audio.mp4'), duration: 4,
      ffmpegCommand: 'ffmpeg', ffprobeCommand: null,
    });
    const filter = command.args[command.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /anullsrc=r=48000:cl=stereo,atrim=duration=4/);
    assert.doesNotMatch(filter, /\[0:a\]atrim|atempo=|volume=/);
    assert.deepEqual(command.warnings, []);
  }
});

test('muted audio tracks omit sfx narration and bgm inputs and ducking from the mix plan', () => {
  const { edit } = readRenderEdit(fixture(true), temporaryDirectory);
  assert.deepEqual(edit.audio.sfx, []);
  assert.deepEqual(edit.audio.narration, []);
  assert.equal(edit.audio.bgm, undefined);
  const plan = buildAudioMixCommand({
    edit, projectRoot: temporaryDirectory,
    inputPath: join(temporaryDirectory, 'cuts.mp4'),
    outputPath: join(temporaryDirectory, 'output.mp4'), duration: 4,
    ffmpegCommand: 'ffmpeg', ffprobeCommand: null,
  });
  assert.equal(plan.operation, 'copy');
  assert.equal(plan.hasNarration, false);
  assert.equal(plan.args, undefined);
  assert.deepEqual(plan.envelopes, []);
  assert.deepEqual(plan.envelope.ducked_items, []);
  assert.deepEqual(plan.warnings, []);
});

test('omitted and false track mute preserve renderer audio and source mute', () => {
  const baseline = readRenderEdit(fixture(), temporaryDirectory).edit;
  const unmuted = readRenderEdit(fixture(false), temporaryDirectory).edit;
  assert.deepEqual(unmuted.cuts, baseline.cuts);
  assert.deepEqual(unmuted.audio, baseline.audio);
  assert.equal(unmuted.cuts[0].mute, false);
  assert.equal(unmuted.audio.sfx.length, 1);
  assert.equal(unmuted.audio.narration.length, 1);
  assert.ok(unmuted.audio.bgm);
  const raw = fixture(false);
  raw.tracks[0].items[0].source.mute = true;
  assert.equal(readRenderEdit(raw, temporaryDirectory).edit.cuts[0].mute, true);
});

test('muted visual tracks preserve video layers and unmuted sibling audio', () => {
  const raw = fixture();
  raw.tracks[0].items.push({ ...structuredClone(raw.tracks[0].items[0]), id: 'overlap' });
  const baseline = readRenderEdit(raw, temporaryDirectory).edit;
  assert.equal(baseline.layers.length, 2);
  raw.tracks[0].muted = true;
  const projected = readRenderEdit(raw, temporaryDirectory).edit;
  assert.deepEqual(projected.layers, baseline.layers);
  assert.deepEqual(projected.audio, baseline.audio);
});
