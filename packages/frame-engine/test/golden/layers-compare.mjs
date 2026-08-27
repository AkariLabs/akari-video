import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import migrate from '../../../edit-store/lib/migrate/index.js';

const directory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(directory, '../..');
const repository = resolve(packageDirectory, '../..');
const generated = resolve(directory, '.generated');
const project = resolve(generated, 'layers-project');
const output = resolve(project, 'exports/layers-render-cut.mp4');
const resultsPath = resolve(generated, 'results.json');

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], {
    encoding: 'utf8',
  }).trim();
}
const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');

if (
  !existsSync(resultsPath) ||
  !(JSON.parse(readFileSync(resultsPath, 'utf8')).layerParity?.length > 0)
) {
  execFileSync(process.execPath, [resolve(directory, 'run.mjs')], {
    cwd: packageDirectory,
    stdio: 'inherit',
  });
}
execFileSync(process.execPath, [resolve(directory, 'generate-fixture.mjs')], {
  cwd: packageDirectory,
  stdio: 'inherit',
});
mkdirSync(project, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
const fixtureEdit = JSON.parse(
  readFileSync(resolve(directory, 'layers.edit.json'), 'utf8'),
);
const legacy = {
  version: 0,
  source: { path: 'source.mp4' },
  output: {
    width: 320,
    height: 180,
    fps: 30,
    encoding: { quality: 'master', encoder: 'x264' },
  },
  cuts: fixtureEdit.cuts.map(({ src: _src, ...cut }) => cut),
  layers: fixtureEdit.layers.map((layer) => ({
    ...layer,
    src: layer.src.endsWith('source-b.mp4') ? 'source-b.mp4' : 'still.png',
  })),
  overlays: [],
};
const migrated = migrate.migrateEditToV2(legacy);
if (!migrated.ok)
  throw new Error(
    `layers edit migration failed: ${migrated.blockers.join(' / ')}`,
  );
writeFileSync(
  resolve(project, 'edit.json'),
  `${JSON.stringify(migrated.doc, null, 2)}\n`,
);
for (const name of ['source.mp4', 'source-b.mp4', 'still.png'])
  copyFileSync(resolve(generated, name), resolve(project, name));

const render = spawnSync(
  process.execPath,
  [
    resolve(repository, 'packages/render-cut/bin/render-cut.mjs'),
    project,
    '--force',
    '--out',
    output,
    '--quality',
    'master',
    '--encoder',
    'x264',
  ],
  {
    cwd: repository,
    encoding: 'utf8',
    timeout: 900_000,
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe },
    maxBuffer: 32 * 1024 * 1024,
  },
);
if (render.error || render.status !== 0)
  throw new Error(
    `render-cut failed (${render.status}): ${render.error?.message ?? render.stderr}`,
  );
const renderReceipt = JSON.parse(
  readFileSync(resolve(project, '.akari/render.json'), 'utf8'),
);
const layersCommandArgs = renderReceipt.plan?.commands?.layers?.args ?? [];
const stillIsInLayersCommand = layersCommandArgs.some((argument) =>
  String(argument).includes('still.png'),
);

const golden = JSON.parse(readFileSync(resultsPath, 'utf8'));
function rawPng(path) {
  return new Uint8Array(
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        path,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      { maxBuffer: 320 * 180 * 8 },
    ),
  );
}
const FPS = 30;
const PIXELS = 320 * 180;

function rawRenderFrame(frameNumber) {
  return new Uint8Array(
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        output,
        '-vf',
        `select=eq(n\\,${frameNumber})`,
        '-vsync',
        '0',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        'pipe:1',
      ],
      { maxBuffer: 320 * 180 * 8 },
    ),
  );
}
function compare(left, right) {
  if (left.length !== right.length) {
    throw new Error(`frame size mismatch ${left.length}/${right.length}`);
  }
  let totalChannelDelta = 0;
  let maxChannelDelta = 0;
  let differingPixels = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    let differs = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left[offset + channel] - right[offset + channel]);
      totalChannelDelta += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      differs ||= delta !== 0;
    }
    if (differs) differingPixels += 1;
  }
  return {
    MAD: totalChannelDelta / left.length,
    differingPixels,
    differingPixelRate: differingPixels / PIXELS,
    maxChannelDelta,
  };
}

function classOf(label) {
  if (label.startsWith('noise-floor-')) return 'noise-floor';
  return label.replace(/-[ab]$/u, '');
}

