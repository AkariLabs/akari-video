import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMultiSourceAudioCutCommand, buildGapAwareMultiSourceAudioCutCommand } from '../src/plan.mjs';
import { renderFixture } from './helpers/cut-audio-supply.mjs';
import { unsplitFixture } from '../../edit-store/test/helpers/cut-audio-supply.mjs';
const ffmpegCommand = fileURLToPath(new URL('../../media-bin/vendor/darwin-arm64/ffmpeg', import.meta.url));
const ffprobeCommand = fileURLToPath(new URL('../../media-bin/vendor/darwin-arm64/ffprobe', import.meta.url));
const graph = c => c.args[c.args.indexOf('-filter_complex') + 1];
function run(command, args, encoding = 'utf8') {
  const r = spawnSync(command, args, { encoding, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.error ?? '') + String(r.stderr));
  return r.stdout;
}
function tone(pcm, frequency, at) {
  const n = 12000, start = Math.round(at * 48000), c = 2 * Math.cos(2 * Math.PI * frequency / 48000);
  assert.ok((start + n) * 4 <= pcm.length);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { const x = pcm.readFloatLE((start + i) * 4) + c * a - b; b = a; a = x; }
  return 2 * Math.sqrt(Math.max(0, a * a + b * b - c * a * b)) / n;
}
test('buildPlan projects layer source audio, respecting visual track mute, on both export engines', () => {
  for (const engine of ['gpu', 'osr']) for (const muted of [false, true]) {
    const doc = unsplitFixture(), base = doc.tracks[0].items[0];
    doc.tracks = [doc.tracks[0], { id: 'upper', lane: 'visual', muted, items: [
      { ...structuredClone(base), id: 'pip', transform: { scale: 0.5 }, source: { ...base.source, gain_db: -6 } },
    ] }];
    renderFixture(doc, engine, ({ plan }) => {
      assert.equal(graph(plan.commands.cut_audio).includes('[layera0]'), !muted);
      if (!muted) {
        assert.match(graph(plan.commands.cut_audio), /volume=-6dB/);
        assert.match(graph(plan.commands.cut_audio), /amix=inputs=2:duration=longest:normalize=0,asetpts=N\/SR\/TB/);
      }
    });
  }
});
test('empty layers retain the exact cut command bytes for sequential, gap-aware and chunked routes', () => {
  for (const build of [buildMultiSourceAudioCutCommand, buildGapAwareMultiSourceAudioCutCommand]) {
    for (const maxInputsPerCommand of [1, 200]) {
      const options = { sourceInputs: [{ id: 'base', path: 'base.mp4', hasAudio: true }],
        cuts: [{ src: 'base', in: 0, out: 2 }, { src: 'base', in: 2, out: 4 }],
        duration: 4, cutPath: '/tmp/base.mp4', ffmpegCommand: 'ffmpeg', ffprobeCommand: null, maxInputsPerCommand };
      assert.equal(JSON.stringify(build(options)), JSON.stringify(build({ ...options, layers: [] })));
    }
  }
});
test('bundled ffmpeg: delayed layer mixes two tones, gain/mute and silent inputs preserve timing and AAC duration', t => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return t.skip('requires bundled darwin-arm64 ffmpeg 8.1.2');
  const root = mkdtempSync(join(tmpdir(), 'layer-audio-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, frequency] of [['base', 300], ['pip', 900]]) run(ffmpegCommand, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=10`,
    '-c:a', 'pcm_s16le', join(root, `${name}.wav`),
  ]);
  run(ffmpegCommand, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=size=16x16:duration=1', '-an', join(root, 'silent.mp4')]);
  const layer = { id: 'pip', kind: 'video', src: 'pip.wav', t: 2, duration: 4, in: 0.707 };
  for (const mode of ['sequential', 'gap', 'chunked', 'layer-only', 'gain', 'mute', 'audio-false', 'silent', 'freeze']) {
    const cutPath = join(root, `${mode}.mp4`);
    const build = mode === 'gap' ? buildGapAwareMultiSourceAudioCutCommand : buildMultiSourceAudioCutCommand;
    const cuts = mode === 'layer-only' ? [] : mode === 'chunked'
      ? [{ src: 'base', in: 0.7, out: 3.7 }, { src: 'base', in: 3.7, out: 6.7 }]
      : [{ src: 'base', in: 0.7, out: 6.7, ...(mode === 'gap' ? { at: 0, track: 0 } : {}) }];
    const patch = mode === 'gain' ? { gain_db: -6 } : mode === 'mute' ? { mute: true }
      : mode === 'audio-false' ? { audio: false } : mode === 'silent' ? { src: 'silent.mp4' }
      : mode === 'freeze' ? { freeze: { at_sec: 1, duration_sec: 1 } } : {};
    const opts = { sourceInputs: [{ id: 'base', path: join(root, 'base.wav'), hasAudio: true }],
      cuts, cutPath, duration: 6, projectRoot: root, ffmpegCommand, ffprobeCommand,
      maxInputsPerCommand: mode === 'chunked' ? 1 : 200 };
    const command = build({ ...opts, layers: [{ ...layer, ...patch }] });
    if (['mute', 'audio-false', 'silent'].includes(mode)) assert.deepEqual(command, build(opts));
    else {
      assert.match(graph(command), /adelay=2000:all=1/);
      assert.match(graph(command), /amix=.*asetpts=N\/SR\/TB/);
    }
    if (command.concat_list) writeFileSync(command.concat_list.path, command.concat_list.content);
    for (const chunk of command.chunks ?? []) run(chunk.command, chunk.args);
    run(command.command, command.args);
    const probe = JSON.parse(run(ffprobeCommand, ['-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,duration:format=duration', '-of', 'json', cutPath]));
    assert.equal(probe.streams[0].codec_name, 'aac');
    assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.03, mode);
    const pcm = run(ffmpegCommand, ['-v', 'error', '-i', cutPath, '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], 'buffer');
    assert.ok(tone(pcm, 900, 1.5) < 0.005, `${mode}: layer must not start early`);
    for (const at of [2.5, 5.5]) {
      assert.ok(mode === 'layer-only' ? tone(pcm, 300, at) < 0.005 : tone(pcm, 300, at) > 0.08, `${mode}: base`);
      const upper = tone(pcm, 900, at);
      if (['mute', 'audio-false', 'silent'].includes(mode)) assert.ok(upper < 0.005, `${mode}: muted upper`);
      else if (mode === 'gain') assert.ok(upper > 0.05 && upper < 0.075, `${mode}: ${upper}`);
      else assert.ok(upper > 0.08 && upper < 0.17, `${mode}: ${upper}`);
    }
    if (mode === 'freeze') assert.ok(tone(pcm, 900, 3.5) < 0.005, 'freeze holds silence');
  }
});
