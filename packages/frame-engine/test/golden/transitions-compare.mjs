import { resolveTool } from '../helpers/resolve-tool.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { dissolveNoiseField } from '../../dist/index.js';
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
const WIDTH = 320;
const HEIGHT = 180;
const PIXELS = WIDTH * HEIGHT;

const ffmpeg = resolveTool('ffmpeg');
const ffprobe = resolveTool('ffprobe');

if (!existsSync(resultsPath) || JSON.parse(readFileSync(resultsPath, 'utf8')).transitionParity?.length !== 90) {
  execFileSync(process.execPath, [resolve(directory, 'run.mjs')], { cwd: packageDirectory, stdio: 'inherit' });
}
const golden = JSON.parse(readFileSync(resultsPath, 'utf8'));
const dissolveParityRows = golden.transitionParity.filter((row) => row.id === 'dissolve');
if (dissolveParityRows.length !== 3 || dissolveParityRows.some((row) =>
  !Array.isArray(row.sourceFrames) || row.sourceFrames.length !== 2)) {
  throw new Error('three dissolve parity rows with outgoing/incoming sourceFrames are required');
}
const dissolveParityByProgress = new Map(
  dissolveParityRows.map((row) => [row.u, row]),
);
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

function extractRawFrame(file, frameNumber) {
  const rgba = new Uint8Array(execFileSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `select=eq(n\\,${frameNumber})`, '-vsync', '0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ],
    { maxBuffer: PIXELS * 8 },
  ));
  if (rgba.length !== PIXELS * 4)
    throw new Error(`frame ${frameNumber} returned ${rgba.length} RGBA bytes`);
  return rgba;
}

function idealDissolve(outgoing, incoming, progress, field) {
  const ideal = new Uint8Array(PIXELS * 4);
  for (let pixel = 0; pixel < PIXELS; pixel += 1) {
    const source = field[pixel] < progress ? incoming : outgoing;
    const offset = pixel * 4;
    ideal.set(source.subarray(offset, offset + 4), offset);
  }
  return ideal;
}

function roundTripYuv420(rgba) {
  const rawInput = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pixel_format', 'rgba',
    '-video_size', `${WIDTH}x${HEIGHT}`, '-i', 'pipe:0', '-frames:v', '1',
  ];
  const yuv420 = execFileSync(
    ffmpeg,
    [...rawInput, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'],
    { input: rgba, maxBuffer: PIXELS * 4 },
  );
  const roundTripped = new Uint8Array(execFileSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pixel_format', 'yuv420p',
      '-video_size', `${WIDTH}x${HEIGHT}`, '-i', 'pipe:0', '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ],
    { input: yuv420, maxBuffer: PIXELS * 8 },
  ));
  if (roundTripped.length !== rgba.length)
    throw new Error(`yuv420p round trip returned ${roundTripped.length} RGBA bytes`);
  return roundTripped;
}

const STANDARD_PARITY_IDS = [
  'fade', 'fade-grays',
  'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'radial',
  'slide-left', 'slide-right', 'slide-up', 'slide-down',
  'cover-left', 'cover-right', 'cover-up', 'cover-down',
  'reveal-left', 'reveal-right', 'reveal-down', 'reveal-up',
  'circle-open', 'circle-close', 'squeeze-h', 'squeeze-v',
];
const APPROXIMATION_IDS = ['zoom-in', 'blur', 'pixelize'];
const TRANSITION_LIMITS = Object.fromEntries([
  ...STANDARD_PARITY_IDS.map((id) => [id, {
    floorMultiplier: 2,
    allowance: 3,
    reason: 'same xfade geometry/formula with bounded color conversion and frame-encoding noise',
  }]),
  ...APPROXIMATION_IDS.map((id) => [id, {
    floorMultiplier: 2,
    allowance: 5,
    reason: 'documented bounded sampling or integer-coordinate approximation plus encoding noise',
  }]),
  ['fade-black', {
    floorMultiplier: 2,
    allowance: 2,
    reason: 'phase-0.2 black-plate fade must remain at the encoding noise floor',
  }],
  ['fade-white', {
    floorMultiplier: 2,
    allowance: 2,
    reason: 'phase-0.2 white-plate fade must remain at the encoding noise floor',
  }],
]);

function compareDissolveNoiseField() {
  const progress = 0.5;
  const frameNumber = Math.round(progress * FPS);
  const actual = new Uint8Array(execFileSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30:d=2',
      '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=2',
      '-filter_complex',
      `[0:v]format=yuv444p[a];[1:v]format=yuv444p[b];[a][b]xfade=transition=dissolve:duration=1:offset=0,select=eq(n\\,${frameNumber}),format=gray`,
      '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray',
      'pipe:1',
    ],
    { maxBuffer: PIXELS * 2 },
  ));
  if (actual.length !== PIXELS)
    throw new Error(`dissolve field probe returned ${actual.length} bytes`);
  const predicted = dissolveNoiseField(320, 180);
  let matches = 0;
  for (let index = 0; index < PIXELS; index += 1) {
    const actualB = actual[index] > 127;
    const predictedB = predicted[index] < progress;
    matches += Number(actualB === predictedB);
  }
  const matchRate = matches / PIXELS;
  return { progress, frameNumber, matches, pixels: PIXELS, matchRate, pass: matchRate >= 0.995 };
}