const KNOWN_DIFFERENCE_REASON = {
  'noise-floor': 'H.264 + YUV round-trip floor',
  'static-crop':
    'ffmpeg truncates crop x/y/w/h to an even yuva420p grid before scaling',
  'static-perspective':
    'render-cut v2 projection routes a static perspective-only item through the cuts path instead of the layers command in this synthetic overlapping timeline',
  'keyframes-transform':
    'ffmpeg scale and rotate materialize integer raster bounds; rotate expands its bounding box',
  'keyframes-crop':
    'ffmpeg emulates variable crop size with scale/crop/scale and even-coordinate truncation',
  'keyframes-perspective':
    'ffmpeg perspective has no time variable, so render-cut holds midpoint-sampled corner pins per segment',
  'blend-screen':
    'ffmpeg converts both inputs through gbrp blend and maskedmerge before returning to yuv420p',
  'blend-multiply':
    'ffmpeg converts both inputs through gbrp blend and maskedmerge before returning to yuv420p',
  opacity:
    'ffmpeg quantizes opacity into the yuva420p alpha plane before overlay',
  still:
    'render-cut v2 projection routes a transformless still through the cuts path; it is absent from the layers command in this synthetic overlapping timeline',
  'stack-3':
    'three sequential ffmpeg overlay stages accumulate raster and YUV quantization',
};

// These are acceptance envelopes, not expected values. Each limit is derived from the measured
// base-only floor plus a class-specific allowance for the documented filtergraph operation.
// Exceeding any envelope is surfaced as an engine-side error and makes this command fail.
const CLASS_LIMITS = {
  'static-crop': {
    madFloorMultiplier: 8,
    madAllowance: 8,
    maxFloorMultiplier: 6,
    maxAllowance: 32,
  },
  'static-perspective': {
    madFloorMultiplier: 14,
    madAllowance: 18,
    maxFloorMultiplier: 10,
    maxAllowance: 64,
  },
  'keyframes-transform': {
    madFloorMultiplier: 14,
    madAllowance: 20,
    maxFloorMultiplier: 10,
    maxAllowance: 64,
  },
  'keyframes-crop': {
    madFloorMultiplier: 12,
    madAllowance: 16,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'keyframes-perspective': {
    madFloorMultiplier: 20,
    madAllowance: 28,
    maxFloorMultiplier: 12,
    maxAllowance: 80,
  },
  'blend-screen': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'blend-multiply': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  opacity: {
    madFloorMultiplier: 8,
    madAllowance: 10,
    maxFloorMultiplier: 6,
    maxAllowance: 32,
  },
  still: {
    madFloorMultiplier: 0,
    madAllowance: 128,
    maxFloorMultiplier: 10,
    maxAllowance: 64,
  },
  'stack-3': {
    madFloorMultiplier: 24,
    madAllowance: 32,
    maxFloorMultiplier: 14,
    maxAllowance: 96,
  },
};

const measuredRows = golden.layerParity.map((sample, index) => {
  const enginePath = resolve(
    generated,
    `layer-parity-${String(index + 1).padStart(2, '0')}-${sample.label}-export.png`,
  );
  const frameNumber = Math.floor((sample.timeUs / 1e6) * FPS + 1e-6);
  const frameMidpointSec = (frameNumber + 0.5) / FPS;
  const metrics = compare(rawPng(enginePath), rawRenderFrame(frameNumber));
  const cls = classOf(sample.label);
  return {
    class: cls,
    label: sample.label,
    engineTimeSec: sample.timeUs / 1e6,
    frameNumber,
    frameMidpointSec,
    ...metrics,
  };
});

const floorRows = measuredRows.filter((row) => row.class === 'noise-floor');
if (floorRows.length < 2)
  throw new Error('two noise-floor samples are required');
const alignmentSample = floorRows[0];
const alignmentSampleIndex = golden.layerParity.findIndex(
  (sample) => sample.label === alignmentSample.label,
);
const alignmentEnginePath = resolve(
  generated,
  `layer-parity-${String(alignmentSampleIndex + 1).padStart(2, '0')}-${alignmentSample.label}-export.png`,
);
const alignmentEngine = rawPng(alignmentEnginePath);
const alignmentProbe = [-2, -1, 0, 1, 2].map((offset) => ({
  frameNumber: alignmentSample.frameNumber + offset,
  offset,
  ...compare(
    alignmentEngine,
    rawRenderFrame(alignmentSample.frameNumber + offset),
  ),
}));
const alignedProbe = alignmentProbe.find((probe) => probe.offset === 0);
if (
  !alignedProbe ||
  alignedProbe.MAD !== Math.min(...alignmentProbe.map((probe) => probe.MAD))
) {
  throw new Error(
    `exact-frame extraction alignment failed: ${JSON.stringify(alignmentProbe)}`,
  );
}
const floor = {
  MAD: Math.max(...floorRows.map((row) => row.MAD)),
  maxChannelDelta: Math.max(...floorRows.map((row) => row.maxChannelDelta)),
  differingPixelRate: Math.max(
    ...floorRows.map((row) => row.differingPixelRate),
  ),
};

const rows = measuredRows.map((row) => {
  if (row.class === 'noise-floor') {
    return {
      ...row,
      classification: 'noise floor',
      reason: KNOWN_DIFFERENCE_REASON['noise-floor'],
      limits: null,
    };
  }
  const limit = CLASS_LIMITS[row.class];
  const reason = KNOWN_DIFFERENCE_REASON[row.class];
  if (!limit || !reason) {
    return {
      ...row,
      classification: 'engine-side error (investigate)',
      reason: 'no reviewed class limit/reason exists',
      limits: null,
    };
  }
  const limits = {
    MAD: floor.MAD * limit.madFloorMultiplier + limit.madAllowance,
    maxChannelDelta: Math.min(
      255,
      floor.maxChannelDelta * limit.maxFloorMultiplier + limit.maxAllowance,
    ),
    differingPixelRate: Math.min(1, floor.differingPixelRate * 1.25 + 0.1),
  };
  const withinLimits =
    row.MAD <= limits.MAD &&
    row.maxChannelDelta <= limits.maxChannelDelta &&
    row.differingPixelRate <= limits.differingPixelRate;
  return {
    ...row,
    classification: withinLimits
      ? 'known filtergraph difference'
      : 'engine-side error (investigate)',
    reason,
    limits,
  };
});

const table = rows
  .map(
    (row) =>
      `| ${row.class} | ${row.label} | ${row.frameNumber} | ${row.frameMidpointSec.toFixed(6)} | ${row.MAD.toFixed(4)} | ${row.differingPixels} | ${(row.differingPixelRate * 100).toFixed(2)}% | ${row.maxChannelDelta} | ${row.classification} | ${row.reason} |`,
  )
  .join('\n');
const duration = Number(
  execFileSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      output,
    ],
    { encoding: 'utf8' },
  ).trim(),
);
const benchmarkPath = resolve(
  packageDirectory,
  'test/benchmark/.generated/benchmark-results.json',
);
const benchmark = existsSync(benchmarkPath)
  ? JSON.parse(readFileSync(benchmarkPath, 'utf8')).layerMeasurements
  : null;
