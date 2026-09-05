import { resolveTool } from '../helpers/resolve-tool.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import migrate from '../../../edit-store/lib/migrate/index.js';
import { resolveLutPath } from '../../../render-cut/src/render-inputs.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
const filteredProject = resolve(generated, 'filter-project');
const bareProject = resolve(generated, 'filter-bare-project');
const filteredOutput = resolve(filteredProject, 'exports/filter-legacy.mp4');
const bareOutput = resolve(bareProject, 'exports/filter-bare-legacy.mp4');
const resultPath = resolve(generated, 'results.json');
const comparisonPath = resolve(generated, 'filter-compare.json');
const WIDTH = 320;
const HEIGHT = 180;

const ffmpeg = resolveTool('ffmpeg');
const ffprobe = resolveTool('ffprobe');
const fixture = JSON.parse(readFileSync(resolve(directory, 'filter.edit.json'), 'utf8'));
const legacy = {
  ...fixture,
  source: { path: 'source.mp4' },
  output: { ...fixture.output, encoding: { quality: 'master', encoder: 'x264' } },
  cuts: fixture.cuts.map(({ src: _src, ...cut }) => cut),
};

function renderLegacy(edit, project, output, label) {
  const migrated = migrate.migrateEditToV2(edit);
  if (!migrated.ok) throw new Error(`${label} edit migration failed: ${migrated.blockers.join(' / ')}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(resolve(project, 'edit.json'), `${JSON.stringify(migrated.doc, null, 2)}\n`);
  copyFileSync(resolve(generated, 'source.mp4'), resolve(project, 'source.mp4'));
  const render = spawnSync(process.execPath, [
    resolve(repository, 'packages/render-cut/bin/render-cut.mjs'), project,
    '--engine', 'legacy', '--force', '--out', output, '--quality', 'master', '--encoder', 'x264',
  ], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (render.error || render.status !== 0) {
    throw new Error(`${label} legacy render failed (${render.status}): ${render.error?.message ?? render.stderr}`);
  }
}

renderLegacy(legacy, filteredProject, filteredOutput, 'filter');
// The codec floor is shared by all three samples, so render this layers-empty edit only once.
renderLegacy({ ...legacy, layers: [] }, bareProject, bareOutput, 'bare filter');

function decodeRgba(inputArgs) {
  return new Uint8Array(execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', ...inputArgs,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { maxBuffer: WIDTH * HEIGHT * 8 }));
}
function rawPng(file) {
  return decodeRgba(['-i', file]);
}
function legacyFrame(file, frameNumber) {
  return decodeRgba([
    '-i', file, '-vf', `select=eq(n\\,${frameNumber})`, '-vsync', '0',
  ]);
}
function escapeFilterPath(path) {
  return path
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll(':', '\\:')
    .replaceAll(',', '\\,')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}
function mathReference(id, barePath) {
  if (id === 'invert') {
    return decodeRgba(['-i', barePath, '-vf', 'format=gbrp,negate']);
  }
  if (id === 'saturation') {
    return decodeRgba([
      '-i', barePath,
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv444p,eq=saturation=1.6,scale=in_color_matrix=bt709:in_range=tv,format=gbrp',
    ]);
  }
  if (id === 'lut') {
    const lutPath = escapeFilterPath(resolveLutPath(repository, 'mono'));
    return decodeRgba([
      '-i', barePath,
      '-filter_complex', `split=2[a][b];[a]format=gbrp,lut3d=file='${lutPath}':interp=trilinear[g];[b]format=gbrp[o];[g][o]blend=all_mode=normal:all_opacity=0.5`,
    ]);
  }
  throw new Error(`unknown filter golden id: ${id}`);
}
function signedDistance(corners, x, y) {
  const circular = [corners[0], corners[1], corners[3], corners[2]].map(([cx, cy]) => [cx * WIDTH, cy * HEIGHT]);
  return Math.min(...circular.map((a, index) => {
    const b = circular[(index + 1) % 4];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    return (dx * (y - a[1]) - dy * (x - a[0])) / Math.max(Math.hypot(dx, dy), 1e-9);
  }));
}
function compareInside(left, right, corners) {
  let total = 0;
  let channels = 0;
  let insidePixels = 0;
  let maxDelta = 0;
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    if (signedDistance(corners, x + 0.5, y + 0.5) <= 2) continue;
    insidePixels += 1;
    const offset = (y * WIDTH + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      total += delta;
      channels += 1;
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  return { insidePixels, MAD: channels > 0 ? total / channels : Infinity, maxDelta };
}

const golden = JSON.parse(readFileSync(resultPath, 'utf8'));
const frameNumbers = new Map([['invert', 37], ['saturation', 112], ['lut', 187]]);
const rows = golden.filterParity.map(row => {
  const frameNumber = frameNumbers.get(row.id);
  if (frameNumber === undefined) throw new Error(`missing frame number for ${row.id}`);
  const enginePath = resolve(generated, `filter/${row.id}.png`);
  const barePath = resolve(generated, `filter/${row.id}-bare.png`);
  const engine = rawPng(enginePath);
  const engineBare = rawPng(barePath);
  const math = compareInside(engine, mathReference(row.id, barePath), row.corners);
  const legacyMetrics = compareInside(engine, legacyFrame(filteredOutput, frameNumber), row.corners);
  const floor = compareInside(engineBare, legacyFrame(bareOutput, frameNumber), row.corners);
  assert.equal(legacyMetrics.insidePixels, math.insidePixels);
  assert.equal(floor.insidePixels, math.insidePixels);
  const legacyDelta = legacyMetrics.MAD - floor.MAD;
  const pass = math.MAD <= 1
    && legacyMetrics.MAD <= 8
    && legacyDelta <= 2
    && row.outsideDifferingPixels === 0
    && row.firstSha256 === row.secondSha256;
  return {
    id: row.id,
    frameNumber,
    insidePixels: math.insidePixels,
    mathMAD: math.MAD,
    mathMaxDelta: math.maxDelta,
    legacyMAD: legacyMetrics.MAD,
    floorMAD: floor.MAD,
    legacyDelta,
    outsideDifferingPixels: row.outsideDifferingPixels,
    firstSha256: row.firstSha256,
    secondSha256: row.secondSha256,
    pass,
  };
});
writeFileSync(comparisonPath, `${JSON.stringify({ rows }, null, 2)}\n`);
for (const row of rows) {
  process.stdout.write(
    `filter ${row.id}: math MAD=${row.mathMAD.toFixed(4)} max=${row.mathMaxDelta}, `
      + `legacy MAD=${row.legacyMAD.toFixed(4)}, floor MAD=${row.floorMAD.toFixed(4)}, `
      + `legacy-floor=${row.legacyDelta.toFixed(4)}, outside diff=${row.outsideDifferingPixels}, `
      + `deterministic=${row.firstSha256 === row.secondSha256}, pass=${row.pass}\n`,
  );
}
assert.equal(rows.length, 3);
assert.equal(rows.every(row => row.pass), true);
