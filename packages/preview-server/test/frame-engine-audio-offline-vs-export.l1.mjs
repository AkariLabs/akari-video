import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildWebAudioSchedule,
  projectLegacyAudioView,
  readInternalEdit,
} from '../../edit-store/lib/index.js';

const SAMPLE_RATE = 48_000;
const DURATION_SEC = 12;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: options.binary ? null : 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function ffmpeg(args, label) {
  const result = run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...args,
  ]);
  assert.equal(result.status, 0, `${label}: ${result.stderr || `exit ${result.status}`}`);
}

function ffprobeDurationSec(filePath) {
  const result = run(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ]);
  assert.equal(result.status, 0, `ffprobe failed for ${filePath}: ${result.stderr}`);
  const durationSec = Number(String(result.stdout).trim());
  assert.ok(Number.isFinite(durationSec) && durationSec > 0,
    `ffprobe returned invalid duration for ${filePath}: ${result.stdout}`);
  return durationSec;
}

function v2Edit(master = null) {
  const fps = 10;
  return {
    version: 2,
    output: { width: 320, height: 180, fps },
    sources: [
      { id: 'main', path: 'source.mp4', proxy: null },
      { id: 'a-bgm', path: 'audio/bgm.wav', proxy: null },
      { id: 'a-nar', path: 'audio/narration.wav', proxy: null },
      { id: 'a-sfx', path: 'audio/sfx.wav', proxy: null },
    ],
    tracks: [
      {
        id: 'audio-narration', lane: 'audio', items: [{
          id: 'n-0001', at: 4 * fps, duration: 0, role: 'narration',
          source: { kind: 'media', src: 'a-nar', in: 0 },
          gain_db: -6,
          provenance: { provider: 'human' },
        }],
      },
      {
        id: 'audio-bgm', lane: 'audio', items: [{
          id: 'bgm', at: 0, duration: 0, role: 'bgm',
          source: { kind: 'media', src: 'a-bgm', in: 0 },
          gain_db: -3,
          ducking: true,
          fade_in: 2,
          fade_out: 2,
        }],
      },
      {
        id: 'audio-sfx', lane: 'audio', items: [{
          id: 'sfx-1', at: 9 * fps, duration: 0, role: 'sfx',
          source: { kind: 'media', src: 'a-sfx', in: 0 },
          gain_db: -9,
          fade_in: 0.05,
          fade_out: 0.1,
        }],
      },
      {
        id: 'visual-main', lane: 'visual', items: [{
          id: 'cut-1', at: 0, duration: DURATION_SEC * fps,
          source: { kind: 'media', src: 'main', in: 0, out: DURATION_SEC },
        }],
      },
    ],
    ...(master ? { audio: { master } } : {}),
  };
}

function prepareVariantProject(fixtureRoot, destination, master) {
  fs.cpSync(fixtureRoot, destination, { recursive: true });
  fs.mkdirSync(path.join(destination, '.akari'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'edit.json'), `${JSON.stringify(v2Edit(master), null, 2)}\n`);
  fs.writeFileSync(path.join(destination, '.akari', 'lint.json'),
    '{"version":1,"verdict":"pass"}\n');
}

function writeMonoWav(filePath, samples, sampleRate = SAMPLE_RATE) {
  const buffer = Buffer.allocUnsafe(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * (value < 0 ? 32768 : 32767)), 44 + index * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function bandRmsDb(filePath, startSec, durationSec) {
  const result = run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-ss', String(startSec), '-i', filePath,
    '-t', String(durationSec),
    '-af', 'bandpass=f=200:width_type=h:width=20',
    '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1',
  ], { binary: true });
  assert.equal(result.status, 0, `band measurement failed: ${String(result.stderr)}`);
  const values = new Float32Array(
    result.stdout.buffer,
    result.stdout.byteOffset,
    Math.floor(result.stdout.byteLength / 4),
  );
  assert.ok(values.length > 0, `no samples measured at ${startSec}s`);
  let squares = 0;
  for (const value of values) squares += value * value;
  return 20 * Math.log10(Math.max(1e-12, Math.sqrt(squares / values.length)));
}

function ebur128(filePath) {
  const result = run(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-hide_banner', '-nostats', '-i', filePath,
    '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-',
  ]);
  assert.equal(result.status, 0, `ebur128 failed: ${result.stderr}`);
  const last = pattern => [...result.stderr.matchAll(pattern)].at(-1)?.[1];
  const integratedLufs = Number(last(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS/gu));
  const lraLu = Number(last(/\bLRA:\s*(-?\d+(?:\.\d+)?)\s+LU/gu));
  const truePeakDbfs = Number(last(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/gu));
  assert.ok([integratedLufs, lraLu, truePeakDbfs].every(Number.isFinite), result.stderr);
  return { integratedLufs, lraLu, truePeakDbfs };
}