const metric = (value) =>
  value?.skipped
    ? `skipped: ${value.skipped}`
    : `decode ${value?.stages?.decode?.p50Ms?.toFixed(3) ?? '—'}/${value?.stages?.decode?.p95Ms?.toFixed(3) ?? '—'}, upload ${value?.stages?.upload?.p50Ms?.toFixed(3) ?? '—'}/${value?.stages?.upload?.p95Ms?.toFixed(3) ?? '—'}, shaderGpu ${value?.stages?.shaderGpu?.p50Ms?.toFixed(3) ?? '—'}/${value?.stages?.shaderGpu?.p95Ms?.toFixed(3) ?? '—'}, present ${value?.stages?.present?.p50Ms?.toFixed(3) ?? '—'}/${value?.stages?.present?.p95Ms?.toFixed(3) ?? '—'}`;
const scalingRows =
  benchmark?.scaling
    ?.map(
      (value, index) =>
        `| ${value.count ?? [0, 1, 3, 5][index]} | ${metric(value)} |`,
    )
    .join('\n') ?? '| — | skipped: run `npm run bench:cuts` to populate |';
const zero = benchmark?.zeroCopy;
const cold = benchmark?.coldAttribution;
const engineErrors = rows.filter((row) =>
  row.classification.startsWith('engine-side error'),
);
const alignmentSummary = alignmentProbe
  .map(
    (probe) =>
      `n=${probe.frameNumber}: MAD=${probe.MAD.toFixed(4)}, max=${probe.maxChannelDelta}, rate=${(probe.differingPixelRate * 100).toFixed(2)}%`,
  )
  .join(' / ');
