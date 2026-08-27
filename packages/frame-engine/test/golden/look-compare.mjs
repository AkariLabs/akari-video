import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import migrate from '../../../edit-store/lib/migrate/index.js';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
const resultsPath = resolve(generated, 'results.json');
const comparisonPath = resolve(generated, 'look-compare.json');
const ids = ['cinematic', 'cool-clear', 'film-warm', 'forest-soft', 'mono', 'natural',
  'night-neon', 'silver-retain', 'sunset-gold', 'vintage-fade'];
const PIXELS = 320 * 180;

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  return existsSync(homebrew) ? homebrew : execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}
const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');
if (!existsSync(resultsPath) || JSON.parse(readFileSync(resultsPath, 'utf8')).lookParity?.length !== 20) {
  execFileSync(process.execPath, [resolve(directory, 'run.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
}
execFileSync(process.execPath, [resolve(directory, 'generate-fixture.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
const fixture = JSON.parse(readFileSync(resolve(directory, 'look.edit.json'), 'utf8'));

function rawPng(file) {
  return new Uint8Array(execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: PIXELS * 8 }));
}
function extractPng(file, frameNumber, target) {
  mkdirSync(dirname(target), { recursive: true });
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-vf', `select=eq(n\\,${frameNumber})`, '-vsync', '0', '-frames:v', '1', target]);
  return rawPng(target);
}
function compare(left, right) {
  let total = 0, maxChannelDelta = 0, differingPixels = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      total += delta; maxChannelDelta = Math.max(maxChannelDelta, delta); differs ||= delta !== 0;
    }
    if (differs) differingPixels += 1;
  }
  return { MAD: total / left.length, differingPixels, maxChannelDelta };
}

const rows = [];
for (const id of ids) {
  const project = resolve(generated, `look-project-${id}`);
  const output = resolve(project, 'exports/look-render-cut.mp4');
  mkdirSync(resolve(project, 'exports'), { recursive: true });
  const legacy = {
    version: 0,
    source: { path: 'source.mp4' },
    output: { width: 320, height: 180, fps: 30, look: { lut: id, intensity: 1 },
      encoding: { quality: 'master', encoder: 'x264' } },
    cuts: fixture.cuts.map(({ src: _src, ...cut }) => cut), layers: [], overlays: [],
  };
  const migrated = migrate.migrateEditToV2(legacy);
  if (!migrated.ok) throw new Error(`${id} edit migration failed: ${migrated.blockers.join(' / ')}`);
  writeFileSync(resolve(project, 'edit.json'), `${JSON.stringify(migrated.doc, null, 2)}\n`);
  copyFileSync(resolve(generated, 'source.mp4'), resolve(project, 'source.mp4'));
  const render = spawnSync(process.execPath, [resolve(repository, 'packages/render-cut/bin/render-cut.mjs'),
    project, '--force', '--out', output, '--quality', 'master', '--encoder', 'x264'],
  { cwd: repository, encoding: 'utf8', timeout: 900_000,
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe }, maxBuffer: 32 * 1024 * 1024 });
  if (render.error || render.status !== 0) throw new Error(`${id} render-cut failed (${render.status}): ${render.error?.message ?? render.stderr}`);
  const metrics = compare(rawPng(resolve(generated, `look/${id}-t250000.png`)),
    extractPng(output, 7, resolve(generated, `look-render-cut/${id}-t250000.png`)));
  rows.push({ id, timeUs: 250_000, frameNumber: 7, ...metrics,
    interpretation: metrics.MAD <= 8
      ? 'trilinear and range handling agree within the H.264/YUV floor'
      : 'large delta: inspect limited/full range normalization before interpolation order' });
}
const intensityRows = [];
for (const intensity of [0, 0.5, 1]) {
  const project = resolve(generated, `look-intensity-${String(intensity).replace('.', '_')}`);
  const output = resolve(project, 'exports/look-render-cut.mp4');
  mkdirSync(resolve(project, 'exports'), { recursive: true });
  const legacy = {
    version: 0,
    source: { path: 'source.mp4' },
    output: { width: 320, height: 180, fps: 30,
      look: { lut: 'natural', intensity },
      encoding: { quality: 'master', encoder: 'x264' } },
    cuts: fixture.cuts.map(({ src: _src, ...cut }) => cut), layers: [], overlays: [],
  };
  const migrated = migrate.migrateEditToV2(legacy);
  if (!migrated.ok) throw new Error(`intensity ${intensity} edit migration failed: ${migrated.blockers.join(' / ')}`);
  writeFileSync(resolve(project, 'edit.json'), `${JSON.stringify(migrated.doc, null, 2)}\n`);
  copyFileSync(resolve(generated, 'source.mp4'), resolve(project, 'source.mp4'));
  const render = spawnSync(process.execPath, [resolve(repository, 'packages/render-cut/bin/render-cut.mjs'),
    project, '--force', '--out', output, '--quality', 'master', '--encoder', 'x264'],
  { cwd: repository, encoding: 'utf8', timeout: 900_000,
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe }, maxBuffer: 32 * 1024 * 1024 });
  if (render.error || render.status !== 0) throw new Error(`intensity ${intensity} render-cut failed (${render.status}): ${render.error?.message ?? render.stderr}`);
  const metrics = compare(
    rawPng(resolve(generated, `look/intensity-${String(intensity).replace('.', '_')}.png`)),
    extractPng(output, 22, resolve(generated, `look-render-cut/intensity-${String(intensity).replace('.', '_')}.png`)),
  );
  intensityRows.push({ id: 'natural', intensity, timeUs: 750_000, frameNumber: 22, ...metrics });
}
writeFileSync(comparisonPath, `${JSON.stringify({ rows, intensityRows }, null, 2)}\n`);
process.stdout.write('| LUT | MAD | differingPixels | maxChannelDelta | interpretation |\n|---|---:|---:|---:|---|\n');
for (const row of rows) process.stdout.write(`| ${row.id} | ${row.MAD.toFixed(4)} | ${row.differingPixels} | ${row.maxChannelDelta} | ${row.interpretation} |\n`);
process.stdout.write('\n| LUT | intensity | MAD | differingPixels | maxChannelDelta |\n|---|---:|---:|---:|---:|\n');
for (const row of intensityRows) process.stdout.write(`| ${row.id} | ${row.intensity} | ${row.MAD.toFixed(4)} | ${row.differingPixels} | ${row.maxChannelDelta} |\n`);
