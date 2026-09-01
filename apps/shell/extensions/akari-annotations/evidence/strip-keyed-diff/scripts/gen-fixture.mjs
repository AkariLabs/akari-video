#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const raw = process.argv.find(value => value.startsWith('--n='))?.slice(4);
const n = Number(raw);
if (![5, 50, 200, 400, 800].includes(n)) throw new Error('--n must be one of 5,50,200,800 (400 is reserved for the A fallback)');

const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, contents) => { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`; await writeFile(temporary, contents); await rename(temporary, file); };
function run(command, args, { cwd = ROOT, timeoutMs = 60_000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); resolve({ ok: false, reason: String(error), stdout, stderr }); });
    child.once('close', code => { clearTimeout(timer); resolve({ ok: code === 0, reason: code === 0 ? null : timedOut ? `timeout after ${timeoutMs}ms` : `exit ${code}: ${stderr.slice(-1000)}`, stdout, stderr }); });
  });
}

const shared = path.join(ROOT, 'fixtures', 'shared');
const media = path.join(shared, 'testsrc2-10s.mp4');
await mkdir(shared, { recursive: true });
let mediaReused = true;
if (!await exists(media)) {
  mediaReused = false;
  const made = await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', media], { timeoutMs: 120_000 });
  if (!made.ok) throw new Error(`ffmpeg fixture generation failed: ${made.reason}`);
}

const tracks = [
  ...Array.from({ length: 5 }, (_, index) => ({ id: `v${index + 1}`, lane: 'visual', items: [] })),
  { id: 'a1', lane: 'audio', items: [] },
];
let telopNumber = 0;
for (let index = 0; index < n; index++) {
  const trackIndex = index % 6;
  const slot = Math.floor(index / 6);
  const telop = trackIndex === 4;
  const telopId = telop ? `第${++telopNumber}章 検証` : null;
  const source = telop
    ? { kind: 'telop', preset: 'ref3_chapter_tag', params: { text: telopId } }
    : { kind: 'media', src: 'testsrc2', in: (slot % 5) * 2, out: (slot % 5) * 2 + 2 };
  tracks[trackIndex].items.push({
    id: telopId ?? `item-${String(index + 1).padStart(4, '0')}`,
    at: slot * 120,
    duration: 60,
    source,
  });
}
const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [{ id: 'testsrc2', path: 'assets/testsrc2-10s.mp4' }], tracks };
const fixture = path.join(ROOT, 'fixtures', `n${n}`);
const editFile = path.join(fixture, 'edit.json');
async function fixtureShapeValid() {
  try {
    const current = JSON.parse(await readFile(editFile, 'utf8'));
    const itemCount = Array.isArray(current.tracks)
      ? current.tracks.reduce((total, track) => total + (Array.isArray(track.items) ? track.items.length : 0), 0)
      : -1;
    const allItemsMinimal = current.tracks?.every(track => track.items?.every((item, itemIndex) =>
      !Object.hasOwn(item, 'name') && item.at === itemIndex * 120 && item.duration === 60));
    const telopIdsJapanese = current.tracks?.[4]?.items?.every((item, itemIndex) =>
      item.source?.kind === 'telop' && item.id === `第${itemIndex + 1}章 検証`);
    return itemCount === n && current.tracks.length === 6
      && current.sources?.[0]?.path === 'assets/testsrc2-10s.mp4'
      && allItemsMinimal === true && telopIdsJapanese === true;
  } catch {
    return false;
  }
}

const rebuilt = !await fixtureShapeValid();
if (rebuilt) await rm(fixture, { recursive: true, force: true });
await mkdir(path.join(fixture, 'assets'), { recursive: true });
const fixtureMedia = path.join(fixture, 'assets', 'testsrc2-10s.mp4');
if (!await exists(fixtureMedia)) {
  try { await link(media, fixtureMedia); }
  catch { await copyFile(media, fixtureMedia); }
}
if (rebuilt) await atomicWrite(editFile, `${JSON.stringify(edit, null, 2)}\n`);

if (!await exists(path.join(fixture, '.git'))) {
  for (const [command, args] of [['/usr/bin/git', ['init']], ['/usr/bin/git', ['config', 'user.email', 'timeline-bench@localhost']], ['/usr/bin/git', ['config', 'user.name', 'Timeline Bench']], ['/usr/bin/git', ['add', 'edit.json']], ['/usr/bin/git', ['commit', '-m', `fixture n=${n}`]]]) {
    const result = await run(command, args, { cwd: fixture, timeoutMs: 30_000 });
    if (!result.ok) throw new Error(`${command} ${args.join(' ')} failed: ${result.reason}`);
  }
}
await atomicWrite(path.join(fixture, '.git', 'info', 'exclude'), 'assets/\n');
process.stdout.write(`${JSON.stringify({ status: 'completed', n, fixture, media, fixtureMedia, mediaReused, rebuilt })}\n`);