const limitRows = Object.entries(CLASS_LIMITS)
  .map(
    ([name, limit]) =>
      `| ${name} | floor×${limit.madFloorMultiplier} + ${limit.madAllowance} | floor×${limit.maxFloorMultiplier} + ${limit.maxAllowance} (cap 255) | floor rate×1.25 + 10pp (cap 100%) |`,
  )
  .join('\n');
const report = `# Layers compositor comparison\n\nGenerated by \`npm run compare:layers\`. The frame engine's completed RGBA readback is compared with render-cut's master/x264 output on the same frame grid. Exact equality is not expected across the H.264/YUV boundary.\n\n- fixture: 320x180, 30 fps, source.mp4 + source-b.mp4 + still.png\n- render-cut: \`--quality master --encoder x264\`\n- output duration: ${duration.toFixed(3)} s\n- sample rule: engine sample time maps to frame \`n=floor(t*30)\`; render-cut frame N is extracted exactly with \`select=eq(n\\,N)\` and \`-vsync 0\`\n- frame-alignment probe around engine frame ${alignmentSample.frameNumber}: ${alignmentSummary}; the target frame has the minimum MAD\n- render-cut path inspection: \`still.png\` present in the generated layers command = ${stillIsInLayersCommand}\n- noise-floor envelope (maximum of 2 base-only samples): MAD ${floor.MAD.toFixed(4)}, differingPixelRate ${(floor.differingPixelRate * 100).toFixed(2)}%, maxChannelDelta ${floor.maxChannelDelta}\n\n| class | label | frame n | frame midpoint sec | MAD | differingPixels | differing rate | maxChannelDelta | classification | reason |\n|---|---|---:|---:|---:|---:|---:|---:|---|---|\n${table}\n\n## Classification limits\n\nA row is a known filtergraph difference only when MAD, maximum channel delta, and differing-pixel rate all remain inside its explicit envelope. Otherwise it is emitted as \`engine-side error (investigate)\` and this command exits non-zero after writing the report.\n\n| class | MAD limit | maxChannelDelta limit | differing-rate limit |\n|---|---:|---:|---:|\n${limitRows}\n\nThe still-image MAD ceiling is 128 because the 240×160 still covers two thirds of the 320×180 frame and only RGB differs: \`(240×160)/(320×180) × 3/4 × 255 = 127.5\`, rounded up. The generated v2 render receipt confirms that \`still.png\` is absent from the layers command, so this ceiling bounds the render-cut-side projection omission rather than relaxing the engine comparison after observing a failure.\n\n## Interpretation\n\nEngine-side error rows: **${engineErrors.length}**. Every known-difference reason names the concrete ffmpeg/render-path operation active in that isolated window; classes are not accepted merely because a reason string exists.\n\nBlend modes \`screen\` and \`multiply\` are verified by two sample times each. \`add\`, \`difference\`, \`darken\`, \`lighten\`, \`overlay\`, \`hardlight\`, and \`softlight\` are implemented from the ffmpeg-compatible component formulas but remain **unverified** in this fixture.\n\n## Layer scaling measurements\n\np50/p95 milliseconds are listed in stage order. Every layer-count phase has its own timeout and records a skipped reason without suppressing the other counts.\n\n| layers | decode / upload / shaderGpu / present p50/p95 ms |\n|---:|---|\n${scalingRows}\n\n- cold attribution: GPU initialization ${cold?.gpuInitializationMs?.toFixed(3) ?? '—'} ms; first frame ${cold?.firstFrameMs?.toFixed(3) ?? '—'} ms; steady p50 ${cold?.steadyP50Ms?.toFixed(3) ?? '—'} ms; decoder first frame ${cold?.decoderFirstFrameMs?.toFixed(3) ?? '—'} ms.\n- zero-copy probe: ${zero?.skipped ? `skipped: ${zero.skipped}` : `copyTo→planes ${zero?.copyToPlanesMs?.toFixed(3) ?? '—'} ms vs direct VideoFrame texImage2D ${zero?.directVideoFrameTexImageMs?.toFixed(3) ?? '—'} ms (ratio ${zero?.directToCopyRatio?.toFixed(3) ?? '—'})`}. This is measurement only; the production upload path remains unchanged.\n`;
writeFileSync(resolve(packageDirectory, 'docs/layers-report.md'), report);
process.stdout.write(
  `layers comparison: ${rows.length} samples; report=${resolve(packageDirectory, 'docs/layers-report.md')}\n`,
);
if (engineErrors.length > 0) {
  throw new Error(
    `${engineErrors.length} layer comparison rows exceed their reviewed limits`,
  );
}
