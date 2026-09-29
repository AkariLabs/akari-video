import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveTools } from '../src/media/common.mjs';
import { resolveWhisper, transcribeMedia } from '../src/media/transcribe.mjs';

const lines = [
  'きょうは新しい機能をご紹介します。',
  'この道具で音声を編集します。',
  '最後に結果を確認しましょう。',
];

function localEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: localEnv() });
}

function synthesize(root) {
  if (process.platform === 'win32') {
    const quoted = value => `'${value.replaceAll("'", "''")}'`;
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      '$voice = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "ja-JP" } | Select-Object -First 1',
      'if (-not $voice) { exit 3 }',
      '$s.SelectVoice($voice.VoiceInfo.Name)',
      ...lines.flatMap((line, index) => [
        `$s.SetOutputToWaveFile(${quoted(path.join(root, `line-${index}.wav`))})`,
        `$s.Speak(${quoted(line)})`,
        '$s.SetOutputToNull()',
      ]),
      '$s.Dispose()',
    ].join('; ');
    const result = run('powershell.exe', ['-NoProfile', '-Command', script]);
    return result.status === 0
      ? { files: lines.map((_, index) => path.join(root, `line-${index}.wav`)) }
      : { reason: `PowerShell 音声合成を使えない: ${result.error?.message ?? result.stderr?.trim() ?? result.status}` };
  }
  if (process.platform === 'darwin') {
    const files = lines.map((_, index) => path.join(root, `line-${index}.aiff`));
    for (let index = 0; index < lines.length; index++) {
      const result = run('say', ['-v', 'Kyoko', '-o', files[index], lines[index]]);
      if (result.status !== 0) return { reason: `Kyoko 音声合成を使えない: ${result.error?.message ?? result.stderr?.trim() ?? result.status}` };
    }
    return { files };
  }
  return { reason: 'ローカル日本語 TTS が無い' };
}

function startsNear(result, speechStarts) {
  const starts = result.segments.map(segment => segment.words?.[0]?.start).filter(Number.isFinite);
  return speechStarts.map(speechStart => {
    const nearest = starts.filter(start => Math.abs(start - speechStart) <= 1)
      .sort((left, right) => Math.abs(left - speechStart) - Math.abs(right - speechStart))[0];
    return nearest === undefined ? null : Number((nearest - speechStart).toFixed(3));
  });
}

test('製品の無音吸着は日本語 3 文の語頭を発話開始に合わせる', { timeout: 600_000 }, async t => {
  const whisper = resolveWhisper();
  if (!whisper) return t.skip('whisper.cpp のバイナリかモデルが無い');
  if (!['win32', 'darwin'].includes(process.platform)) return t.skip('ローカル日本語 TTS が無い');
  const { ffmpeg, ffprobe } = resolveTools();
  if (!ffmpeg) return t.skip('ffmpeg が無い');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-transcribe-timing-'));
  const priorTmp = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
  process.env.TMP = root;
  process.env.TEMP = root;
  process.env.TMPDIR = root;
  t.after(() => {
    for (const [key, value] of Object.entries(priorTmp)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const synthesis = synthesize(root);
  if (!synthesis.files) return t.skip(synthesis.reason);
  const spoken = synthesis.files;
  const wavPath = path.join(root, 'three-lines.wav');
  const inputs = [
    '-f', 'lavfi', '-t', '2.0', '-i', 'anullsrc=r=16000:cl=mono',
    '-i', spoken[0],
    '-f', 'lavfi', '-t', '1.5', '-i', 'anullsrc=r=16000:cl=mono',
    '-i', spoken[1],
    '-f', 'lavfi', '-t', '1.5', '-i', 'anullsrc=r=16000:cl=mono',
    '-i', spoken[2],
  ];
  const filters = Array.from({ length: 6 }, (_, index) =>
    `[${index}:a]aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono[a${index}]`).join(';')
    + ';' + Array.from({ length: 6 }, (_, index) => `[a${index}]`).join('') + 'concat=n=6:v=0:a=1[out]';
  const concatenated = run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...inputs, '-filter_complex', filters, '-map', '[out]', '-ar', '16000', '-ac', '1',
    '-c:a', 'pcm_s16le', wavPath]);
  assert.equal(concatenated.status, 0, concatenated.stderr);

  const detected = run(ffmpeg, ['-hide_banner', '-nostdin', '-i', wavPath,
    '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-']);
  assert.equal(detected.status, 0, detected.stderr);
  const probed = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', wavPath]);
  assert.equal(probed.status, 0, probed.stderr);
  const wavDuration = Number(probed.stdout.trim());
  assert.ok(Number.isFinite(wavDuration), `WAV の尺を取得できない: ${probed.stdout}`);
  const silences = [];
  let silenceStart = null;
  for (const line of detected.stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) silenceStart = Number(start[1]);
    const end = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (end && silenceStart !== null) {
      silences.push({ start: silenceStart, end: Number(end[1]), duration: Number(end[2]) });
      silenceStart = null;
    }
  }
  const speechStarts = silences
    .filter(silence => silence.duration >= 1.0 && wavDuration - silence.end > 0.05)
    .map(silence => silence.end);
  if (speechStarts.length !== 3) return t.skip(`発話開始を 3 つ検出できない（${speechStarts.length} 件）`);

  const options = { backend: 'whisper-cpp', lang: 'ja', wordBook: false, noRecord: true,
    unrecognized: false, spawnOptions: { env: localEnv() } };
  const snapped = await transcribeMedia(wavPath, options);
  const snappedDiffs = startsNear(snapped, speechStarts);
  t.diagnostic(`吸着あり: ${JSON.stringify(snappedDiffs)} 秒、dtw=${snapped.dtw}`);
  const unsnapped = await transcribeMedia(wavPath, { ...options, timingSnap: false });
  t.diagnostic(`吸着なし: ${JSON.stringify(startsNear(unsnapped, speechStarts))} 秒、dtw=${unsnapped.dtw}`);
  for (let index = 0; index < speechStarts.length; index++) {
    assert.ok(snappedDiffs[index] !== null && Math.abs(snappedDiffs[index]) <= 0.25,
      `文 ${index + 1}: 発話開始 ${speechStarts[index]} 秒、最初の語との差 ${snappedDiffs[index]} 秒`);
  }
});
