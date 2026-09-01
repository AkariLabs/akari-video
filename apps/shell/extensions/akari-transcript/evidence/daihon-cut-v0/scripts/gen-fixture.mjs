#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(ROOT, 'fixture');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30;
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

function captions(count) {
  const specialGaps = new Map([[5, 0.5], [10, 0.65], [15, 0.8], [20, 1], [25, 1.2]]);
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const serial = String(number).padStart(4, '0');
    const start = round(cursor);
    const duration = 0.55;
    const filler = number === 2 ? 'あの' : number === 3 ? 'えー、' : number === 4 ? 'えっと' : null;
    const parts = filler ? [filler, '台本', serial] : ['台本', serial, 'です'];
    const wordDuration = duration / parts.length;
    const words = parts.map((text, wordIndex) => ({
      text,
      start: round(start + wordIndex * wordDuration),
      end: round(start + (wordIndex + 1) * wordDuration)
    }));
    const end = round(start + duration);
    cursor = end + (specialGaps.get(number) ?? 0.05);
    return { id: `c-${serial}`, start, end, text: parts.join(''), speaker: null, sourceRef: null, edited: false, words };
  });
}

async function prepareProject(name, rowCount, version) {
  const project = path.join(FIXTURE, name);
  const rows = captions(rowCount);
  const mediaSeconds = Math.ceil(rows.at(-1).end + 1);
  const media = path.join(project, 'assets', 'base.mp4');
  await mkdir(path.dirname(media), { recursive: true });
  if (!await exists(media)) {
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30',
      '-t', String(mediaSeconds), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
    ], project);
  }
  const edit = version === 2 ? {
    version: 2,
    output: { width: 320, height: 180, fps: FPS },
    sources: [{ id: 'main', path: 'assets/base.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', items: [{
        id: 'main-clip', at: 0, duration: mediaSeconds * FPS,
        source: { kind: 'media', src: 'main', in: 0, out: mediaSeconds }
      }] },
      { id: 'captions', lane: 'visual', content: { from: 'captions.json' } },
      { id: 'a-narration', lane: 'audio', items: [{
        id: 'narration-guard', at: 45, duration: 90, role: 'narration',
        source: { kind: 'media', src: 'main', in: 1.5, out: 4.5 }
      }] }
    ]
  } : {
    version: 1,
    fps: FPS,
    source: 'assets/base.mp4',
    cuts: [{ src: 'base', in: 0, out: mediaSeconds }],
    overlays: [],
    audio: { sfx: [], narration: [] }
  };
  await atomicWrite(path.join(project, 'captions.json'), `${JSON.stringify(rows, null, 2)}\n`);
  await atomicWrite(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  if (!await exists(path.join(project, '.git'))) {
    await run('/usr/bin/git', ['init'], project);
    await run('/usr/bin/git', ['config', 'user.email', 'daihon-cut-fixture@localhost'], project);
    await run('/usr/bin/git', ['config', 'user.name', 'Daihon Cut Fixture'], project);
  }
  await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], project);
  const dirty = await new Promise(resolve => {
    const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: project });
    child.once('close', code => resolve(code !== 0));
  });
  if (dirty) await run('/usr/bin/git', ['commit', '-m', `台本カット ${name} fixture`], project);
  return { name, version, rows: rows.length, mediaSeconds };
}

await mkdir(FIXTURE, { recursive: true });
const generated = [await prepareProject('v2', 500, 2), await prepareProject('v1', 40, 1)];
process.stdout.write(`${JSON.stringify({ ok: true, fixtures: generated })}\n`);
