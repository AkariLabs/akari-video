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
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const serial = String(number).padStart(4, '0');
    const start = round(index * 1.05);
    const end = round(start + 1);
    const words = [
      { text: '台本', start: round(start + 0.05), end: round(start + 0.3) },
      { text: serial, start: round(start + 0.35), end: round(start + 0.65) },
      { text: 'です', start: round(start + 0.7), end: round(start + 0.95) }
    ];
    return {
      id: `c-${serial}`, start, end, text: `台本${serial}です`, speaker: null,
      sourceRef: { segment: index }, edited: false, words,
      ...(number <= 5 ? { text_style: { color: '#abcdef', stroke: { color: '#111111', width_px: 2 } } } : {}),
      ...(number === 10 ? { style_preset: 'nope-x' } : {}),
      ...(number === 11 ? { x_note: { keep: '未知キー', order: 11 } } : {})
    };
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
      { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
    ]
  } : {
    version: 1, fps: FPS, source: 'assets/base.mp4',
    cuts: [{ src: 'base', in: 0, out: mediaSeconds }], overlays: [], audio: { sfx: [], narration: [] }
  };
  await atomicWrite(path.join(project, 'captions.json'), `${JSON.stringify(rows, null, 2)}\n`);
  await atomicWrite(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  if (!await exists(path.join(project, '.git'))) {
    await run('/usr/bin/git', ['init'], project);
    await run('/usr/bin/git', ['config', 'user.email', 'daihon-style-preset-fixture@localhost'], project);
    await run('/usr/bin/git', ['config', 'user.name', 'Daihon Style Preset Fixture'], project);
  }
  await run('/usr/bin/git', ['add', 'captions.json', 'edit.json'], project);
  const dirty = await new Promise(resolve => {
    const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: project });
    child.once('close', code => resolve(code !== 0));
  });
  if (dirty) await run('/usr/bin/git', ['commit', '-m', `字幕テンプレ ${name} fixture`], project);
  return { name, version, rows: rows.length, textStyleRows: 5, unknownPresetRows: 1, unknownKeyRows: 1 };
}

await mkdir(FIXTURE, { recursive: true });
const generated = [await prepareProject('v2', 500, 2), await prepareProject('v1', 40, 1)];
process.stdout.write(`${JSON.stringify({ ok: true, fixtures: generated })}\n`);
