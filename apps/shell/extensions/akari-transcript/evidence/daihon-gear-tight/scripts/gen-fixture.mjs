#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value); await rename(temporary, file);
};
const captions = [
  { id: 'c-0001', start: 0, end: 3, text: '最初の発話です', speaker: null, sourceRef: { segment: 0 }, edited: false,
    words: [{ start: 1, end: 1.8, text: '最初の' }, { start: 1.85, end: 2, text: '発話です' }] },
  { id: 'c-0002', start: 3.2, end: 6.4, text: '二番目の字幕です', speaker: null, sourceRef: { segment: 1 }, edited: false,
    words: [{ start: 4, end: 4.8, text: '二番目の' }, { start: 4.9, end: 5.6, text: '字幕です' }] },
  { id: 'c-0003', start: 6.6, end: 8, text: '語時刻なし', speaker: null, sourceRef: { segment: 2 }, edited: false },
  { id: 'c-0004', start: 8.2, end: 10.8, text: 'アンカー確認', speaker: null, sourceRef: { segment: 3 }, edited: false,
    words: [{ start: 8.8, end: 9.5, text: 'アンカー' }, { start: 9.6, end: 10.2, text: '確認' }] }
];
await mkdir(path.join(FIXTURE, 'assets'), { recursive: true });
const media = path.join(FIXTURE, 'assets', 'base.mp4');
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'color=c=#27313f:s=320x180:r=30', '-t', '12', '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-crf', '42', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media], FIXTURE);
const edit = { version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'src-1', path: 'assets/base.mp4' }], tracks: [
    { id: 'v-main', lane: 'visual', items: [{ id: 'main-clip', at: 0, duration: 360,
      source: { kind: 'media', src: 'src-1', in: 0, out: 12 } }] },
    { id: 'v-anchor', lane: 'visual', items: [{ id: 'anchored-note', at: 246, duration: 78,
      anchor: { caption: 'c-0004' }, source: { kind: 'html', path: 'overlays/anchor.html' } }] },
    { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
  ] };
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify({ emphasis_words: [], captions }, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'overlays', 'anchor.html'), '<div>anchor</div>\n');
if (!await exists(path.join(FIXTURE, '.git'))) {
  await run('/usr/bin/git', ['init'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.email', 'daihon-gear-tight-fixture@localhost'], FIXTURE);
  await run('/usr/bin/git', ['config', 'user.name', 'Daihon Gear Tight Fixture'], FIXTURE);
}
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json', 'overlays/anchor.html'], FIXTURE);
const dirty = await new Promise(resolve => { const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE }); child.once('close', code => resolve(code !== 0)); });
if (dirty) await run('/usr/bin/git', ['commit', '-m', '台本字幕設定 L1 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({ ok: true, rows: captions.length })}\n`);
