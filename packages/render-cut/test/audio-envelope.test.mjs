import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildAudioMixCommand } from '../src/plan.mjs';

function fixture(edit) {
  const root = mkdtempSync(join(tmpdir(), 'akari-render-envelope-'));
  const command = buildAudioMixCommand({
    edit,
    projectRoot: root,
    inputPath: join(root, 'composite.mp4'),
    outputPath: join(root, 'final.mp4'),
    workDirectory: root,
    duration: 5,
    ffmpegCommand: 'ffmpeg',
    ffprobeCommand: 'ffprobe',
  });
  return { root, command };
}

test('keyframe なし・duck 区間なしは envelope 入力を作らず既存グラフを保つ', () => {
  const { root, command } = fixture({ audio: { bgm: { path: 'music.wav', gain_db: -12 } } });
  try {
    assert.equal(command.envelopes.length, 0);
    assert.doesNotMatch(command.args.join(' '), /amultiply|env-bgm\.f32/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('全点 0 dB の keyframe は envelope 入力を省略する', () => {
  const { root, command } = fixture({ audio: { bgm: {
    path: 'music.wav', keyframes: [{ t: 0, gain_db: 0 }, { t: 5, gain_db: 0 }],
  } } });
  try {
    assert.equal(command.envelopes.length, 0);
    assert.doesNotMatch(command.args.join(' '), /amultiply/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BGM keyframe は f32le を同期生成し volume 後に amultiply する', () => {
  const { root, command } = fixture({ audio: { bgm: {
    id: 'bed', path: 'music.wav',
    keyframes: [{ t: 0, gain_db: 0 }, { t: 2, gain_db: -12 }, { t: 4, gain_db: 0 }],
  } } });
  try {
    assert.equal(command.envelopes.length, 1);
    assert.equal(readFileSync(command.envelopes[0].path).byteLength, 5 * 48_000 * 4);
    const graph = command.args[command.args.indexOf('-filter_complex') + 1];
    assert.match(
      graph,
      /volume=0dB,atrim=duration=5,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo\[bgm_base\].*\[bgm_base\]\[env_bgm\]amultiply\[bgm_env\]/u,
    );
    assert.doesNotMatch(graph, /sidechaincompress|asplit/u);
    assert.deepEqual(command.envelope.keyframed_items, ['bed']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('amultiply の全経路はクリップを既定 rematrix で stereo 化し env を左右へ単位ゲインで複製する', () => {
  const planSource = readFileSync(new URL('../src/plan.mjs', import.meta.url), 'utf8');
  const clipStereoFormats = planSource.match(
    /aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo/gu,
  ) ?? [];
  const losslessStereoCopies = planSource.match(
    /aformat=sample_fmts=fltp:sample_rates=48000,pan=stereo\|c0=c0\|c1=c0/gu,
  ) ?? [];

  assert.equal(clipStereoFormats.length, 3, 'bgm / sfx / narration の全クリップ経路を stereo 化する');
  assert.equal(losslessStereoCopies.length, 3, 'bgm / sfx / narration の全 env 経路で等倍複製する');
});

test('narration 無しでも analysis transcript の speech 鍵で BGM envelope を作る', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-render-speech-envelope-'));
  try {
    writeFileSync(join(root, 'analysis.json'), JSON.stringify({
      source: 'camera.mp4',
      transcript: [{ start: 1, end: 2 }, { start: 3, end: 4 }],
    }));
    const command = buildAudioMixCommand({
      edit: {
        output: { fps: 30 },
        sources: [{ id: 'camera', path: 'camera.mp4' }],
        cuts: [{ src: 'camera', in: 0, out: 5 }],
        audio: { bgm: { path: 'music.wav', ducking: true }, duck_keys: ['speech'] },
      },
      projectRoot: root,
      inputPath: join(root, 'composite.mp4'),
      outputPath: join(root, 'final.mp4'),
      duration: 5,
      workDirectory: root,
    });
    assert.equal(command.hasNarration, false);
    assert.equal(command.envelope.speech_intervals, 2);
    assert.deepEqual(command.envelope.ducked_items, ['bgm']);
    assert.match(command.args.join(' '), /amultiply/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('plan の envelope 記録は JSON 化でき Float32Array を含まない', () => {
  const { root, command } = fixture({ audio: { bgm: {
    path: 'music.wav', keyframes: [{ t: 0, gain_db: 0 }, { t: 1, gain_db: -6 }],
  } } });
  try {
    const serialized = JSON.stringify(command);
    assert.match(serialized, /"points":2/u);
    assert.doesNotMatch(serialized, /Float32Array/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('analysis.json 不在の speech 鍵は warning 1 行と空区間へ劣化する', () => {
  const { root, command } = fixture({
    cuts: [{ in: 0, out: 5 }],
    audio: { bgm: { path: 'music.wav', ducking: true }, duck_keys: ['speech'] },
  });
  try {
    assert.equal(command.envelope.speech_intervals, 0);
    assert.equal(command.envelopes.length, 0);
    assert.equal(command.warnings.filter(message => /analysis\.json is unavailable/u.test(message)).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