// Keep this frame-grid formula identical to transitionOutputTimeSeconds() in renderer.ts so
// the render-cut reference and engine golden address one output frame.
function transitionOutputTimeSeconds(transitionIndex, u) {
  return 0.6 * (transitionIndex + 1) + 0.4 * u;
}

const rows = [];
const ids = ['hard-cut', ...TRANSITION_VOCABULARY.map(entry => entry.id)];
const sourcePath = resolve(generated, 'source.mp4');
const dissolveField = dissolveNoiseField(WIDTH, HEIGHT);
for (const [index, id] of ids.entries()) {
  for (const u of [0.25, 0.5, 0.75]) {
    const suffix = Math.round(u * 100);
    const engine = rawPng(resolve(generated, `transitions/${id}-u${suffix}.png`));
    let reference;
    let frameNumber;
    if (id === 'hard-cut') {
      const sourceTime = 0.6 + u * 0.4;
      frameNumber = Math.floor(sourceTime * FPS + 1e-6);
      reference = extractPng(sourcePath, frameNumber,
        resolve(generated, `transitions-xfade/${id}-u${suffix}.png`));
    } else {
      const transitionIndex = index - 1;
      const outputTime = transitionOutputTimeSeconds(transitionIndex, u);
      frameNumber = Math.floor(outputTime * FPS + 1e-6);
      reference = extractPng(output, frameNumber,
        resolve(generated, `transitions-xfade/${id}-u${suffix}.png`));
    }
    let dissolveEvidence = null;
    if (id === 'dissolve') {
      const parityRow = dissolveParityByProgress.get(u);
      if (!parityRow)
        throw new Error(`missing dissolve parity sourceFrames for progress ${u}`);
      const [outgoingFrame, incomingFrame] = parityRow.sourceFrames;
      const outgoing = extractRawFrame(sourcePath, outgoingFrame);
      const incoming = extractRawFrame(sourcePath, incomingFrame);
      const ideal = idealDissolve(outgoing, incoming, u, dissolveField);
      dissolveEvidence = {
        sourceFrames: [outgoingFrame, incomingFrame],
        engineVsIdeal: compare(engine, ideal),
        mp4VsIdeal: compare(reference, ideal),
        idealYuv420RoundTrip: compare(roundTripYuv420(ideal), ideal),
      };
    }
    rows.push({
      id,
      u,
      frameNumber,
      ...compare(engine, reference),
      dissolveEvidence,
    });
  }
}
const floorRows = rows.filter((row) => row.id === 'hard-cut');
if (floorRows.length !== 3)
  throw new Error(`hard-cut noise floor requires 3 rows; received ${floorRows.length}`);
const noiseFloorMad = Math.max(...floorRows.map((row) => row.MAD));
const classifiedRows = rows.map((row) => {
  if (row.id === 'hard-cut') {
    return {
      ...row,
      madLimit: noiseFloorMad,
      classification: 'noise floor',
      reason: 'maximum MAD of the three hard-cut reference samples',
    };
  }
  if (row.id === 'dissolve') {
    const evidence = row.dissolveEvidence;
    if (!evidence) {
      return {
        ...row,
        madLimit: null,
        implementationMadLimit: 4,
        classification: 'engine-side error (investigate)',
        reason: 'non-encoded dissolve reference evidence is missing',
      };
    }
    const madLimit = evidence.mp4VsIdeal.MAD + noiseFloorMad;
    const withinLimits = evidence.engineVsIdeal.MAD <= 4 && row.MAD <= madLimit;
    return {
      ...row,
      madLimit,
      implementationMadLimit: 4,
      classification: withinLimits
        ? 'known measurement-instrument difference'
        : 'engine-side error (investigate)',
      reason: 'xfade selects A/B per pixel in yuv444p, then yuv420p output averages each 2x2 chroma block; random dissolve chroma is necessarily lost by that measurement path',
    };
  }
  const limit = TRANSITION_LIMITS[row.id];
  if (!limit) {
    return {
      ...row,
      madLimit: null,
      classification: 'engine-side error (investigate)',
      reason: 'no reviewed transition limit exists',
    };
  }
  const envelope = noiseFloorMad * limit.floorMultiplier + limit.allowance;
  const madLimit = limit.absoluteCap === undefined
    ? envelope
    : Math.min(envelope, limit.absoluteCap);
  return {
    ...row,
    madLimit,
    classification: row.MAD <= madLimit
      ? 'within reviewed envelope'
      : 'engine-side error (investigate)',
    reason: limit.reason,
  };
});
const dissolveNoise = compareDissolveNoiseField();
const engineErrors = classifiedRows.filter((row) =>
  row.classification === 'engine-side error (investigate)');