function relativeCurve(filePath, points, plateauSec = 3) {
  const plateauDb = bandRmsDb(filePath, plateauSec - 0.15, 0.3);
  return points.map(atSec => {
    const bandDb = bandRmsDb(filePath, atSec - 0.15, 0.3);
    return { atSec, bandDb, relativeToPlateauDb: bandDb - plateauDb };
  });
}

async function offlineRender(chromium, schedule, encodedAudio) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ({ scheduleValue, encoded, sampleRate, durationSec }) => {
      const bytes = base64 => {
        const binary = atob(base64);
        const value = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) value[index] = binary.charCodeAt(index);
        return value.buffer;
      };
      const decodeContext = new AudioContext({ sampleRate });
      const buffers = {};
      for (const [id, base64] of Object.entries(encoded)) {
        buffers[id] = await decodeContext.decodeAudioData(bytes(base64));
      }
      await decodeContext.close();
      const offline = new OfflineAudioContext(1, Math.ceil(durationSec * sampleRate), sampleRate);
      const apply = (param, events, startTime) => {
        if (events.length === 0) {
          param.setValueAtTime(1, startTime);
          return;
        }
        for (const event of events) {
          const at = startTime + event.offsetSec;
          if (event.method === 'linear') param.linearRampToValueAtTime(event.value, at);
          else if (event.method === 'exponential') param.exponentialRampToValueAtTime(event.value, at);
          else param.setValueAtTime(event.value, at);
        }
      };
      for (const item of scheduleValue.items) {
        const source = offline.createBufferSource();
        const baseGain = offline.createGain();
        source.buffer = buffers[item.id];
        source.loop = item.loop;
        source.connect(baseGain);
        let tail = baseGain;
        if (item.envelopeEvents.length > 0) {
          const envelopeGain = offline.createGain();
          baseGain.connect(envelopeGain);
          tail = envelopeGain;
          apply(envelopeGain.gain, item.envelopeEvents, item.delaySec);
        }
        tail.connect(offline.destination);
        apply(baseGain.gain, item.gainEvents, item.delaySec);
        source.start(item.delaySec, item.sourceOffsetSec, item.durationSec);
      }
      const rendered = await offline.startRendering();
      return Array.from(rendered.getChannelData(0));
    }, {
      scheduleValue: schedule,
      encoded: encodedAudio,
      sampleRate: SAMPLE_RATE,
      durationSec: DURATION_SEC,
    });
  } finally {
    await browser.close();
  }
}

