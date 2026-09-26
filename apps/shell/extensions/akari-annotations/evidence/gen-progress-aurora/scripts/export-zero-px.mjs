#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureFramesWithOsr } from '../../../../../../../packages/osr-export/src/index.mjs';

const EVIDENCE = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = resolve(EVIDENCE, '../../../../../..');
const ELECTRON = join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FFMPEG = 'ffmpeg';
const ISO = await mkdtemp(join(sep, 'tmp', 'gen-progress-aurora-export-'));
const projectRoot = join(ISO, 'workspace');
const resultPath = join(EVIDENCE, 'export-pixels.json');
const env = { ...process.env, HOME: join(ISO, 'home'), AKARI_HOME: join(ISO, 'akari-home'),
  THEIA_CONFIG_DIR: join(ISO, 'theia-config') };
const raw = png => {
  const decoded = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', png,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 16 * 1024 * 1024 });
  if (decoded.status !== 0) throw new Error(`PNG decode failed: ${decoded.stderr}`);
  return decoded.stdout;
};
try {
  await Promise.all(['home', 'akari-home', 'theia-config'].map(name => mkdir(join(ISO, name))));
  const prepared = spawnSync(process.execPath, [join(EVIDENCE, 'scripts/gen-fixture.mjs')], {
    cwd: REPO, env: { ...env, GEN_PROGRESS_PROJECT: projectRoot, FFMPEG }, encoding: 'utf8' });
  if (prepared.status !== 0) throw new Error(`Fixture failed: ${prepared.stderr}`);
  const capture = async name => {
    const directory = join(ISO, name);
    const result = await captureFramesWithOsr({ projectRoot, outputDirectory: directory,
      frameNumbers: [210], fps: 30, width: 1280, height: 720, duration: 30, frames: 900,
      launcher: { tier: 2, executable: ELECTRON }, env,
      io: { log() {}, error() {} } });
    const output = result.run.outputs.find(row => row.frameNumber === 210)?.path;
    if (!output) throw new Error('Frame 210 missing');
    const evidenceName = `export-${name}-frame-210.png`;
    await copyFile(output, join(EVIDENCE, evidenceName));
    return join(EVIDENCE, evidenceName);
  };
  const before = await capture('before');
  const metaPath = join(projectRoot, 'assets/stills/b.png.meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const at = new Date().toISOString();
  meta.status = 'generating';
  meta.job = { provider: 'codex', started_at: at, stale_after_s: 600 };
  meta.history = [...(meta.history ?? []), { at, status: 'generating', reason: null }];
  await writeFile(metaPath, JSON.stringify(meta));
  const after = await capture('generating');
  const left = raw(before), right = raw(after);
  if (left.length !== right.length) throw new Error('Frame dimensions differ');
  let diffPixels = 0, maxChannelDifference = 0;
  for (let offset = 0; offset < left.length; offset += 3) {
    const r = Math.abs(left[offset] - right[offset]);
    const g = Math.abs(left[offset + 1] - right[offset + 1]);
    const b = Math.abs(left[offset + 2] - right[offset + 2]);
    const maximum = Math.max(r, g, b);
    if (maximum) diffPixels++;
    maxChannelDifference = Math.max(maxChannelDifference, maximum);
  }
  const result = { status: diffPixels === 0 ? 'PASS' : 'FAIL', frame: 210, width: 1280, height: 720,
    pixelsCompared: left.length / 3, diffPixels, maxChannelDifference,
    before: 'export-before-frame-210.png', generating: 'export-generating-frame-210.png' };
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (diffPixels !== 0) process.exitCode = 1;
} catch (error) {
  const message = String(error?.message ?? error).replaceAll(REPO, '<REPO>').replaceAll(ISO, '<TMP>');
  await writeFile(resultPath, JSON.stringify({ status: 'FAIL', error: message }, null, 2) + '\n');
  console.error(message);
  process.exitCode = 1;
} finally {
  await rm(ISO, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
