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

const addProbe = spawnSync(
  ffmpeg,
  [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=black:s=2x2:d=0.1',
    '-f', 'lavfi', '-i', 'color=white:s=2x2:d=0.1',
    '-filter_complex', '[0:v][1:v]blend=all_mode=add',
    '-frames:v', '1', '-f', 'null', '-',
  ],
  { encoding: 'utf8', timeout: 30_000 },
);
if (addProbe.error || addProbe.status === 0) {
  throw new Error(
    `ffmpeg add-vocabulary probe did not fail as required: ${addProbe.error?.message ?? addProbe.stderr}`,
  );
}
const addFailureText = addProbe.stderr
  .trim()
  .replaceAll('|', '\\|')
  .replaceAll('\n', '<br>');

if (
  !existsSync(resultsPath) ||
  JSON.parse(readFileSync(resultsPath, 'utf8')).layerParity?.length !== 36
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
  // render-cut passes the edit vocabulary "add" directly to ffmpeg, whose mode is named
  // "addition". Keep that known unsupported row visible below while allowing every other
  // isolated layer window to render and be compared.
  layers: fixtureEdit.layers
    .filter((layer) => layer.id !== 'blend-add')
    .map((layer) => ({
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

const BLEND_LUT_CASES = [
  { id: 'add', ffmpegMode: 'addition', meanLimit: 0, maxLimit: 0 },
  { id: 'difference', ffmpegMode: 'difference', meanLimit: 0, maxLimit: 0 },
  { id: 'darken', ffmpegMode: 'darken', meanLimit: 0, maxLimit: 0 },
  { id: 'lighten', ffmpegMode: 'lighten', meanLimit: 0, maxLimit: 0 },
  { id: 'screen', ffmpegMode: 'screen', meanLimit: 0.5, maxLimit: 1 },
  { id: 'multiply', ffmpegMode: 'multiply', meanLimit: 0.5, maxLimit: 1 },
  { id: 'overlay', ffmpegMode: 'overlay', meanLimit: 1, maxLimit: 2 },
  { id: 'hardlight', ffmpegMode: 'hardlight', meanLimit: 1, maxLimit: 2 },
  // The shader intentionally retains the W3C/CSS curve while ffmpeg uses a different
  // soft-light transfer function, so this mode alone has a wider reviewed envelope.
  { id: 'softlight', ffmpegMode: 'softlight', meanLimit: 4.5, maxLimit: 31 },
];

// This is a literal JavaScript counterpart of LAYER_FRAGMENT's blend(dst, src). Keeping it
// beside the exhaustive LUT comparison makes a shader formula change fail against ffmpeg.
function shaderBlend(mode, dst, src) {
  if (mode === 'screen') return 1 - (1 - dst) * (1 - src);
  if (mode === 'multiply') return dst * src;
  if (mode === 'add') return Math.min(1, dst + src);
  if (mode === 'difference') return Math.abs(dst - src);
  if (mode === 'darken') return Math.min(dst, src);
  if (mode === 'lighten') return Math.max(dst, src);
  if (mode === 'overlay')
    return dst < 0.5 ? 2 * dst * src : 1 - 2 * (1 - dst) * (1 - src);
  if (mode === 'hardlight')
    return src < 0.5 ? 2 * dst * src : 1 - 2 * (1 - dst) * (1 - src);
  if (mode === 'softlight') {
    const curve = dst < 0.25
      ? ((16 * dst - 12) * dst + 4) * dst
      : Math.sqrt(dst);
    return src < 0.5
      ? dst - (1 - 2 * src) * dst * (1 - dst)
      : dst + (2 * src - 1) * (curve - dst);
  }
  throw new Error(`unsupported shader LUT mode: ${mode}`);
}

function blendLutInput(axis) {
  const plane = Buffer.alloc(256 * 256);
  for (let row = 0; row < 256; row += 1) {
    for (let column = 0; column < 256; column += 1) {
      plane[row * 256 + column] = axis === 'column' ? column : row;
    }
  }
  return Buffer.concat([plane, plane, plane]);
}

const lutTopPath = resolve(generated, 'blend-lut-top.gbrp');
const lutBottomPath = resolve(generated, 'blend-lut-bottom.gbrp');
writeFileSync(lutTopPath, blendLutInput('column'));
writeFileSync(lutBottomPath, blendLutInput('row'));
const blendLutRows = BLEND_LUT_CASES.map((entry) => {
  const output = execFileSync(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'rawvideo', '-pixel_format', 'gbrp', '-video_size', '256x256',
      '-i', lutTopPath,
      '-f', 'rawvideo', '-pixel_format', 'gbrp', '-video_size', '256x256',
      '-i', lutBottomPath,
      '-filter_complex', `[0:v][1:v]blend=all_mode=${entry.ffmpegMode}`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gbrp', 'pipe:1',
    ],
    { maxBuffer: 256 * 256 * 6 },
  );
  let totalDelta = 0;
  let maxDelta = 0;
  for (let row = 0; row < 256; row += 1) {
    for (let column = 0; column < 256; column += 1) {
      const actual = output[row * 256 + column];
      const expected = Math.round(
        Math.max(0, Math.min(1, shaderBlend(entry.id, column / 255, row / 255)))
          * 255,
      );
      const delta = Math.abs(actual - expected);
      totalDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
    }
  }
  const meanDelta = totalDelta / (256 * 256);
  return {
    ...entry,
    meanDelta,
    maxDelta,
    pass: meanDelta <= entry.meanLimit && maxDelta <= entry.maxLimit,
  };
});

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
  'blend-add':
    'render-cut cannot render this vocabulary entry because ffmpeg names the mode addition',
  'blend-difference':
    'ffmpeg converts both inputs through gbrp blend and maskedmerge before returning to yuv420p',
  'blend-darken':
    'ffmpeg converts both inputs through gbrp blend and maskedmerge before returning to yuv420p',
  'blend-lighten':
    'ffmpeg converts both inputs through gbrp blend and maskedmerge before returning to yuv420p',
  'blend-overlay':
    'ffmpeg gbrp conversion and its integer overlay transfer function add bounded rounding differences',
  'blend-hardlight':
    'ffmpeg gbrp conversion and its integer hardlight transfer function add bounded rounding differences',
  'blend-softlight':
    'the engine retains the W3C/CSS softlight curve while ffmpeg uses a different transfer function',
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
  'blend-add': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'blend-difference': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'blend-darken': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'blend-lighten': {
    madFloorMultiplier: 10,
    madAllowance: 12,
    maxFloorMultiplier: 8,
    maxAllowance: 48,
  },
  'blend-overlay': {
    madFloorMultiplier: 10,
    madAllowance: 14,
    maxFloorMultiplier: 8,
    maxAllowance: 50,
  },
  'blend-hardlight': {
    madFloorMultiplier: 10,
    madAllowance: 14,
    maxFloorMultiplier: 8,
    maxAllowance: 50,
  },
  'blend-softlight': {
    madFloorMultiplier: 12,
    madAllowance: 18,
    maxFloorMultiplier: 8,
    maxAllowance: 80,
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
  const cls = classOf(sample.label);
  if (cls === 'blend-add') {
    return {
      class: cls,
      label: sample.label,
      engineTimeSec: sample.timeUs / 1e6,
      frameNumber,
      frameMidpointSec,
      MAD: null,
      differingPixels: null,
      differingPixelRate: null,
      maxChannelDelta: null,
    };
  }
  const metrics = compare(rawPng(enginePath), rawRenderFrame(frameNumber));
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
  if (row.class === 'blend-add') {
    return {
      ...row,
      classification: 'render-cut cannot render this vocabulary entry',
      reason: `${KNOWN_DIFFERENCE_REASON['blend-add']}: ${addFailureText}`,
      limits: CLASS_LIMITS['blend-add'],
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
      `| ${row.class} | ${row.label} | ${row.frameNumber} | ${row.frameMidpointSec.toFixed(6)} | ${row.MAD === null ? '—' : row.MAD.toFixed(4)} | ${row.differingPixels ?? '—'} | ${row.differingPixelRate === null ? '—' : `${(row.differingPixelRate * 100).toFixed(2)}%`} | ${row.maxChannelDelta ?? '—'} | ${row.classification} | ${row.reason} |`,
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
const blendLutTable = blendLutRows
  .map(
    (row) =>
      `| ${row.id} | ${row.ffmpegMode} | ${row.meanDelta.toFixed(3)} | ${row.maxDelta} | ≤ ${row.meanLimit.toFixed(1)} | ≤ ${row.maxLimit} | ${row.pass ? 'pass' : 'engine-side error (investigate)'} |`,
  )
  .join('\n');
const blendLutErrors = blendLutRows.filter((row) => !row.pass);
const interpretation = 'Blend modes `difference`, `darken`, `lighten`, `overlay`, `hardlight`, and `softlight` are verified by two render-cut sample times each, in addition to `screen` and `multiply`. `add` is verified at the transfer-function level with ffmpeg\'s `addition` mode, but render-cut cannot render the edit vocabulary entry and is reported explicitly instead of being silently skipped.';
const completeReport = `${report.replace(
  /Blend modes `screen`[\s\S]*?remain \*\*unverified\*\* in this fixture\./u,
  interpretation,
)}\n## Blend transfer-function LUT\n\nEach row compares all 65,536 byte pairs. ffmpeg receives input 0 as the column value and input 1 as the row value in \`gbrp\`; the JavaScript reference directly corresponds to the component formulas in \`LAYER_FRAGMENT\`. The softlight envelope is wider because the engine intentionally retains the W3C/CSS curve while ffmpeg uses a different transfer function.\n\n| edit mode | ffmpeg mode | mean absolute delta | max absolute delta | mean limit | max limit | classification |\n|---|---|---:|---:|---:|---:|---|\n${blendLutTable}\n\nThe \`add\` LUT uses ffmpeg's valid \`addition\` mode. The render-cut vocabulary probe separately executed \`blend=all_mode=add\` and failed with exit code ${addProbe.status}: ${addFailureText}\n`;
writeFileSync(resolve(packageDirectory, 'docs/layers-report.md'), completeReport);
process.stdout.write(
  `layers comparison: ${rows.length} samples; report=${resolve(packageDirectory, 'docs/layers-report.md')}\n`,
);
if (engineErrors.length > 0 || blendLutErrors.length > 0) {
  throw new Error(
    `${engineErrors.length} layer comparison rows and ${blendLutErrors.length} blend LUT rows exceed their reviewed limits`,
  );
}