writeFileSync(
  comparisonPath,
  `${JSON.stringify({ noiseFloorMad, dissolveNoise, rows: classifiedRows }, null, 2)}\n`,
);
const table = classifiedRows.map((row) =>
  `| ${row.id} | ${row.u} | ${row.frameNumber} | ${row.MAD.toFixed(4)} | ${row.madLimit === null ? '—' : row.madLimit.toFixed(4)} | ${row.differingPixels} | ${row.maxChannelDelta} | ${row.classification} | ${row.reason} |`,
).join('\n');
const dissolveEvidenceRows = classifiedRows.filter((row) => row.id === 'dissolve');
const dissolveEvidenceTable = dissolveEvidenceRows.map((row) => {
  const evidence = row.dissolveEvidence;
  if (!evidence)
    return `| ${row.u} | — | — | — | — | missing evidence |`;
  return `| ${row.u} | ${evidence.sourceFrames.join(' / ')} | ${evidence.engineVsIdeal.MAD.toFixed(4)} / ${evidence.engineVsIdeal.maxChannelDelta} | ${evidence.mp4VsIdeal.MAD.toFixed(4)} / ${evidence.mp4VsIdeal.maxChannelDelta} | ${evidence.idealYuv420RoundTrip.MAD.toFixed(4)} / ${evidence.idealYuv420RoundTrip.maxChannelDelta} | ${evidence.engineVsIdeal.MAD <= 4 ? 'pass' : 'engine-side error (investigate)'} |`;
}).join('\n');
process.stdout.write('| id | u | frame | MAD | MAD limit | differingPixels | maxChannelDelta | classification | reason |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n');
process.stdout.write(`${table}\n`);
process.stdout.write('| dissolve u | source frames outgoing / incoming | engine vs ideal MAD / max | mp4 vs ideal MAD / max | ideal 4:2:0 round trip MAD / max | implementation check |\n|---:|---|---:|---:|---:|---|\n');
process.stdout.write(`${dissolveEvidenceTable}\n`);
process.stdout.write(
  `dissolve noise match: ${(dissolveNoise.matchRate * 100).toFixed(3)}% (${dissolveNoise.matches}/${dissolveNoise.pixels})\n`,
);

const reportPath = resolve(packageDirectory, 'docs/transitions-report.md');
const generatedStart = '<!-- BEGIN GENERATED XFADE COMPARISON -->';
const generatedEnd = '<!-- END GENERATED XFADE COMPARISON -->';
const generatedReport = `${generatedStart}\n## Generated xfade comparison\n\n- noise floor: maximum hard-cut MAD = ${noiseFloorMad.toFixed(4)}\n- dissolve selection-field match: ${(dissolveNoise.matchRate * 100).toFixed(3)}% (${dissolveNoise.matches}/${dissolveNoise.pixels}); required ≥ 99.5%\n- dissolve engine-vs-non-encoded-ideal MAD cap: 4\n- fade-black / fade-white cap: noise floor × 2 + 2\n- engine-side error rows: ${engineErrors.length}\n\n### Dissolve measurement evidence\n\nThe implementation check compares the engine PNG with a non-encoded ideal assembled from the exact outgoing/incoming source frames and the CPU threshold field. The mp4 and yuv420p columns quantify the 4:2:0 measurement cost separately.\n\n| u | source frames outgoing / incoming | engine vs ideal MAD / max | mp4 vs ideal MAD / max | ideal 4:2:0 round trip MAD / max | implementation check |\n|---:|---|---:|---:|---:|---|\n${dissolveEvidenceTable}\n\n### Direct render-cut comparison\n\n| id | u | frame | MAD | MAD limit | differingPixels | maxChannelDelta | classification | reason |\n|---|---:|---:|---:|---:|---:|---:|---|---|\n${table}\n${generatedEnd}`;
const existingReport = readFileSync(reportPath, 'utf8');
const withoutGenerated = existingReport
  .replace(new RegExp(`${generatedStart}[\\s\\S]*?${generatedEnd}`, 'u'), '')
  .trimEnd();
writeFileSync(reportPath, `${withoutGenerated}\n\n${generatedReport}\n`);

if (engineErrors.length > 0 || !dissolveNoise.pass) {
  throw new Error(
    `${engineErrors.length} transition rows exceed reviewed limits; dissolve noise match ${(dissolveNoise.matchRate * 100).toFixed(3)}%`,
  );
}
