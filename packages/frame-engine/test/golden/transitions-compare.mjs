import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import migrate from '../../../edit-store/lib/migrate/index.js';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
const project = resolve(generated, 'transitions-project');
const output = resolve(project, 'exports/transitions-render-cut.mp4');
const resultsPath = resolve(generated, 'results.json');
const comparisonPath = resolve(generated, 'transitions-compare.json');
const FPS = 30;
const PIXELS = 320 * 180;

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  return existsSync(homebrew) ? homebrew : execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}
const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');

if (!existsSync(resultsPath) || JSON.parse(readFileSync(resultsPath, 'utf8')).transitionParity?.length !== 90) {
  execFileSync(process.execPath, [resolve(directory, 'run.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
}
execFileSync(process.execPath, [resolve(directory, 'generate-fixture.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
mkdirSync(resolve(project, 'exports'), { recursive: true });
const fixture = JSON.parse(readFileSync(resolve(directory, 'transitions.edit.json'), 'utf8'));
const legacy = {
  version: 0,
  source: { path: 'source.mp4' },
  output: { width: 320, height: 180, fps: 30, encoding: { quality: 'master', encoder: 'x264' } },
  cuts: fixture.cuts.map(({ src: _src, ...cut }) => cut),
  layers: [], overlays: [],
};
const migrated = migrate.migrateEditToV2(legacy);
if (!migrated.ok) throw new Error(`transition edit migration failed: ${migrated.blockers.join(' / ')}`);
writeFileSync(resolve(project, 'edit.json'), `${JSON.stringify(migrated.doc, null, 2)}\n`);
copyFileSync(resolve(generated, 'source.mp4'), resolve(project, 'source.mp4'));
const render = spawnSync(process.execPath, [
  resolve(repository, 'packages/render-cut/bin/render-cut.mjs'), project,
  '--force', '--out', output, '--quality', 'master', '--encoder', 'x264',
], { cwd: repository, encoding: 'utf8', timeout: 900_000,
  env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe }, maxBuffer: 32 * 1024 * 1024 });
if (render.error || render.status !== 0) throw new Error(`render-cut failed (${render.status}): ${render.error?.message ?? render.stderr}`);

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

// Keep this frame-grid formula identical to transitionOutputTimeSeconds() in renderer.ts so
// the render-cut reference and engine golden address one output frame.
function transitionOutputTimeSeconds(transitionIndex, u) {
  return 0.6 * (transitionIndex + 1) + 0.4 * u;
}

const rows = [];
const ids = ['hard-cut', ...TRANSITION_VOCABULARY.map(entry => entry.id)];
for (const [index, id] of ids.entries()) {
  for (const u of [0.25, 0.5, 0.75]) {
    const suffix = Math.round(u * 100);
    const engine = rawPng(resolve(generated, `transitions/${id}-u${suffix}.png`));
    let reference;
    let frameNumber;
    if (id === 'hard-cut') {
      const sourceTime = 0.6 + u * 0.4;
      frameNumber = Math.floor(sourceTime * FPS + 1e-6);
      reference = extractPng(resolve(generated, 'source.mp4'), frameNumber,
        resolve(generated, `transitions-xfade/${id}-u${suffix}.png`));
    } else {
      const transitionIndex = index - 1;
      const outputTime = transitionOutputTimeSeconds(transitionIndex, u);
      frameNumber = Math.floor(outputTime * FPS + 1e-6);
      reference = extractPng(output, frameNumber,
        resolve(generated, `transitions-xfade/${id}-u${suffix}.png`));
    }
    rows.push({ id, u, frameNumber, ...compare(engine, reference) });
  }
}
writeFileSync(comparisonPath, `${JSON.stringify({ rows }, null, 2)}\n`);
process.stdout.write('| id | u | frame | MAD | differingPixels | maxChannelDelta |\n|---|---:|---:|---:|---:|---:|\n');
for (const row of rows) process.stdout.write(`| ${row.id} | ${row.u} | ${row.frameNumber} | ${row.MAD.toFixed(4)} | ${row.differingPixels} | ${row.maxChannelDelta} |\n`);
