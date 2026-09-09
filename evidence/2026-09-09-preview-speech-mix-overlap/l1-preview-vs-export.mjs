#!/usr/bin/env node
/**
 * L1 — 重なった映像クリップの音声が「プレビュー」と「書き出し」で同じ本数鳴ることの実測。
 *
 * 素材: 1 秒ごとに周波数の変わるトーン列（300 + 100*floor(t) Hz）を持つ 10 秒の動画。
 *   V(上段) = source 6..10s を出力 2..6s へ / V(下段) = source 0..6s を出力 0..6s へ
 *   → 出力 2..6s は 2 本重なり。同じ瞬間に「下段のトーン」と「上段のトーン」が別周波数で並ぶので、
 *     混ざっているかどうかを Goertzel パワーで一意に判定できる。
 *
 * プレビュー側: 実機に同梱される生成物 apps/shell/extensions/akari-preview/generated/frame-engine.js
 *   （AkariFrameEngine）を実ブラウザ（Chromium）へ読み込み、readInternalEdit → projectLegacyEdit →
 *   projectSpeechDeclarations → buildWebAudioSchedule → OfflineAudioContext で実際にミックスする。
 * 書き出し側: packages/render-cut を同じ edit.json に対して実行する。
 *
 * BEFORE / AFTER: 修正前の edit-store lib を --before-lib で渡すと宣言列の A/B を同時に取る。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const require = createRequire(path.join(repoRoot, 'apps/shell/package.json'));
const { chromium } = require('playwright-core');

const FPS = 30;
const SAMPLE_RATE = 48_000;
const TIMELINE_SEC = 6;
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');

const beforeLibIndex = process.argv.indexOf('--before-lib');
const beforeLib = beforeLibIndex === -1 ? null : process.argv[beforeLibIndex + 1];

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-l1-speech-mix-'));
const projectRoot = path.join(work, 'project');
fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true });
fs.mkdirSync(path.join(projectRoot, 'exports'), { recursive: true });

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: options.binary ? null : 'utf8', maxBuffer: 256 * 1024 * 1024,
  timeout: options.timeout ?? 300_000, ...options
});

const ffmpeg = (args, label) => {
  const result = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  assert.equal(result.status, 0, `${label}: ${result.stderr || `exit ${result.status}`}`);
};

// --- 素材 ------------------------------------------------------------------
const TONE = "0.5*sin(2*PI*(300+100*floor(t))*t)";
const sourceWav = path.join(projectRoot, 'assets', 'source.wav');
const sourceMp4 = path.join(projectRoot, 'assets', 'source.mp4');
ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=${TONE}:d=10:s=${SAMPLE_RATE}`, '-ac', '1', sourceWav], 'source.wav');
ffmpeg([
  '-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=10',
  '-i', sourceWav, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', sourceMp4
], 'source.mp4');

// --- edit.json（上段 = 宣言順で先頭の visual トラック = cuts の勝者）----------
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/source.mp4', proxy: null }],
  tracks: [
    {
      id: 'visual-upper', lane: 'visual', items: [{
        id: 'upper', at: 60, duration: 120,
        source: { kind: 'media', src: 'main', in: 6, out: 10 }
      }]
    },
    {
      id: 'visual-lower', lane: 'visual', items: [{
        id: 'lower', at: 0, duration: 180,
        source: { kind: 'media', src: 'main', in: 0, out: 6 }
      }]
    }
  ]
};
fs.writeFileSync(path.join(projectRoot, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

// --- 宣言の A/B（同一 edit.json を修正前後の lib に通す）---------------------
const declarationsFrom = async libDir => {
  const kernel = await import(pathToFileURL(path.join(libDir, 'index.js')).href);
  const cuts = kernel.projectLegacyEdit(kernel.readInternalEdit(edit)).cuts;
  const speech = kernel.projectSpeechDeclarations(cuts, { fps: FPS });
  return {
    cuts, speech,
    schedule: kernel.buildWebAudioSchedule({
      timelineDurationSec: TIMELINE_SEC, startAtSec: 0, audio: { speech }
    })
  };
};
const after = await declarationsFrom(path.join(repoRoot, 'packages/edit-store/lib'));
const before = beforeLib ? await declarationsFrom(beforeLib) : null;

// --- 実ブラウザ（実機同梱の frame-engine.js）でプレビュー音声をオフライン合成 ---
const bundle = fs.readFileSync(
  path.join(repoRoot, 'apps/shell/extensions/akari-preview/generated/frame-engine.js'), 'utf8'
);
const wavBase64 = fs.readFileSync(sourceWav).toString('base64');

const browser = await chromium.launch({ args: ['--no-sandbox'] });
let previewSamples;
let previewBeforeSamples = null;
let previewScheduleLog;
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async ({
    cutsValue, scheduleValue, beforeScheduleValue, fps, wav, timelineSec, sampleRate
  }) => {
    const engine = window.AkariFrameEngine;
    // 実機と同じ呼び出し（akari-preview-open-handler の engine.projectSpeechDeclarations(cuts, { fps })）。
    const speech = engine.projectSpeechDeclarations(cutsValue, { fps });
    const bytes = Uint8Array.from(atob(wav), character => character.charCodeAt(0));
    const decode = new AudioContext({ sampleRate });
    const buffer = await decode.decodeAudioData(bytes.buffer);
    await decode.close();
    const render = async schedule => {
      const offline = new OfflineAudioContext(1, Math.ceil(timelineSec * sampleRate), sampleRate);
      for (const item of schedule.items) {
        const source = offline.createBufferSource();
        const gain = offline.createGain();
        source.buffer = buffer;
        source.loop = item.loop;
        source.playbackRate.value = item.playbackRate;
        source.connect(gain).connect(offline.destination);
        for (const event of item.gainEvents) {
          const at = item.delaySec + event.offsetSec;
          if (event.method === 'linear') gain.gain.linearRampToValueAtTime(event.value, at);
          else gain.gain.setValueAtTime(event.value, at);
        }
        source.start(item.delaySec, item.sourceOffsetSec, item.sourceDurationSec);
      }
      const rendered = await offline.startRendering();
      return Array.from(rendered.getChannelData(0));
    };
    return {
      samples: await render(scheduleValue),
      beforeSamples: beforeScheduleValue ? await render(beforeScheduleValue) : null,
      speechIds: speech.map(entry => entry.id),
      scheduled: scheduleValue.items.map(item => ({
        id: item.id, kind: item.kind, track: item.track,
        timelineStartSec: item.timelineStartSec, timelineEndSec: item.timelineEndSec,
        sourceOffsetSec: item.sourceOffsetSec, durationSec: item.durationSec
      })),
      warnings: scheduleValue.warnings
    };
  }, {
    cutsValue: after.cuts, scheduleValue: after.schedule,
    beforeScheduleValue: before ? before.schedule : null,
    fps: FPS, wav: wavBase64, timelineSec: TIMELINE_SEC, sampleRate: SAMPLE_RATE
  });
  previewSamples = Float32Array.from(result.samples);
  previewBeforeSamples = result.beforeSamples ? Float32Array.from(result.beforeSamples) : null;
  previewScheduleLog = result;
} finally {
  await browser.close();
}

// --- 書き出し（render-cut）--------------------------------------------------
const outMp4 = path.join(projectRoot, 'exports', 'out.mp4');
const render = run(process.execPath, [
  path.join(repoRoot, 'packages/render-cut/bin/render-cut.mjs'), projectRoot, '--out', outMp4, '--force'
], { env: { ...process.env, FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE } });
const renderState = JSON.parse(fs.readFileSync(path.join(projectRoot, '.akari/render.json'), 'utf8'));
const plannedCutAudio = renderState.plan.commands.cut_audio;

// 書き出しが planned した cut_audio コマンド（amix=inputs=2）そのものを走らせて音を採る。
// ffmpeg 8.1.x では amix 後の PTS が壊れ、aac/mp4 出力だと 0.01 秒に切り詰められる
// （本票の対象外・render-cut 側の別障害）。計測では出力コーデックだけ PCM/WAV に差し替える。
const plannedAudioWav = path.join(work, 'planned-cut-audio.wav');
const plannedArgs = plannedCutAudio.args.slice(0, -1).map(
  argument => (argument === 'aac' ? 'pcm_s16le' : argument)
).concat(plannedAudioWav);
const plannedRun = run(plannedCutAudio.command, plannedArgs);
assert.equal(plannedRun.status, 0, `planned cut_audio: ${plannedRun.stderr}`);

const probeDuration = filePath => {
  const result = run(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath
  ]);
  return result.status === 0 ? Number(String(result.stdout).trim()) : null;
};
// 同じコマンドを無改変（aac/mp4）でも走らせ、別障害の実測値を証跡に残す。
const plannedAudioMp4 = path.join(work, 'planned-cut-audio.mp4');
run(plannedCutAudio.command, plannedCutAudio.args.slice(0, -1).concat(plannedAudioMp4));

const exportAudioPath = render.status === 0 ? outMp4 : plannedAudioWav;
const exportPcm = run(FFMPEG, [
  '-hide_banner', '-loglevel', 'error', '-i', exportAudioPath,
  '-f', 'f32le', '-ac', '1', '-ar', String(SAMPLE_RATE), 'pipe:1'
], { binary: true });
assert.equal(exportPcm.status, 0, String(exportPcm.stderr));
const exportSamples = new Float32Array(
  exportPcm.stdout.buffer, exportPcm.stdout.byteOffset,
  Math.floor(exportPcm.stdout.byteLength / 4)
);
const exportNotes = {
  renderCutExitCode: render.status,
  renderCutVerdict: renderState.verify?.verdict ?? null,
  renderCutFindings: (renderState.verify?.findings ?? []).map(entry => entry.message),
  plannedAmixInputs: (plannedCutAudio.args.find(argument => String(argument).includes('amix=')) ?? '')
    .match(/amix=inputs=(\d+)/u)?.[1] ?? null,
  plannedCutAudioAacDurationSec: probeDuration(plannedAudioMp4),
  plannedCutAudioPcmDurationSec: probeDuration(plannedAudioWav),
  measuredFrom: render.status === 0 ? 'exports/out.mp4' : 'planned cut_audio command (PCM output)'
};

// --- 計測（Goertzel）--------------------------------------------------------
const tonePower = (samples, centerSec, hz, windowSec = 0.30) => {
  const start = Math.max(0, Math.round((centerSec - windowSec / 2) * SAMPLE_RATE));
  const end = Math.min(samples.length, start + Math.round(windowSec * SAMPLE_RATE));
  const step = 2 * Math.PI * hz / SAMPLE_RATE;
  let real = 0;
  let imaginary = 0;
  const length = end - start;
  for (let index = 0; index < length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, length - 1));
    real += samples[start + index] * window * Math.cos(step * index);
    imaginary -= samples[start + index] * window * Math.sin(step * index);
  }
  return Math.sqrt(real * real + imaginary * imaginary) / Math.max(1, length);
};

const AUDIBLE_POWER = 0.02;

// 出力 t での期待トーン: 下段 = source t → 300+100*floor(t) / 上段 = source 6+(t-2) → 300+100*floor(4+t)
const probes = [2.5, 3.5, 4.5, 5.5].map(t => ({
  atSec: t,
  lowerHz: 300 + 100 * Math.floor(t),
  upperHz: 300 + 100 * Math.floor(t + 4)
}));
const measure = (label, samples) => probes.map(probe => {
  const lower = tonePower(samples, probe.atSec, probe.lowerHz);
  const upper = tonePower(samples, probe.atSec, probe.upperHz);
  const noise = tonePower(samples, probe.atSec, probe.lowerHz + 50);
  return {
    where: label, atSec: probe.atSec,
    lowerHz: probe.lowerHz, lowerPower: Number(lower.toFixed(6)),
    upperHz: probe.upperHz, upperPower: Number(upper.toFixed(6)),
    noiseFloor: Number(noise.toFixed(6)),
    // 実トーンは 0.125 付近、無音側は 1e-5 未満。0.02 は両者の中間（-16dB 相当）。
    lowerAudible: lower > AUDIBLE_POWER, upperAudible: upper > AUDIBLE_POWER
  };
});

const previewRows = measure('preview', previewSamples);
const previewBeforeRows = previewBeforeSamples ? measure('preview-before-fix', previewBeforeSamples) : [];
const exportRows = measure('export', exportSamples);

const report = {
  note: 'L1 — overlapped clips must mix every clip audio in preview, matching the export (amix).',
  fixture: {
    sourceToneHz: '300 + 100*floor(t) per source second',
    upperClip: 'output 2.0-6.0s from source 6.0-10.0s (declared first = cuts winner)',
    lowerClip: 'output 0.0-6.0s from source 0.0-6.0s',
    overlapSec: [2, 6]
  },
  legacyProjection: {
    cutCount: after.cuts.length,
    cutIds: after.cuts.map(cut => cut.id ?? null),
    cutTracks: after.cuts.map(cut => cut.track ?? 0),
    note: 'both clips stay in cuts[] (no transform/crop/opacity → no cross-track layers evacuation)'
  },
  declarations: {
    after: after.speech.map(entry => ({
      id: entry.id, atSec: entry.atSec, durationSec: entry.durationSec,
      inSec: entry.inSec, outSec: entry.outSec, track: entry.track
    })),
    ...(before ? {
      before: before.speech.map(entry => ({
        id: entry.id, atSec: entry.atSec, durationSec: entry.durationSec,
        inSec: entry.inSec, outSec: entry.outSec, track: entry.track
      }))
    } : {})
  },
  previewSchedule: previewScheduleLog.scheduled,
  previewScheduleWarnings: previewScheduleLog.warnings,
  exportNotes,
  measurements: [...previewBeforeRows, ...previewRows, ...exportRows]
};

fs.writeFileSync(
  path.join(here, 'l1-preview-vs-export.json'),
  `${JSON.stringify(report, null, 2)}\n`
);

console.log(JSON.stringify(report, null, 2));

// --- 判定 ------------------------------------------------------------------
assert.equal(after.cuts.length, 2, 'both clips must project into cuts[]');
assert.equal(after.speech.length, 2, 'both overlapped clips must declare speech');
assert.equal(previewScheduleLog.speechIds.length, 2, 'shipped frame-engine bundle must declare 2');
assert.equal(previewScheduleLog.scheduled.length, 2, 'preview must schedule 2 concurrent sources');
for (const row of [...previewRows, ...exportRows]) {
  assert.ok(row.lowerAudible, `${row.where} @${row.atSec}s: lower clip tone ${row.lowerHz}Hz missing`);
  assert.ok(row.upperAudible, `${row.where} @${row.atSec}s: upper clip tone ${row.upperHz}Hz missing`);
}
if (before) {
  const lower = before.speech.find(entry => entry.id === 'cut-1-speech');
  assert.ok(lower && Math.abs(lower.durationSec - 2) < 1e-9,
    'pre-fix baseline must clamp the covered clip to the 0-2s winner window');
  for (const row of previewBeforeRows) {
    assert.ok(!row.lowerAudible,
      `pre-fix preview @${row.atSec}s unexpectedly had the covered clip tone ${row.lowerHz}Hz`);
    assert.ok(row.upperAudible, `pre-fix preview @${row.atSec}s lost the winner tone ${row.upperHz}Hz`);
  }
}

fs.rmSync(work, { recursive: true, force: true });
console.log('L1 OK: preview and export both mix 2 overlapped clip audios');
