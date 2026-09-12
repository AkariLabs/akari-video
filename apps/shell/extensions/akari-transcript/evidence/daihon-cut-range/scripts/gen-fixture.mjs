#!/usr/bin/env node
// L1 fixture: 行間に 0.6 秒の無音がある 5 行 captions.json + v2 edit.json + 「喋りが大きく無音が小さい」音声つき mp4。
// 範囲エディタは getClipWaveform（ffmpeg で PCM 抽出）を使うので、音声トラックの無い素材では波形が出ない。
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FPS = 30;
const SAMPLE_RATE = 22050;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const round = value => Math.round(value * 1000) / 1000;
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});

const LINES = [
  ['むかしむかし', 'あるところに', 'おじいさんが', 'いました'],
  ['おばあさんは', '川へ', '洗濯に', '行きました'],
  ['そこへ', '大きな', '桃が', '流れてきて'],
  ['中から', '元気な', '男の子が', '出てきました'],
  ['めでたし', 'めでたし']
];

// 行内は語が 0.5 秒間隔（語長 0.45 秒 = 語間 0.05 秒）、行と行の間は 0.6 秒あける（無音チップの閾値 0.45 秒より広い）。
function captions() {
  let cursor = 1.0;
  return LINES.map((words, index) => {
    const serial = String(index + 1).padStart(4, '0');
    const start = round(cursor);
    const timed = words.map((text, at) => ({
      text, start: round(start + at * 0.5), end: round(start + at * 0.5 + 0.45)
    }));
    const end = round(timed.at(-1).end + 0.1);
    cursor = end + 0.6;
    return {
      id: `c-${serial}`, start, end, text: words.join(''), speaker: null,
      sourceRef: { segment: index }, edited: false, words: timed
    };
  });
}

/** 語の発話区間だけ大きい 16bit モノラル WAV（無音区間は微小ノイズ）。波形が見て分かる形にする。 */
function wav(seconds, speech) {
  const sampleCount = Math.floor(seconds * SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index++) {
    const t = index / SAMPLE_RATE;
    const loud = speech.some(span => t >= span.start && t < span.end);
    const noise = Math.sin(index * 12.9898) * 43758.5453;
    const value = loud
      ? 0.55 * Math.sin(2 * Math.PI * 180 * t) + 0.18 * Math.sin(2 * Math.PI * 430 * t)
      : 0.004 * (noise - Math.floor(noise) - 0.5);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(value * 32767))), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const rows = captions();
const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
const media = path.join(FIXTURE, 'assets', 'base.mp4');
const audio = path.join(FIXTURE, 'assets', 'speech.wav');
await mkdir(path.dirname(media), { recursive: true });
if (!await exists(media)) {
  await atomicWrite(audio, wav(mediaSeconds, rows.flatMap(row => row.words)));
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=#27313f:s=320x180:r=${FPS}`,
    '-i', audio, '-t', String(mediaSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', media
  ], FIXTURE);
}
const edit = {
  version: 2,
  output: { width: 320, height: 180, fps: FPS },
  sources: [{ id: 'main', path: 'assets/base.mp4' }],
  tracks: [
    { id: 'v-main', lane: 'visual', items: [{
      id: 'main-clip', at: 0, duration: mediaSeconds * FPS,
      source: { kind: 'media', src: 'main', in: 0, out: mediaSeconds }
    }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ]
};
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(rows, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.email', 'daihon-cut-range-fixture@localhost'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.name', 'Daihon Cut Range Fixture'], FIXTURE);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], FIXTURE);
const dirty = await new Promise(resolve => {
  const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE });
  child.once('close', code => resolve(code !== 0));
});
if (dirty) await run('/usr/bin/git', ['commit', '-m', '範囲エディタ L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({
  ok: true, rows: rows.length, mediaSeconds,
  gaps: rows.slice(0, -1).map((row, index) => round(rows[index + 1].start - row.end))
})}\n`);
