#!/usr/bin/env node
// 「済み」の素材を持つ隔離プロジェクトを作る。
// transcriptStates が 'done' を返す条件 = .akari/sidecars/<rel>.analysis/analysis.json の
// transcript が 1 件以上。readTranscribeArtifacts は同ディレクトリの transcripts/*.json と
// diff.json を読む（akari-project/src/node/akari-project-service.ts）。
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(ROOT, 'fixture');
const PROJECT = path.join(FIXTURE, 'done-material');
const REL = 'assets/base.mp4';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
const MEDIA_SECONDS = 12;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});

const LINES = [
  { start: 0.0, end: 1.4, whisper: 'えー、今日は台本パネルの話です', speech: '今日は台本パネルの話です' },
  { start: 1.6, end: 3.0, whisper: 'ボタンを押すと必ず出ます', speech: 'ボタンを押すと必ず出ます' },
  { start: 3.2, end: 4.6, whisper: 'このまま字幕へ、が既定です', speech: 'このまま字幕へが既定です' },
  { start: 4.8, end: 6.2, whisper: '起こし直すも選べます', speech: '起こし直すも選べます' },
  { start: 6.4, end: 7.8, whisper: '比べるは二つ以上で', speech: '比べるは 2 つ以上で' }
];
const segments = key => LINES.map(line => ({ start: line.start, end: line.end, text: line[key] }));

const media = path.join(PROJECT, REL);
await mkdir(path.dirname(media), { recursive: true });
if (!await exists(media)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30',
    '-t', String(MEDIA_SECONDS), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], PROJECT);
}

await writeJson(path.join(PROJECT, 'edit.json'), {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: REL }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: MEDIA_SECONDS * FPS,
      source: { kind: 'media', src: 'main', in: 0, out: MEDIA_SECONDS }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
});
await writeJson(path.join(PROJECT, 'captions.json'), LINES.map((line, index) => ({
  id: `c-${String(index + 1).padStart(4, '0')}`, start: line.start, end: line.end,
  text: line.whisper, speaker: null, sourceRef: null, edited: false, words: null
})));

const analysis = path.join(PROJECT, '.akari/sidecars', `${REL}.analysis`);
await writeJson(path.join(analysis, 'analysis.json'), {
  version: 1, probe: { duration_s: MEDIA_SECONDS },
  transcript: segments('whisper').map((segment, index) => ({ id: `t-${index + 1}`, ...segment }))
});
await writeJson(path.join(analysis, 'transcripts/whisper-cpp.json'), {
  backend: 'whisper-cpp', generated_at: '2026-09-07T22:14:05Z', elapsed_sec: 41.2, cost_usd: 0,
  segments: segments('whisper')
});
await writeJson(path.join(analysis, 'transcripts/speech-analyzer.json'), {
  backend: 'speech-analyzer', generated_at: '2026-09-07T22:15:33Z', elapsed_sec: 7.8, cost_usd: 0,
  segments: segments('speech')
});
await writeJson(path.join(analysis, 'diff.json'), {
  engines: ['whisper-cpp', 'speech-analyzer'], agreement: 0.72,
  items: LINES.filter(line => line.whisper !== line.speech).map((line, index) => ({
    id: `d-${index + 1}`, start: line.start, end: line.end, kind: 'text',
    texts: { 'whisper-cpp': line.whisper, 'speech-analyzer': line.speech }
  }))
});
await mkdir(path.join(PROJECT, '.akari/events'), { recursive: true });

process.stdout.write(`${JSON.stringify({ ok: true, project: PROJECT, relativePath: REL, lines: LINES.length })}\n`);
