import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildAudioMixCommand } from '../src/plan.mjs';

function fixture(audio, duration = 5) {
  const root = mkdtempSync(join(tmpdir(), 'akari-render-clip-fx-'));
  const command = buildAudioMixCommand({
    edit: { audio }, projectRoot: root,
    inputPath: join(root, 'composite.mp4'), outputPath: join(root, 'final.mp4'),
    workDirectory: root, duration, ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe',
  });
  const graphIndex = command.args?.indexOf('-filter_complex') ?? -1;
  return { root, command, graph: graphIndex >= 0 ? command.args[graphIndex + 1] : '' };
}

test('all clip FX defaults preserve the pre-FX BGM filtergraph byte-for-byte', () => {
  const { root, graph } = fixture({ bgm: {
    path: 'music.wav', speed: 1, pitch_semitones: 0, formant: 'preserve', lowcut_hz: 0,
  } });
  try {
    assert.equal(graph, '[1:a]volume=0dB,atrim=duration=5[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0[mixed]');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SFX chain is atrim -> two highpass stages -> denoise -> rubberband -> volume -> afade -> adelay', () => {
  const { root, graph } = fixture({ sfx: [{
    id: 'hit', path: 'hit.wav', t: 1, in: 0.5, out: 4.5,
    speed: 2, pitch_semitones: 12, formant: 'preserve', lowcut_hz: 120,
    denoise: { method: 'fft', strength: 0.6 }, fade_out: 0.5,
  }] });
  try {
    assert.match(graph, /atrim=start=0\.5:end=4\.5,asetpts=PTS-STARTPTS,highpass=f=120:p=2,highpass=f=120:p=2,afftdn=nr=57\.6:nf=-30,rubberband=tempo=2:pitch=2:formant=preserved:pitchq=quality,volume=0dB,afade=t=out:st=1\.5:d=0\.5,adelay=1000:all=1/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('speed 2 halves SFX effective duration and anchors fade-out to the transformed end', () => {
  const { root, graph } = fixture({ sfx: [{
    path: 'hit.wav', t: 0, in: 0, out: 4, speed: 2, fade_out: 0.5,
  }] });
  try {
    assert.match(graph, /rubberband=tempo=2:[^,]+,volume=0dB,afade=t=out:st=1\.5:d=0\.5/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('speed-adjusted envelope input uses the transformed effective duration', () => {
  const { root, command, graph } = fixture({ sfx: [{
    id: 'env-hit', path: 'hit.wav', t: 0, in: 0, out: 4, speed: 2,
    keyframes: [{ t: 0, gain_db: 0 }, { t: 1, gain_db: -6 }],
  }] });
  try {
    assert.equal(command.envelopes.length, 1);
    assert.equal(readFileSync(command.envelopes[0].path).byteLength, 2 * 48_000 * 4);
    assert.match(graph, /rubberband=.*volume=.*\[sfx_base0\].*\[sfx_base0\]\[env_sfx0\]amultiply,adelay=/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('speed-adjusted duck window is sampled inside the transformed two-second clip', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-render-clip-fx-duck-'));
  writeFileSync(join(root, 'analysis.json'), JSON.stringify({
    source: 'camera.mp4', transcript: [{ start: 1, end: 2 }],
  }));
  const command = buildAudioMixCommand({
    edit: {
      output: { fps: 30 },
      sources: [{ id: 'camera', path: 'camera.mp4' }],
      cuts: [{ src: 'camera', in: 0, out: 5 }],
      audio: {
        sfx: [{
          id: 'duck-hit', path: 'hit.wav', t: 0, in: 0, out: 4, speed: 2,
          ducking: true, duck_db: -12, duck_attack: 0.1, duck_release: 0.1,
        }],
        duck_keys: ['speech'],
      },
    },
    projectRoot: root,
    inputPath: join(root, 'composite.mp4'), outputPath: join(root, 'final.mp4'),
    workDirectory: root, duration: 5, ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe',
  });
  try {
    const envelope = command.envelopes.find(item => item.label === 'sfx-0');
    assert.ok(envelope);
    const bytes = readFileSync(envelope.path);
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    assert.equal(samples.length, 2 * 48_000);
    assert.ok(samples[Math.floor(0.5 * 48_000)] > 0.99);
    assert.ok(samples[Math.floor(1.5 * 48_000)] > 0.24);
    assert.ok(samples[Math.floor(1.5 * 48_000)] < 0.26);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BGM keeps stream_loop semantics while applying rubberband before volume', () => {
  const { root, command, graph } = fixture({ bgm: { path: 'music.wav', speed: 1.5 } });
  try {
    assert.ok(command.args.includes('-stream_loop'));
    assert.match(graph, /^\[1:a\]rubberband=tempo=1\.5:pitch=1:formant=preserved:pitchq=quality,volume=0dB/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clip FX provenance records processed ids and per-filter-stage counts', () => {
  const { root, command } = fixture({
    bgm: { id: 'bed', path: 'music.wav', lowcut_hz: 80, denoise: { method: 'nlm', strength: 0.5 } },
    sfx: [{ id: 'hit', path: 'hit.wav', t: 0, in: 0, out: 1, pitch_semitones: 7 }],
  });
  try {
    assert.deepEqual(command.clip_fx, {
      processed_items: ['bed', 'hit'],
      filters: { highpass: 2, afftdn: 0, anlmdn: 1, rubberband: 1 },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('copy plan reports empty clip FX provenance without adding an ffmpeg graph', () => {
  const { root, command } = fixture({});
  try {
    assert.equal(command.operation, 'copy');
    assert.deepEqual(command.clip_fx, {
      processed_items: [], filters: { highpass: 0, afftdn: 0, anlmdn: 0, rubberband: 0 },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