test('OfflineAudioContext preview approximation is numerically compared with render-cut master audio', {
  timeout: 5 * 60_000,
}, async t => {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  if (run(ffmpegPath, ['-version']).status !== 0) return t.skip('ffmpeg is unavailable');
  const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
  if (run(ffprobePath, ['-version']).status !== 0) return t.skip('ffprobe is unavailable');
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return t.skip('playwright is unavailable');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-audio-compare-'));
  const fixtureRoot = path.join(root, 'fixture');
  const audioDirectory = path.join(fixtureRoot, 'audio');
  fs.mkdirSync(audioDirectory, { recursive: true });
  const bgmPath = path.join(audioDirectory, 'bgm.wav');
  const narrationPath = path.join(audioDirectory, 'narration.wav');
  const sfxPath = path.join(audioDirectory, 'sfx.wav');
  const previewPath = path.join(root, 'preview-offline.wav');
  try {
    ffmpeg([
      '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=10:duration=${DURATION_SEC}`,
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(fixtureRoot, 'source.mp4'),
    ], 'video fixture');
    ffmpeg([
      '-f', 'lavfi', '-i', `sine=frequency=200:sample_rate=${SAMPLE_RATE}:duration=${DURATION_SEC}`,
      '-af', 'volume=-12dB', '-c:a', 'pcm_s16le', bgmPath,
    ], 'bgm fixture');
    ffmpeg([
      '-f', 'lavfi', '-i', `sine=frequency=3000:sample_rate=${SAMPLE_RATE}:duration=4`,
      '-af', 'volume=12dB', '-c:a', 'pcm_s16le', narrationPath,
    ], 'narration fixture');
    ffmpeg([
      '-f', 'lavfi', '-i', `sine=frequency=900:sample_rate=${SAMPLE_RATE}:duration=0.5`,
      '-c:a', 'pcm_s16le', sfxPath,
    ], 'sfx fixture');

    const durations = {
      bgm: ffprobeDurationSec(bgmPath),
      narration: ffprobeDurationSec(narrationPath),
      sfx: ffprobeDurationSec(sfxPath),
    };
    const projectedAudio = projectLegacyAudioView(readInternalEdit(v2Edit()));
    assert.equal(projectedAudio.bgm.fadeIn, 2, 'v2 BGM fade_in did not project to fadeIn');
    assert.equal(projectedAudio.bgm.fadeOut, 2, 'v2 BGM fade_out did not project to fadeOut');
    assert.equal(projectedAudio.sfx[0].fade_in, 0.05, 'v2 SFX fade_in projection changed');
    assert.equal(projectedAudio.sfx[0].fade_out, 0.1, 'v2 SFX fade_out projection changed');

    const schedule = buildWebAudioSchedule({
      timelineDurationSec: DURATION_SEC,
      startAtSec: 0,
      audio: {
        bgm: { ...projectedAudio.bgm, durationSec: durations.bgm },
        narration: projectedAudio.narration.map(item => ({
          ...item,
          durationSec: durations.narration,
        })),
        sfx: projectedAudio.sfx.map(item => ({ ...item, durationSec: durations.sfx })),
      },
    });
    assert.equal(schedule.warnings.length, 0, schedule.warnings.join('\n'));
    const samples = await offlineRender(chromium, schedule, {
      bgm: fs.readFileSync(bgmPath).toString('base64'),
      'n-0001': fs.readFileSync(narrationPath).toString('base64'),
      'sfx-1': fs.readFileSync(sfxPath).toString('base64'),
    });
    writeMonoWav(previewPath, samples);

    const previewBaselineDb = bandRmsDb(previewPath, 3.2, 0.4);
    const previewNarrationDb = bandRmsDb(previewPath, 5.2, 0.4);
    const previewDuckDb = previewNarrationDb - previewBaselineDb;
    const fadePoints = [0.5, 1.5, 3, 9, 10.5, 11.5];
    const previewFade = relativeCurve(previewPath, fadePoints);
    const previewLoudness = ebur128(previewPath);
    const renderCut = path.resolve(import.meta.dirname, '../../render-cut/bin/render-cut.mjs');
    const variantSpecs = [
      { id: 'mix-only', master: null },
      { id: 'mastered', master: { denoise: 'off', loudnorm: -14 } },
    ];
    const variants = [];
    for (const variant of variantSpecs) {
      const project = path.join(root, variant.id);
      prepareVariantProject(fixtureRoot, project, variant.master);
      const exportPath = path.join(project, 'exports', 'master.mp4');
      const rendered = run(process.execPath, [
        renderCut, project, '--force', '--out', 'exports/master.mp4', '--quality', 'light',
      ], { timeout: 180_000 });
      assert.equal(rendered.status, 0,
        `${variant.id} render-cut failed: ${rendered.stderr || rendered.stdout}`);
      assert.ok(fs.existsSync(exportPath), `${variant.id} render-cut output is missing`);

      const exportBaselineDb = bandRmsDb(exportPath, 3.2, 0.4);
      const exportNarrationDb = bandRmsDb(exportPath, 5.2, 0.4);
      const exportDuckDb = exportNarrationDb - exportBaselineDb;
      const exportFade = relativeCurve(exportPath, fadePoints);
      const exportLoudness = ebur128(exportPath);
      variants.push({
        id: variant.id,
        master: variant.master,
        bgmGainDuringNarration: {
          previewDuckDb,
          exportDuckDb,
          previewMinusExportDb: previewDuckDb - exportDuckDb,
        },
        fadeShape: previewFade.map((preview, index) => ({
          atSec: preview.atSec,
          previewRelativeDb: preview.relativeToPlateauDb,
          exportRelativeDb: exportFade[index].relativeToPlateauDb,
          previewMinusExportDb: preview.relativeToPlateauDb - exportFade[index].relativeToPlateauDb,
        })),
        loudness: {
          preview: previewLoudness,
          export: exportLoudness,
          previewMinusExport: {
            integratedLufs: previewLoudness.integratedLufs - exportLoudness.integratedLufs,
            lraLu: previewLoudness.lraLu - exportLoudness.lraLu,
            truePeakDbfs: previewLoudness.truePeakDbfs - exportLoudness.truePeakDbfs,
          },
        },
      });
    }
    const output = {
      fixture: {
        durationSec: DURATION_SEC,
        decodedDurationSec: durations,
        bgmHz: 200,
        narrationHz: 3000,
        bgmBandpassHz: 20,
        narrationWindowSec: [5.2, 5.6],
      },
      variants,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
    assert.equal(output.variants.length, 2);
    for (const variant of output.variants) {
      assert.ok(Number.isFinite(variant.bgmGainDuringNarration.previewMinusExportDb));
      assert.equal(variant.fadeShape.length, fadePoints.length);
      assert.ok(variant.fadeShape.every(point => Number.isFinite(point.previewMinusExportDb)));
      assert.ok(Object.values(variant.loudness.previewMinusExport).every(Number.isFinite));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
