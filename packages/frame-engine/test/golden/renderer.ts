import './decoder-instrumentation.js';
import { inspectGopTailGolden } from './gop-tail.js';
import {
  BufferedRawFrameSink,
  buildResolvedTimelinePlan,
  CachedStillImageSource,
  ClipSessionPool,
  FrameMetrics,
  parseCube,
  WebGL2Compositor,
  capturePresentedRgba,
  compareRgba,
  evaluateFrame,
  evaluationPlanFromResolvedTimeline,
  presentFrame,
  readbackFrame,
} from '../../src/index.js';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import type {
  EvaluationPlan,
  FrameEngineCut,
  FrameEngineLayer,
  FrameMetricStage,
  NativeFrameSource,
  ResolvedCutVisual,
  ResolvedTransition,
  StillImageSource,
} from '../../src/index.js';
import edit from './edit.json';
import layersEdit from './layers.edit.json';
import matteEdit from './matte.edit.json';
import transitionsEdit from './transitions.edit.json';

interface GoldenBridge {
  fixtureUrl: string;
  fixtureCodecs: Record<string, string>;
  loadLut(id: string): Promise<string>;
  writeArtifact(name: string, bytes: Uint8Array): Promise<boolean>;
  startEncoder(options: {
    width: number;
    height: number;
    fps: number;
  }): Promise<string>;
  writeEncoderFrame(bytes: Uint8Array): Promise<number>;
  finishEncoder(): Promise<{
    path: string;
    frames: number;
    sha256: string;
    extracted: Array<{ timeSec: number; sha256: string }>;
    distinctExtractedHashes: number;
    durationSeconds: number;
  }>;
  complete(result: unknown): Promise<boolean>;
  fail(message: string): Promise<boolean>;
}

declare global {
  interface Window {
    goldenHarness: GoldenBridge;
  }
  var __frameEngineDecoderInstances: VideoDecoder[] | undefined;
}

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const SOURCE_URL = window.goldenHarness.fixtureUrl;
const SOURCE_B_URL = new URL('source-b.mp4', SOURCE_URL).href;
const STILL_URL = new URL('still.png', SOURCE_URL).href;
const MATTE_COLOR_URL = new URL('matte-color.mp4', SOURCE_URL).href;
const MATTE_ALPHA_URL = new URL('matte-alpha.webm', SOURCE_URL).href;
const MATTE_MASK_URL = new URL('matte-mask.mp4', SOURCE_URL).href;
const COLOR_PATCHES_URL = new URL('color-patches.mp4', SOURCE_URL).href;
const REQUESTED_UPLOAD_PATH = new URL(window.location.href).searchParams.get('uploadPath') === 'copyTo'
  ? 'copyTo'
  : 'direct';
const SAMPLE_POINTS = [
  ['hard-cut-before', 900_000],
  ['hard-cut-after', 1_100_000],
  ['speed-start', 1_250_000],
  ['speed-end', 1_750_000],
  ['framing-static', 2_500_000],
  ['zoom-start', 3_050_000],
  ['zoom-mid', 3_500_000],
  ['zoom-end', 3_950_000],
  ['transform', 4_500_000],
  ['freeze-before', 5_200_000],
  ['freeze-inside-a', 5_450_000],
  ['freeze-inside-b', 5_750_000],
  ['freeze-after', 6_200_000],
  ['dissolve-before', 7_160_000],
  ['dissolve-mid', 7_350_000],
  ['dissolve-after', 7_540_000],
  ['fade-black-before', 7_860_000],
  ['fade-black-mid', 8_050_000],
  ['fade-black-after', 8_240_000],
  ['fade-white-before', 8_560_000],
  ['fade-white-mid', 8_750_000],
  ['fade-white-after', 8_940_000],
  ['reveal-down-before', 9_260_000],
  ['reveal-down-mid', 9_450_000],
  ['reveal-down-after', 9_640_000],
  ['reveal-up-before', 9_960_000],
  ['reveal-up-mid', 10_150_000],
  ['reveal-up-after', 10_340_000],
] as const;

function meanRgb(
  rgba: Uint8Array,
  startRow = 0,
  endRow = HEIGHT,
): [number, number, number] {
  const totals: [number, number, number] = [0, 0, 0];
  let pixels = 0;
  for (let row = startRow; row < endRow; row += 1) {
    for (let column = 0; column < WIDTH; column += 1) {
      const offset = (row * WIDTH + column) * 4;
      totals[0] += rgba[offset]!;
      totals[1] += rgba[offset + 1]!;
      totals[2] += rgba[offset + 2]!;
      pixels += 1;
    }
  }
  return totals.map((value) => value / pixels) as [number, number, number];
}

function colorDistance(
  left: readonly number[],
  right: readonly number[],
): number {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0),
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function rgbaToPng(rgba: Uint8Array): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG canvas unavailable');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(rgba), WIDTH, HEIGHT),
    0,
    0,
  );
  const blob = await new Promise<Blob>((resolveBlob, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolveBlob(value)
          : reject(new Error('PNG encoding returned null')),
      'image/png',
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

const COLOR_PATCHES = [
  { name: 'black', rgb: [0, 0, 0] },
  { name: 'white', rgb: [255, 255, 255] },
  { name: 'red', rgb: [255, 0, 0] },
  { name: 'green', rgb: [0, 255, 0] },
  { name: 'blue', rgb: [0, 0, 255] },
  { name: 'cyan', rgb: [0, 255, 255] },
  { name: 'magenta', rgb: [255, 0, 255] },
  { name: 'yellow', rgb: [255, 255, 0] },
  { name: 'mid-gray', rgb: [128, 128, 128] },
] as const;

const fullFrameVisual: ResolvedCutVisual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1,
};

function centerMean(rgba: Uint8Array): [number, number, number] {
  const totals: [number, number, number] = [0, 0, 0];
  const startX = WIDTH / 2 - 8;
  const startY = HEIGHT / 2 - 8;
  for (let y = startY; y < startY + 16; y += 1) {
    for (let x = startX; x < startX + 16; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      totals[0] += rgba[offset]!;
      totals[1] += rgba[offset + 1]!;
      totals[2] += rgba[offset + 2]!;
    }
  }
  return totals.map(value => value / 256) as [number, number, number];
}

function meanAbsoluteRgbDiff(left: Uint8Array, right: Uint8Array): number {
  let total = 0;
  let channels = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      total += Math.abs(left[offset + channel]! - right[offset + channel]!);
      channels += 1;
    }
  }
  return total / channels;
}

async function inspectColorPatches(output: EvaluationPlan['output']) {
  const directSource = new ClipSessionPool('colors-direct', COLOR_PATCHES_URL);
  const copySource = new ClipSessionPool('colors-copy', COLOR_PATCHES_URL);
  const maskSource = new ClipSessionPool('colors-mask', MATTE_MASK_URL);
  const directMetrics = new FrameMetrics();
  const copyMetrics = new FrameMetrics();
  const directCompositor = new WebGL2Compositor(undefined, { uploadPath: 'direct' });
  const copyCompositor = new WebGL2Compositor(undefined, { uploadPath: 'copyTo' });
  const directRows = [];
  const copyRows = [];
  const crossPathDiff = [];
  const directTimestamps = new Map<string, number>();
  const copyTimestamps = new Map<string, number>();
  const recordTimestamps = (
    source: NativeFrameSource,
    timestamps: Map<string, number>,
  ): NativeFrameSource => ({
    async decode(timeUs, metrics, request) {
      const frame = await source.decode(timeUs, metrics, request);
      timestamps.set(request?.streamId ?? '', Number(frame.timestamp));
      return frame;
    },
  });
  const directRecordedSource = recordTimestamps(directSource, directTimestamps);
  const copyRecordedSource = recordTimestamps(copySource, copyTimestamps);
  try {
    for (let index = 0; index < COLOR_PATCHES.length; index += 1) {
      const patch = COLOR_PATCHES[index]!;
      const timeUs = Math.round((index * 0.5 + 0.25) * 1e6);
      const windowStartUs = index * 500_000;
      const windowEndUs = (index + 1) * 500_000;
      const planFor = (source: NativeFrameSource, id: string): EvaluationPlan => ({
        timeUs,
        base: [{ id, source, sourceTimeUs: timeUs, visual: fullFrameVisual }],
        layers: [],
        output,
      });
      const render = async (
        plan: EvaluationPlan,
        compositor: WebGL2Compositor,
        metrics: FrameMetrics,
      ) => {
        const frame = await evaluateFrame(plan, { compositor, metrics });
        try {
          return { rgba: await frame.surface.readRgba(), uploadPath: frame.uploadPath };
        } finally {
          frame.close();
        }
      };
      const directStreamId = `direct-${index}`;
      const copyStreamId = `copy-${index}`;
      const direct = await render(
        planFor(directRecordedSource, directStreamId),
        directCompositor,
        directMetrics,
      );
      const copy = await render(
        planFor(copyRecordedSource, copyStreamId),
        copyCompositor,
        copyMetrics,
      );
      const directTimestampUs = directTimestamps.get(directStreamId) ?? null;
      const copyTimestampUs = copyTimestamps.get(copyStreamId) ?? null;
      const directTimestampInWindow = directTimestampUs != null
        && directTimestampUs >= windowStartUs && directTimestampUs < windowEndUs;
      const copyTimestampInWindow = copyTimestampUs != null
        && copyTimestampUs >= windowStartUs && copyTimestampUs < windowEndUs;
      const directMean = centerMean(direct.rgba);
      const copyMean = centerMean(copy.rgba);
      const directDelta = directMean.map((value, channel) => Math.abs(value - patch.rgb[channel]!));
      const copyDelta = copyMean.map((value, channel) => Math.abs(value - patch.rgb[channel]!));
      directRows.push({ name: patch.name, expected: patch.rgb, actual: directMean, delta: directDelta,
        requestedTimestampUs: timeUs, decodedTimestampUs: directTimestampUs,
        timestampWindowUs: [windowStartUs, windowEndUs], timestampInWindow: directTimestampInWindow,
        uploadPath: direct.uploadPath,
        pass: directDelta.every(value => value <= 2) && directTimestampInWindow });
      copyRows.push({ name: patch.name, expected: patch.rgb, actual: copyMean, delta: copyDelta,
        requestedTimestampUs: timeUs, decodedTimestampUs: copyTimestampUs,
        timestampWindowUs: [windowStartUs, windowEndUs], timestampInWindow: copyTimestampInWindow,
        uploadPath: copy.uploadPath,
        pass: copyDelta.every(value => value <= 2) && copyTimestampInWindow });
      crossPathDiff.push({
        name: patch.name,
        ...compareRgba(direct.rgba, copy.rgba),
        meanAbsoluteDelta: meanAbsoluteRgbDiff(direct.rgba, copy.rgba),
      });
    }

    const maskFrameNumber = 10;
    const maskTimeUs = Math.round(((maskFrameNumber + 0.5) / FPS) * 1e6);
    const maskPlan: EvaluationPlan = {
      timeUs: maskTimeUs,
      base: [{ id: 'mask-base', source: directSource, sourceTimeUs: 250_000, visual: fullFrameVisual }],
      layers: [{
        id: 'mask-layer', kind: 'matte', source: directSource, sourceTimeUs: 750_000,
        mask: { kind: 'greyscale', source: maskSource, sourceTimeUs: maskTimeUs },
        visual: {
          crop: { x: 0, y: 0, width: 1, height: 1 },
          perspective: null,
          transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
        },
        blend: 'normal', opacity: 1,
      }],
      output,
    };
    const maskFrame = await evaluateFrame(maskPlan, {
      compositor: directCompositor,
      metrics: directMetrics,
    });
    let maxDelta = 0;
    let samples = 0;
    try {
      const rgba = await maskFrame.surface.readRgba();
      const start = (5 * maskFrameNumber) % 288;
      const end = start + 31;
      for (let y = 4; y < HEIGHT - 4; y += 8) {
        for (let x = 4; x < WIDTH - 4; x += 4) {
          if (Math.abs(x - start) <= 2 || Math.abs(x - end) <= 2) continue;
          const expected = x >= start && x <= end ? 255 : 0;
          const offset = (y * WIDTH + x) * 4;
          maxDelta = Math.max(maxDelta, Math.abs(rgba[offset]! - expected));
          samples += 1;
        }
      }
    } finally {
      maskFrame.close();
    }
    const maskFidelity = { frameNumber: maskFrameNumber, samples, maxDelta, pass: maxDelta <= 3 };
    return {
      colorspaceConversion: directCompositor.stats.colorspaceConversion,
      direct: { rows: directRows, pass: directRows.every(row => row.pass) },
      copyTo: { rows: copyRows, pass: copyRows.every(row => row.pass) },
      crossPathDiff,
      maskFidelity,
      pass: directRows.every(row => row.pass)
        && copyRows.every(row => row.pass)
        && maskFidelity.pass
        && directCompositor.uploadPath === 'direct',
    };
  } finally {
    directSource.destroy();
    copySource.destroy();
    maskSource.destroy();
    directCompositor.dispose();
    copyCompositor.dispose();
  }
}

async function inspectTexturedCrossPath(
  output: EvaluationPlan['output'],
  timeline: ReturnType<typeof buildResolvedTimelinePlan>,
  layerTimeline: ReturnType<typeof buildResolvedTimelinePlan>,
) {
  const directMain = new ClipSessionPool('textured-direct-main', SOURCE_URL);
  const directLayer = new ClipSessionPool('textured-direct-layer', SOURCE_B_URL);
  const copyMain = new ClipSessionPool('textured-copy-main', SOURCE_URL);
  const copyLayer = new ClipSessionPool('textured-copy-layer', SOURCE_B_URL);
  const directSources = new Map<string, NativeFrameSource>([
    [SOURCE_URL, directMain],
    [SOURCE_B_URL, directLayer],
  ]);
  const copySources = new Map<string, NativeFrameSource>([
    [SOURCE_URL, copyMain],
    [SOURCE_B_URL, copyLayer],
  ]);
  const directCompositor = new WebGL2Compositor(undefined, { uploadPath: 'direct' });
  const copyCompositor = new WebGL2Compositor(undefined, { uploadPath: 'copyTo' });
  const directMetrics = new FrameMetrics();
  const copyMetrics = new FrameMetrics();
  const points = [
    { label: 'layer-static-crop', timeUs: Math.round((15.5 / FPS) * 1e6), layers: true },
    { label: 'framing-static', timeUs: 2_500_000, layers: false },
    { label: 'zoom-mid', timeUs: 3_500_000, layers: false },
  ] as const;
  try {
    const render = async (
      plan: EvaluationPlan,
      compositor: WebGL2Compositor,
      metrics: FrameMetrics,
    ) => {
      const frame = await evaluateFrame(plan, { compositor, metrics });
      try {
        return await frame.surface.readRgba();
      } finally {
        frame.close();
      }
    };
    const rows = [];
    for (const point of points) {
      const resolved = point.layers ? layerTimeline : timeline;
      const directPlan = evaluationPlanFromResolvedTimeline(
        resolved,
        point.timeUs,
        directSources,
        output,
      );
      const copyPlan = evaluationPlanFromResolvedTimeline(
        resolved,
        point.timeUs,
        copySources,
        output,
      );
      const direct = await render(directPlan, directCompositor, directMetrics);
      const copyTo = await render(copyPlan, copyCompositor, copyMetrics);
      rows.push({
        label: point.label,
        timeUs: point.timeUs,
        baseFrames: directPlan.base.length,
        layers: directPlan.layers.length,
        ...compareRgba(direct, copyTo),
        meanAbsoluteDelta: meanAbsoluteRgbDiff(direct, copyTo),
      });
    }
    return {
      directUploadPath: directCompositor.uploadPath,
      copyToUploadPath: copyCompositor.uploadPath,
      rows,
    };
  } finally {
    directMain.destroy();
    directLayer.destroy();
    copyMain.destroy();
    copyLayer.destroy();
    directCompositor.dispose();
    copyCompositor.dispose();
  }
}

async function inspectFrameLifetime(output: EvaluationPlan['output']) {
  const session = new ClipSessionPool('frame-lifetime', MATTE_COLOR_URL);
  let handedOut = 0;
  let closed = 0;
  const source: NativeFrameSource = {
    async decode(timeUs, metrics, request) {
      const frame = await session.decode(timeUs, metrics, request);
      handedOut += 1;
      const nativeClose = frame.close.bind(frame);
      let didClose = false;
      Object.defineProperty(frame, 'close', {
        configurable: true,
        value() {
          if (didClose) return;
          didClose = true;
          closed += 1;
          nativeClose();
        },
      });
      return frame;
    },
  };
  const compositor = new WebGL2Compositor(undefined, { uploadPath: REQUESTED_UPLOAD_PATH });
  const metrics = new FrameMetrics();
  const queueSamples: number[] = [];
  const safeFrames = Array.from({ length: 389 }, (_value, index) => index)
    .filter(frameNumber => frameNumber % 30 !== 29);
  try {
    for (let index = 0; index < 1_000; index += 1) {
      const frameNumber = safeFrames[index % safeFrames.length]!;
      const timeUs = Math.round(((frameNumber + 0.5) / FPS) * 1e6);
      const plan: EvaluationPlan = {
        timeUs,
        base: [{ id: 'lifetime', source, sourceTimeUs: timeUs, visual: fullFrameVisual }],
        layers: [],
        output,
      };
      const frame = await evaluateFrame(plan, { compositor, metrics });
      frame.close();
      queueSamples.push((globalThis.__frameEngineDecoderInstances ?? [])
        .reduce((sum, decoder) => sum + decoder.decodeQueueSize, 0));
    }
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    const decodeQueueSizeFinal = (globalThis.__frameEngineDecoderInstances ?? [])
      .reduce((sum, decoder) => sum + decoder.decodeQueueSize, 0);
    const firstHalfMax = Math.max(...queueSamples.slice(0, 100));
    const secondHalfMax = Math.max(...queueSamples.slice(-100));
    const openFrames = handedOut - closed;
    return {
      frames: 1_000,
      handedOut,
      closed,
      openFrames,
      decodeQueueSizeMax: Math.max(...queueSamples),
      decodeQueueSizeFinal,
      firstHalfMax,
      secondHalfMax,
      pass: handedOut === closed
        && openFrames === 0
        && decodeQueueSizeFinal === 0
        && secondHalfMax <= firstHalfMax + 4,
    };
  } finally {
    session.destroy();
    compositor.dispose();
  }
}

async function parityFrame(
  plan: EvaluationPlan,
  context: { compositor: WebGL2Compositor; metrics: FrameMetrics },
  previewCanvas: HTMLCanvasElement,
) {
  const frame = await evaluateFrame(plan, context);
  try {
    presentFrame(frame, previewCanvas);
    const preview = capturePresentedRgba(previewCanvas);
    const sink = new BufferedRawFrameSink();
    await readbackFrame(frame, sink);
    const exported = sink.frames[0]?.rgba;
    if (!exported) throw new Error(`export sink produced no frame at ${plan.timeUs}us`);
    const comparison = compareRgba(preview, exported);
    const previewSha256 = await sha256(preview);
    const exportSha256 = await sha256(exported);
    return {
      preview,
      exported,
      previewSha256,
      exportSha256,
      ...comparison,
      pass: comparison.differingPixels === 0
        && comparison.maxDelta === 0
        && previewSha256 === exportSha256,
    };
  } finally {
    frame.close();
  }
}

// Keep this frame-grid formula identical to transitionOutputTimeSeconds() in
// transitions-compare.mjs so the engine and render-cut samples address one output frame.
function transitionOutputTimeSeconds(transitionIndex: number, u: number): number {
  return 0.6 * (transitionIndex + 1) + 0.4 * u;
}

async function inspectTransitionParity(
  output: EvaluationPlan['output'],
  source: NativeFrameSource,
  context: { compositor: WebGL2Compositor; metrics: FrameMetrics },
  previewCanvas: HTMLCanvasElement,
) {
  const rows: Array<Record<string, unknown>> = [];
  const ids = ['hard-cut', ...TRANSITION_VOCABULARY.map(entry => entry.id)] as const;
  const timeline = buildResolvedTimelinePlan(
    transitionsEdit.cuts as FrameEngineCut[],
    { fps: FPS },
  );
  const sources = new Map([[SOURCE_URL, source]]);
  let negativeSeed: { preview: Uint8Array; exported: Uint8Array } | null = null;
  for (const [index, id] of ids.entries()) {
    for (const u of [0.25, 0.5, 0.75]) {
      let plan: EvaluationPlan;
      if (id === 'hard-cut') {
        const sourceTimeUs = Math.round((0.6 + u * 0.4) * 1e6);
        plan = {
          timeUs: sourceTimeUs,
          base: [
            { id: 'transition-hard-cut', source, sourceTimeUs, visual: fullFrameVisual },
          ],
          layers: [],
          transition: { type: 'hard-cut', progress: u },
          output,
        };
      } else {
        const transitionIndex = index - 1;
        const timeUs = Math.round(transitionOutputTimeSeconds(transitionIndex, u) * 1e6);
        plan = evaluationPlanFromResolvedTimeline(
          timeline,
          timeUs,
          sources,
          output,
        );
        if (plan.transition?.type !== id) {
          throw new Error(`${id} resolved as ${plan.transition?.type ?? 'none'}`);
        }
        if (Math.abs(plan.transition.progress - u) >= 1e-6) {
          throw new Error(`${id} resolved progress ${plan.transition.progress}; expected ${u}`);
        }
      }
      const sourceFrames = plan.base
        .map(layer => Math.round(layer.sourceTimeUs * FPS / 1e6));
      if (sourceFrames.some(frameNumber => frameNumber % 30 === 29)) {
        throw new Error(`${id} u=${u} selects a GOP-final source frame`);
      }
      const rendered = await parityFrame(plan, context, previewCanvas);
      const suffix = String(Math.round(u * 100));
      await window.goldenHarness.writeArtifact(
        `transitions/${id}-u${suffix}.png`,
        await rgbaToPng(rendered.exported),
      );
      rows.push({
        label: `${id}-u${suffix}`,
        id,
        u,
        timeUs: plan.timeUs,
        gopShiftedFrames: 0,
        sourceTimesUs: plan.base.map(layer => layer.sourceTimeUs),
        sourceFrames,
        differingPixels: rendered.differingPixels,
        maxDelta: rendered.maxDelta,
        previewSha256: rendered.previewSha256,
        exportSha256: rendered.exportSha256,
        pass: rendered.pass,
      });
      negativeSeed ??= { preview: rendered.preview, exported: rendered.exported };
    }
  }
  if (!negativeSeed) throw new Error('transition negative test has no source frame');
  const mutated = negativeSeed.exported.slice();
  mutated[12] = mutated[12] === 255 ? 254 : mutated[12]! + 1;
  const negative = {
    injectedPixelMutation: true,
    ...compareRgba(negativeSeed.preview, mutated),
  };
  return {
    rows,
    negative,
    fixtureCuts: transitionsEdit.cuts.length,
    pass: rows.length === 90
      && rows.every(row => row.pass === true)
      && negative.differingPixels === 1,
  };
}

function uvPlate(blue: number) {
  const y = new Uint8Array(WIDTH * HEIGHT);
  const u = new Uint8Array((WIDTH / 2) * (HEIGHT / 2));
  const v = new Uint8Array((WIDTH / 2) * (HEIGHT / 2));
  const rgb = (x: number, row: number) => [x / (WIDTH - 1), row / (HEIGHT - 1), blue] as const;
  const limited = (r: number, g: number, b: number) => [
    16 + 255 * (0.182586 * r + 0.614231 * g + 0.062007 * b),
    128 + 255 * (-0.100644 * r - 0.338572 * g + 0.439216 * b),
    128 + 255 * (0.439216 * r - 0.398942 * g - 0.040274 * b),
  ];
  for (let row = 0; row < HEIGHT; row += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const [r, g, b] = rgb(x, row);
      y[row * WIDTH + x] = Math.round(limited(r, g, b)[0]!);
    }
  }
  for (let row = 0; row < HEIGHT; row += 2) {
    for (let x = 0; x < WIDTH; x += 2) {
      const totals: [number, number, number] = [0, 0, 0];
      for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
        const [r, g, b] = rgb(x + dx, row + dy);
        const values = limited(r, g, b);
        totals[1] += values[1]!;
        totals[2] += values[2]!;
      }
      const offset = (row / 2) * (WIDTH / 2) + x / 2;
      u[offset] = Math.round(totals[1]! / 4);
      v[offset] = Math.round(totals[2]! / 4);
    }
  }
  return { format: 'I420' as const, width: WIDTH, height: HEIGHT, y, u, v };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

function analyzeUvPlate(rgba: Uint8Array) {
  const rowProfile = Array(HEIGHT).fill(0) as number[];
  const colProfile = Array(WIDTH).fill(0) as number[];
  const aDx: number[] = [], aDy: number[] = [], bDx: number[] = [], bDy: number[] = [];
  let bPixels = 0, intermediate = 0, saturation = 0;
  let horizontalGradientEnergy = 0, verticalGradientEnergy = 0;
  const mean: [number, number, number] = [0, 0, 0];
  const squared: [number, number, number] = [0, 0, 0];
  const quadrantB = [0, 0, 0, 0];
  let centerB = 0, centerPixels = 0, cornerB = 0, cornerPixels = 0;
  for (let row = 0; row < HEIGHT; row += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (row * WIDTH + x) * 4;
      const r = rgba[offset]!, g = rgba[offset + 1]!, b = rgba[offset + 2]!;
      mean[0] += r; mean[1] += g; mean[2] += b;
      squared[0] += r * r; squared[1] += g * g; squared[2] += b * b;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
      const unitB = b / 255;
      if (unitB > 0.7) {
        bPixels += 1; rowProfile[row]! += 1; colProfile[x]! += 1;
        quadrantB[(row >= HEIGHT / 2 ? 2 : 0) + (x >= WIDTH / 2 ? 1 : 0)]! += 1;
        bDx.push((r / 255) * (WIDTH - 1) - x);
        bDy.push((g / 255) * (HEIGHT - 1) - row);
      } else if (unitB < 0.3) {
        aDx.push((r / 255) * (WIDTH - 1) - x);
        aDy.push((g / 255) * (HEIGHT - 1) - row);
      }
      if (unitB > 0.15 && unitB < 0.85) intermediate += 1;
      if (Math.abs(x - WIDTH / 2) < 8 && Math.abs(row - HEIGHT / 2) < 8) {
        centerPixels += 1;
        if (unitB > 0.7) centerB += 1;
      }
      if ((x < 16 || x >= WIDTH - 16) && (row < 16 || row >= HEIGHT - 16)) {
        cornerPixels += 1;
        if (unitB > 0.7) cornerB += 1;
      }
      if (x > 0) horizontalGradientEnergy += Math.abs(r - rgba[offset - 4]!);
      if (row > 0) verticalGradientEnergy += Math.abs(g - rgba[offset - WIDTH * 4 + 1]!);
    }
  }
  rowProfile.forEach((_value, index) => { rowProfile[index]! /= WIDTH; });
  colProfile.forEach((_value, index) => { colProfile[index]! /= HEIGHT; });
  const range = (values: number[]) => Math.max(...values) - Math.min(...values);
  const colRange = range(colProfile), rowRange = range(rowProfile);
  const axis = colRange > rowRange * 1.5 && colRange > 0.2 ? 'x'
    : rowRange > colRange * 1.5 && rowRange > 0.2 ? 'y' : 'none';
  const half = (values: number[], first: boolean) => {
    const slice = first ? values.slice(0, values.length / 2) : values.slice(values.length / 2);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  };
  const left = half(colProfile, true), right = half(colProfile, false);
  const top = half(rowProfile, true), bottom = half(rowProfile, false);
  let bSide = 'none';
  if (axis === 'x') {
    const edge = (colProfile.slice(0, WIDTH / 4).reduce((a, b) => a + b, 0)
      + colProfile.slice(-WIDTH / 4).reduce((a, b) => a + b, 0)) / (WIDTH / 2);
    const center = colProfile.slice(WIDTH / 4, WIDTH * 3 / 4).reduce((a, b) => a + b, 0) / (WIDTH / 2);
    bSide = edge > center + 0.25 ? 'edge' : left > right ? 'left' : 'right';
  } else if (axis === 'y') {
    const edge = (rowProfile.slice(0, HEIGHT / 4).reduce((a, b) => a + b, 0)
      + rowProfile.slice(-HEIGHT / 4).reduce((a, b) => a + b, 0)) / (HEIGHT / 2);
    const center = rowProfile.slice(HEIGHT / 4, HEIGHT * 3 / 4).reduce((a, b) => a + b, 0) / (HEIGHT / 2);
    bSide = edge > center + 0.25 ? 'edge' : top > bottom ? 'top' : 'bottom';
  }
  const count = WIDTH * HEIGHT;
  const middleRow = Math.floor(HEIGHT / 2);
  const runs: number[] = [];
  let run = 1;
  for (let x = 1; x < WIDTH; x += 1) {
    const current = rgba[(middleRow * WIDTH + x) * 4]!;
    const previous = rgba[(middleRow * WIDTH + x - 1) * 4]!;
    if (Math.abs(current - previous) <= 2) run += 1;
    else { if (run > 1) runs.push(run); run = 1; }
  }
  if (run > 1) runs.push(run);
  const runCounts = new Map<number, number>();
  for (const length of runs) runCounts.set(length, (runCounts.get(length) ?? 0) + 1);
  const blockPeriod = [...runCounts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 1;
  return {
    bFraction: bPixels / count,
    intermediateFraction: intermediate / count,
    axis, bSide, rowProfile, colProfile,
    aDisplacementPx: { x: median(aDx), y: median(aDy) },
    bDisplacementPx: { x: median(bDx), y: median(bDy) },
    meanRgb: mean.map(value => value / count),
    meanSaturation: saturation / count,
    radialSignature: centerB / Math.max(1, centerPixels) - cornerB / Math.max(1, cornerPixels),
    angularSignature: quadrantB.map(value => value / (count / 4)),
    uniformity: squared.reduce((sum, value, channel) =>
      sum + value / count - (mean[channel]! / count) ** 2, 0) / 3,
    horizontalGradientEnergy: horizontalGradientEnergy / (count - HEIGHT),
    verticalGradientEnergy: verticalGradientEnergy / (count - WIDTH),
    blockPeriod,
  };
}

async function inspectTransitionSemantics(
  output: EvaluationPlan['output'],
  compositor: WebGL2Compositor,
  metrics: FrameMetrics,
) {
  const a = uvPlate(0), b = uvPlate(1);
  const ids = ['hard-cut', ...TRANSITION_VOCABULARY.map(entry => entry.id)] as const;
  const directional: Record<string, { axis: string; bSide: string; a: [number, number]; b: [number, number] }> = {
    'wipe-left': { axis: 'x', bSide: 'right', a: [0, 0], b: [0, 0] },
    'wipe-right': { axis: 'x', bSide: 'left', a: [0, 0], b: [0, 0] },
    'wipe-up': { axis: 'y', bSide: 'bottom', a: [0, 0], b: [0, 0] },
    'wipe-down': { axis: 'y', bSide: 'top', a: [0, 0], b: [0, 0] },
    'slide-left': { axis: 'x', bSide: 'right', a: [WIDTH / 2, 0], b: [-WIDTH / 2, 0] },
    'slide-right': { axis: 'x', bSide: 'left', a: [-WIDTH / 2, 0], b: [WIDTH / 2, 0] },
    'slide-up': { axis: 'y', bSide: 'bottom', a: [0, HEIGHT / 2], b: [0, -HEIGHT / 2] },
    'slide-down': { axis: 'y', bSide: 'top', a: [0, -HEIGHT / 2], b: [0, HEIGHT / 2] },
    'cover-left': { axis: 'x', bSide: 'right', a: [0, 0], b: [-WIDTH / 2, 0] },
    'cover-right': { axis: 'x', bSide: 'left', a: [0, 0], b: [WIDTH / 2, 0] },
    'cover-up': { axis: 'y', bSide: 'bottom', a: [0, 0], b: [0, -HEIGHT / 2] },
    'cover-down': { axis: 'y', bSide: 'top', a: [0, 0], b: [0, HEIGHT / 2] },
    'reveal-left': { axis: 'x', bSide: 'right', a: [WIDTH / 2, 0], b: [0, 0] },
    'reveal-right': { axis: 'x', bSide: 'left', a: [-WIDTH / 2, 0], b: [0, 0] },
    'reveal-up': { axis: 'y', bSide: 'bottom', a: [0, HEIGHT / 2], b: [0, 0] },
    'reveal-down': { axis: 'y', bSide: 'top', a: [0, -HEIGHT / 2], b: [0, 0] },
  };
  const semanticNames: Record<string, string> = {
    'hard-cut': 'hard-cut:bFraction≈0',
    dissolve: 'blend',
    fade: 'blend',
    'fade-black': 'plate:black',
    'fade-white': 'plate:white',
    'fade-grays': 'gray',
    radial: 'angular',
    'circle-open': 'radial:center',
    'circle-close': 'radial:edge',
    'zoom-in': 'uniform:center',
    'squeeze-h': 'axis=y, bSide=edge',
    'squeeze-v': 'axis=x, bSide=edge',
    blur: 'blur:horizontal',
    pixelize: 'pixelize:block',
  };
  const displacementName = (value: number, axis: string) => {
    if (value === 0) return '0';
    return `${value > 0 ? '+' : '-'}${axis === 'x' ? 'W' : 'H'}/2`;
  };
  const rows = [];
  const mismatches: string[] = [];
  for (const id of ids) {
    const plan: EvaluationPlan = {
      timeUs: 500_000,
      base: [
        { id: `${id}-plate-a`, source: {} as NativeFrameSource, sourceTimeUs: 0, visual: fullFrameVisual },
        { id: `${id}-plate-b`, source: {} as NativeFrameSource, sourceTimeUs: 0, visual: fullFrameVisual },
      ],
      layers: [], transition: { type: id, progress: 0.5 }, output,
    };
    const surface = await compositor.compose([a, b], [], output, metrics, plan);
    const analysis = analyzeUvPlate(await surface.readRgba());
    surface.close();
    let matched = true;
    const expectedDetail = directional[id];
    if (expectedDetail) {
      const tolerance = 16;
      matched = analysis.axis === expectedDetail.axis && analysis.bSide === expectedDetail.bSide
        && Math.abs(analysis.aDisplacementPx.x - expectedDetail.a[0]) <= tolerance
        && Math.abs(analysis.aDisplacementPx.y - expectedDetail.a[1]) <= tolerance
        && Math.abs(analysis.bDisplacementPx.x - expectedDetail.b[0]) <= tolerance
        && Math.abs(analysis.bDisplacementPx.y - expectedDetail.b[1]) <= tolerance;
    } else if (id === 'hard-cut') matched = analysis.bFraction < 0.05;
    else if (id === 'dissolve' || id === 'fade') matched = analysis.intermediateFraction > 0.95;
    else if (id === 'fade-black') matched = analysis.meanRgb.every(value => value < 4);
    else if (id === 'fade-white') matched = analysis.meanRgb.every(value => value > 251);
    else if (id === 'fade-grays') matched = analysis.meanSaturation < 96;
    else if (id === 'circle-open') matched = analysis.radialSignature > 0.2;
    else if (id === 'circle-close') matched = analysis.radialSignature < -0.2;
    else if (id === 'zoom-in') matched = analysis.bFraction < 0.05
      && analysis.horizontalGradientEnergy < 0.1 && analysis.verticalGradientEnergy < 0.1;
    else if (id === 'squeeze-h') matched = analysis.axis === 'y' && analysis.bSide === 'edge';
    else if (id === 'squeeze-v') matched = analysis.axis === 'x' && analysis.bSide === 'edge';
    else if (id === 'radial') matched = Math.max(...analysis.angularSignature)
      - Math.min(...analysis.angularSignature) > 0.1;
    else if (id === 'blur') matched = analysis.intermediateFraction > 0.95;
    else if (id === 'pixelize') matched = analysis.intermediateFraction > 0.95
      && analysis.blockPeriod > 1;
    if (!matched) mismatches.push(id);
    const expected = expectedDetail
      ? `axis=${expectedDetail.axis}, bSide=${expectedDetail.bSide}, aD${expectedDetail.axis}=${displacementName(expectedDetail.a[expectedDetail.axis === 'x' ? 0 : 1], expectedDetail.axis)}, bD${expectedDetail.axis}=${displacementName(expectedDetail.b[expectedDetail.axis === 'x' ? 0 : 1], expectedDetail.axis)}`
      : semanticNames[id] ?? id;
    rows.push({
      id,
      expected,
      expectedDetail: expectedDetail ?? { kind: semanticNames[id] ?? id },
      ...analysis,
      matched,
    });
  }
  return { rows, mismatches, pass: mismatches.length === 0 };
}

const LOOK_IDS = [
  'cinematic', 'cool-clear', 'film-warm', 'forest-soft', 'mono',
  'natural', 'night-neon', 'silver-retain', 'sunset-gold', 'vintage-fade',
] as const;

async function inspectLookParity(
  output: EvaluationPlan['output'],
  source: NativeFrameSource,
  context: { compositor: WebGL2Compositor; metrics: FrameMetrics },
  previewCanvas: HTMLCanvasElement,
) {
  const rows: Array<Record<string, unknown>> = [];
  const parsed = new Map<string, ReturnType<typeof parseCube>>();
  for (const id of LOOK_IDS) parsed.set(id, parseCube(await window.goldenHarness.loadLut(id)));
  for (const id of LOOK_IDS) {
    for (const timeUs of [250_000, 1_250_000]) {
      const plan: EvaluationPlan = {
        timeUs,
        base: [{ id: 'look-sample', source, sourceTimeUs: timeUs, visual: fullFrameVisual }],
        layers: [],
        transition: { type: 'hard-cut', progress: 0 },
        output: { ...output, look: { lut: parsed.get(id)!, intensity: 1 } },
      };
      const rendered = await parityFrame(plan, context, previewCanvas);
      await window.goldenHarness.writeArtifact(
        `look/${id}-t${timeUs}.png`,
        await rgbaToPng(rendered.exported),
      );
      rows.push({ id, timeUs, differingPixels: rendered.differingPixels,
        maxDelta: rendered.maxDelta, previewSha256: rendered.previewSha256,
        exportSha256: rendered.exportSha256, pass: rendered.pass });
    }
  }
  const intensityRows: Array<Record<string, unknown>> = [];
  const basePlan: EvaluationPlan = {
    timeUs: 750_000,
    base: [{ id: 'look-intensity', source, sourceTimeUs: 750_000, visual: fullFrameVisual }],
    layers: [], transition: { type: 'hard-cut', progress: 0 }, output,
  };
  const withoutLook = await parityFrame(basePlan, context, previewCanvas);
  for (const intensity of [0, 0.5, 1]) {
    const rendered = await parityFrame({
      ...basePlan,
      output: { ...output, look: { lut: parsed.get('natural')!, intensity } },
    }, context, previewCanvas);
    const baseline = compareRgba(withoutLook.exported, rendered.exported);
    await window.goldenHarness.writeArtifact(
      `look/intensity-${String(intensity).replace('.', '_')}.png`,
      await rgbaToPng(rendered.exported),
    );
    intensityRows.push({ intensity, differingPixels: rendered.differingPixels,
      baselineDifferingPixels: baseline.differingPixels, pass: rendered.pass
        && (intensity !== 0 || baseline.differingPixels === 0) });
  }
  return {
    rows,
    intensityRows,
    fixtureCuts: 2,
    pass: rows.length === 20 && rows.every(row => row.pass === true)
      && intensityRows.every(row => row.pass === true),
  };
}

async function run(): Promise<void> {
  const metrics = new FrameMetrics();
  const warnings: string[] = [];
  const session = new ClipSessionPool('fixture', SOURCE_URL, {
    onWarning: (warning) => warnings.push(warning),
  });
  const compositor = new WebGL2Compositor(undefined, { uploadPath: REQUESTED_UPLOAD_PATH });
  const context = { compositor, metrics };
  const timeline = buildResolvedTimelinePlan(edit.cuts as FrameEngineCut[], {
    fps: FPS,
  });
  const sources = new Map([[SOURCE_URL, session]]);
  const output = {
    width: WIDTH,
    height: HEIGHT,
    colorSpace: 'bt709-limited' as const,
  };
  const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview');
  if (!previewCanvas) throw new Error('preview canvas missing');
  const parity: Array<Record<string, unknown>> = [];
  let negativeSeed: { preview: Uint8Array; exported: Uint8Array } | null = null;
  const nativeFormats = new Set<string>();
  const renderedByLabel = new Map<string, Uint8Array>();
  const layerSession = new ClipSessionPool('fixture-b', SOURCE_B_URL, {
    onWarning: (warning) => warnings.push(warning),
  });
  const stillSource = new CachedStillImageSource(STILL_URL);
  const layerTimeline = buildResolvedTimelinePlan(
    layersEdit.cuts as FrameEngineCut[],
    {
      fps: FPS,
      layers: layersEdit.layers as FrameEngineLayer[],
    },
  );
  const layerSources = new Map<string, NativeFrameSource | StillImageSource>([
    [SOURCE_URL, session],
    [SOURCE_B_URL, layerSession],
    [STILL_URL, stillSource],
  ]);
  const matteColorSession = new ClipSessionPool('matte-color', MATTE_COLOR_URL, {
    onWarning: (warning) => warnings.push(warning),
  });
  const matteMaskSession = new ClipSessionPool('matte-mask', MATTE_MASK_URL, {
    onWarning: (warning) => warnings.push(warning),
  });
  const matteDecodeCounts = new Map<string, number>();
  const countedSource = (src: string, source: NativeFrameSource): NativeFrameSource => ({
    async decode(timeUs, frameMetrics, request) {
      matteDecodeCounts.set(src, (matteDecodeCounts.get(src) ?? 0) + 1);
      return source.decode(timeUs, frameMetrics, request);
    },
  });
  const matteTimeline = buildResolvedTimelinePlan(
    matteEdit.cuts as FrameEngineCut[],
    { fps: FPS, layers: matteEdit.layers as FrameEngineLayer[] },
  );
  const matteSources = new Map<string, NativeFrameSource>([
    [MATTE_COLOR_URL, countedSource(MATTE_COLOR_URL, matteColorSession)],
    [MATTE_MASK_URL, countedSource(MATTE_MASK_URL, matteMaskSession)],
  ]);
  const frameMidpointUs = (frameNumber: number) =>
    Math.round(((frameNumber + 0.5) / FPS) * 1e6);
  const layerSamplePoints = [
    ['static-crop-a', frameMidpointUs(15)],
    ['static-crop-b', frameMidpointUs(45)],
    ['static-perspective-a', frameMidpointUs(105)],
    ['static-perspective-b', frameMidpointUs(135)],
    ['keyframes-transform-a', frameMidpointUs(195)],
    ['keyframes-transform-b', frameMidpointUs(225)],
    ['keyframes-crop-a', frameMidpointUs(285)],
    ['keyframes-crop-b', frameMidpointUs(315)],
    ['keyframes-perspective-a', frameMidpointUs(375)],
    ['keyframes-perspective-b', frameMidpointUs(405)],
    ['blend-screen-a', frameMidpointUs(465)],
    ['blend-screen-b', frameMidpointUs(495)],
    ['blend-multiply-a', frameMidpointUs(555)],
    ['blend-multiply-b', frameMidpointUs(585)],
    ['opacity-a', frameMidpointUs(645)],
    ['opacity-b', frameMidpointUs(675)],
    ['still-a', frameMidpointUs(735)],
    ['still-b', frameMidpointUs(765)],
    ['stack-3-a', frameMidpointUs(825)],
    ['stack-3-b', frameMidpointUs(855)],
    ['noise-floor-a', frameMidpointUs(915)],
    ['noise-floor-b', frameMidpointUs(945)],
  ] as const;
  const layerParity: Array<Record<string, unknown>> = [];
  let layerNegativeSeed: { preview: Uint8Array; exported: Uint8Array } | null =
    null;

  for (const [label, timeUs] of layerSamplePoints) {
    const plan = evaluationPlanFromResolvedTimeline(
      layerTimeline,
      timeUs,
      layerSources,
      output,
    );
    const frame = await evaluateFrame(plan, context);
    presentFrame(frame, previewCanvas);
    const previewRgba = capturePresentedRgba(previewCanvas);
    const sink = new BufferedRawFrameSink();
    await readbackFrame(frame, sink);
    const exportRgba = sink.frames[0]?.rgba;
    if (!exportRgba)
      throw new Error(`layer export sink produced no frame at ${timeUs}us`);
    const previewPng = await rgbaToPng(previewRgba);
    const exportPng = await rgbaToPng(exportRgba);
    const previewSha256 = await sha256(previewPng);
    const exportSha256 = await sha256(exportPng);
    const comparison = compareRgba(previewRgba, exportRgba);
    const stem = `layer-parity-${String(layerParity.length + 1).padStart(2, '0')}-${label}`;
    await window.goldenHarness.writeArtifact(`${stem}-preview.png`, previewPng);
    await window.goldenHarness.writeArtifact(`${stem}-export.png`, exportPng);
    const pass =
      comparison.differingPixels === 0 &&
      comparison.maxDelta === 0 &&
      previewSha256 === exportSha256;
    layerParity.push({
      label,
      timeUs,
      ...comparison,
      previewSha256,
      exportSha256,
      pass,
    });
    layerNegativeSeed ??= { preview: previewRgba, exported: exportRgba };
    frame.close();
  }

  if (!layerNegativeSeed)
    throw new Error('layer negative test has no source frame');
  const layerMutated = layerNegativeSeed.exported.slice();
  layerMutated[4] = layerMutated[4] === 255 ? 254 : layerMutated[4]! + 1;
  const layerNegativeComparison = compareRgba(
    layerNegativeSeed.preview,
    layerMutated,
  );
  await window.goldenHarness.writeArtifact(
    'layer-negative-preview.png',
    await rgbaToPng(layerNegativeSeed.preview),
  );
  await window.goldenHarness.writeArtifact(
    'layer-negative-export-mutated.png',
    await rgbaToPng(layerMutated),
  );
  const layerNegative = {
    injectedPixelMutation: true,
    ...layerNegativeComparison,
    comparatorPassed: layerNegativeComparison.differingPixels === 0,
  };
  const boundaryBefore = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    frameMidpointUs(884),
    layerSources,
    output,
  );
  const boundaryAt = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    29_500_000,
    layerSources,
    output,
  );
  const bareTimeline = buildResolvedTimelinePlan(
    layersEdit.cuts as FrameEngineCut[],
    { fps: FPS },
  );
  const bareBefore = evaluationPlanFromResolvedTimeline(
    bareTimeline,
    frameMidpointUs(884),
    layerSources,
    output,
  );
  const bareAt = evaluationPlanFromResolvedTimeline(
    bareTimeline,
    29_500_000,
    layerSources,
    output,
  );
  const renderRgba = async (plan: EvaluationPlan) => {
    const frame = await evaluateFrame(plan, context);
    try {
      return await frame.surface.readRgba();
    } finally {
      frame.close();
    }
  };
  const matteSamplePoints = [
    ['matte-start', frameMidpointUs(0)],
    ['matte-middle', frameMidpointUs(120)],
    ['matte-late', frameMidpointUs(235)],
  ] as const;
  const matteGlErrorsBefore = compositor.stats.glErrors;
  const matteParity: Array<Record<string, unknown>> = [];
  let matteNegativeSeed: { preview: Uint8Array; exported: Uint8Array } | null = null;
  for (const [label, timeUs] of matteSamplePoints) {
    const plan = evaluationPlanFromResolvedTimeline(
      matteTimeline,
      timeUs,
      matteSources,
      output,
    );
    const frame = await evaluateFrame(plan, context);
    presentFrame(frame, previewCanvas);
    const previewRgba = capturePresentedRgba(previewCanvas);
    const sink = new BufferedRawFrameSink();
    await readbackFrame(frame, sink);
    const exportRgba = sink.frames[0]?.rgba;
    if (!exportRgba) throw new Error(`matte export sink produced no frame at ${timeUs}us`);
    const previewPng = await rgbaToPng(previewRgba);
    const exportPng = await rgbaToPng(exportRgba);
    const previewSha256 = await sha256(previewPng);
    const exportSha256 = await sha256(exportPng);
    const comparison = compareRgba(previewRgba, exportRgba);
    const pass = comparison.differingPixels === 0
      && comparison.maxDelta === 0
      && previewSha256 === exportSha256;
    matteParity.push({ label, timeUs, ...comparison, previewSha256, exportSha256, pass });
    await window.goldenHarness.writeArtifact(`matte-${label}-preview.png`, previewPng);
    await window.goldenHarness.writeArtifact(`matte-${label}-export.png`, exportPng);
    matteNegativeSeed ??= { preview: previewRgba, exported: exportRgba };
    frame.close();
  }

  if (!matteNegativeSeed) throw new Error('matte negative test has no source frame');
  const matteMutated = matteNegativeSeed.exported.slice();
  matteMutated[8] = matteMutated[8] === 255 ? 254 : matteMutated[8]! + 1;
  const matteNegativeComparison = compareRgba(matteNegativeSeed.preview, matteMutated);
  const matteNegative = {
    injectedPixelMutation: true,
    ...matteNegativeComparison,
    comparatorPassed: matteNegativeComparison.differingPixels === 0,
  };
  await window.goldenHarness.writeArtifact(
    'matte-negative-preview.png',
    await rgbaToPng(matteNegativeSeed.preview),
  );
  await window.goldenHarness.writeArtifact(
    'matte-negative-export-mutated.png',
    await rgbaToPng(matteMutated),
  );

  const unmaskedEdit = structuredClone(matteEdit);
  delete (unmaskedEdit.layers[0] as { mask?: string }).mask;
  unmaskedEdit.layers[0]!.kind = 'video';
  const unmaskedTimeline = buildResolvedTimelinePlan(
    unmaskedEdit.cuts as FrameEngineCut[],
    { fps: FPS, layers: unmaskedEdit.layers as FrameEngineLayer[] },
  );
  const baseOnlyTimeline = buildResolvedTimelinePlan(
    matteEdit.cuts as FrameEngineCut[],
    { fps: FPS },
  );
  const semanticTimeUs = frameMidpointUs(0);
  const maskedSemanticRgba = await renderRgba(evaluationPlanFromResolvedTimeline(
    matteTimeline, semanticTimeUs, matteSources, output,
  ));
  const unmaskedSemanticRgba = await renderRgba(evaluationPlanFromResolvedTimeline(
    unmaskedTimeline, semanticTimeUs, matteSources, output,
  ));
  const baseSemanticRgba = await renderRgba(evaluationPlanFromResolvedTimeline(
    baseOnlyTimeline, semanticTimeUs, matteSources, output,
  ));
  const pixelDelta = (left: Uint8Array, right: Uint8Array, offset: number) =>
    Math.max(
      Math.abs(left[offset]! - right[offset]!),
      Math.abs(left[offset + 1]! - right[offset + 1]!),
      Math.abs(left[offset + 2]! - right[offset + 2]!),
    );
  let transparentBackdropPixels = 0;
  let opaqueLayerPixels = 0;
  for (let offset = 0; offset < maskedSemanticRgba.length; offset += 4) {
    const unmaskedFromBase = pixelDelta(unmaskedSemanticRgba, baseSemanticRgba, offset);
    const maskedFromBase = pixelDelta(maskedSemanticRgba, baseSemanticRgba, offset);
    const maskedFromUnmasked = pixelDelta(maskedSemanticRgba, unmaskedSemanticRgba, offset);
    if (maskedFromBase <= 1 && unmaskedFromBase > 8) transparentBackdropPixels += 1;
    if (maskedFromUnmasked <= 2 && maskedFromBase > 8) opaqueLayerPixels += 1;
  }
  const maskEffect = compareRgba(maskedSemanticRgba, unmaskedSemanticRgba);
  const matteSemantic = {
    pass: transparentBackdropPixels > 100 && opaqueLayerPixels > 100 && maskEffect.differingPixels > 0,
    transparentBackdropPixels,
    opaqueLayerPixels,
    withoutMaskDifferingPixels: maskEffect.differingPixels,
  };

  let mismatches = 0;
  let maxDeltaUs = 0;
  let maxFrameLag = 0;
  let laggedFrames = 0;
  for (let frameNumber = 0; frameNumber < 300; frameNumber += 1) {
    const requestedUs = frameMidpointUs(frameNumber);
    const plan = evaluationPlanFromResolvedTimeline(matteTimeline, requestedUs, matteSources, output);
    const frame = await evaluateFrame(plan, context);
    const pairs = frame.maskSync ?? [];
    if (pairs.length !== 1) mismatches += 1;
    let frameLagged = pairs.length !== 1;
    for (const pair of pairs) {
      const delta = Math.abs(pair.colorTimestamp - pair.maskTimestamp);
      // VideoFrame timestamps are integer microseconds; round cancels their sub-microsecond PTS truncation.
      const actualColorFrame = Math.round(pair.colorTimestamp * FPS / 1e6);
      const actualMaskFrame = Math.round(pair.maskTimestamp * FPS / 1e6);
      const colorLag = actualColorFrame - frameNumber;
      const maskLag = actualMaskFrame - frameNumber;
      maxDeltaUs = Math.max(maxDeltaUs, delta);
      maxFrameLag = Math.max(maxFrameLag, Math.abs(colorLag), Math.abs(maskLag));
      if (colorLag !== 0 || maskLag !== 0) frameLagged = true;
      if (delta !== 0 || pair.requestedUs !== plan.layers[0]?.sourceTimeUs) mismatches += 1;
    }
    if (frameLagged) laggedFrames += 1;
    frame.close();
  }
  const matteSync = { frames: 300, mismatches, maxDeltaUs, maxFrameLag, laggedFrames };
  const codecSources = [MATTE_COLOR_URL, MATTE_MASK_URL, MATTE_ALPHA_URL].map(src => ({
    src,
    codec: window.goldenHarness.fixtureCodecs[src] ?? 'unknown',
    decodes: matteDecodeCounts.get(src) ?? 0,
  }));
  const matteStats = {
    sources: codecSources,
    vp9Decodes: codecSources
      .filter(source => source.codec === 'vp9' || source.codec === 'vp8')
      .reduce((sum, source) => sum + source.decodes, 0),
    h264Decodes: codecSources
      .filter(source => source.codec === 'h264')
      .reduce((sum, source) => sum + source.decodes, 0),
    glErrors: compositor.stats.glErrors - matteGlErrorsBefore,
  };
  const boundaryBeforeRgba = await renderRgba(boundaryBefore);
  const boundaryAtRgba = await renderRgba(boundaryAt);
  const bareBeforeRgba = await renderRgba(bareBefore);
  const bareAtRgba = await renderRgba(bareAt);
  const boundaryChanged = compareRgba(boundaryBeforeRgba, boundaryAtRgba);
  const boundaryLayerPresent = compareRgba(boundaryBeforeRgba, bareBeforeRgba);
  const boundaryBare = compareRgba(boundaryAtRgba, bareAtRgba);
  const animatedPlan = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    7_000_000,
    layerSources,
    output,
  );
  const screenPlan = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    15_500_000,
    layerSources,
    output,
  );
  const multiplyPlan = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    18_500_000,
    layerSources,
    output,
  );
  const layerSemantic = {
    pass:
      boundaryBefore.layers.length === 3 &&
      boundaryAt.layers.length === 0 &&
      boundaryChanged.differingPixels > 0 &&
      boundaryLayerPresent.differingPixels > 0 &&
      boundaryBare.differingPixels === 0 &&
      animatedPlan.layers.length === 1 &&
      Math.abs(animatedPlan.layers[0]!.visual.transform.x - -2) < 1e-9 &&
      screenPlan.layers[0]!.blend === 'screen' &&
      multiplyPlan.layers[0]!.blend === 'multiply',
    boundaryBeforeCount: boundaryBefore.layers.length,
    boundaryAtCount: boundaryAt.layers.length,
    boundaryChangedPixels: boundaryChanged.differingPixels,
    boundaryLayerPresentPixels: boundaryLayerPresent.differingPixels,
    boundaryBareDifferingPixels: boundaryBare.differingPixels,
    animatedVisual: animatedPlan.layers[0]?.visual,
  };

  const recreationCanvas = document.createElement('canvas');
  const recreationPlan = evaluationPlanFromResolvedTimeline(
    layerTimeline,
    24_500_000,
    layerSources,
    output,
  );
  const firstCompositor = new WebGL2Compositor(recreationCanvas, { uploadPath: REQUESTED_UPLOAD_PATH });
  const firstFrame = await evaluateFrame(recreationPlan, {
    compositor: firstCompositor,
    metrics,
  });
  const firstRgba = await firstFrame.surface.readRgba();
  firstFrame.close();
  firstCompositor.dispose();
  const secondCompositor = new WebGL2Compositor(recreationCanvas, { uploadPath: REQUESTED_UPLOAD_PATH });
  const secondFrame = await evaluateFrame(recreationPlan, {
    compositor: secondCompositor,
    metrics,
  });
  const secondRgba = await secondFrame.surface.readRgba();
  secondFrame.close();
  secondCompositor.dispose();
  const recreationComparison = compareRgba(firstRgba, secondRgba);
  const layerStats = {
    imageUploads: compositor.stats.imageUploads,
    glErrors: compositor.stats.glErrors,
    disposeRecreateDifferingPixels: recreationComparison.differingPixels,
    pass:
      compositor.stats.imageUploads === 1 &&
      compositor.stats.glErrors === 0 &&
      recreationComparison.differingPixels === 0,
  };

  for (const [label, timeUs] of SAMPLE_POINTS) {
    const plan = evaluationPlanFromResolvedTimeline(
      timeline,
      timeUs,
      sources,
      output,
    );
    const frame = await evaluateFrame(plan, context);
    for (const format of frame.nativeFormats) nativeFormats.add(format);
    presentFrame(frame, previewCanvas);
    const previewRgba = capturePresentedRgba(previewCanvas);
    const sink = new BufferedRawFrameSink();
    await readbackFrame(frame, sink);
    const exportRgba = sink.frames[0]?.rgba;
    if (!exportRgba)
      throw new Error(`export sink produced no frame at ${timeUs}us`);
    const previewPng = await rgbaToPng(previewRgba);
    const exportPng = await rgbaToPng(exportRgba);
    const previewSha256 = await sha256(previewPng);
    const exportSha256 = await sha256(exportPng);
    const comparison = compareRgba(previewRgba, exportRgba);
    const stem = `parity-${String(parity.length + 1).padStart(2, '0')}-${label}`;
    await window.goldenHarness.writeArtifact(`${stem}-preview.png`, previewPng);
    await window.goldenHarness.writeArtifact(`${stem}-export.png`, exportPng);
    const pass =
      comparison.differingPixels === 0 &&
      comparison.maxDelta === 0 &&
      previewSha256 === exportSha256;
    parity.push({
      label,
      timeUs,
      ...comparison,
      previewSha256,
      exportSha256,
      pass,
    });
    renderedByLabel.set(label, exportRgba);
    negativeSeed ??= { preview: previewRgba, exported: exportRgba };
    frame.close();
  }

  if (!negativeSeed) throw new Error('negative test has no source frame');
  const mutated = negativeSeed.exported.slice();
  mutated[0] = mutated[0] === 255 ? 254 : mutated[0]! + 1;
  const negativeComparison = compareRgba(negativeSeed.preview, mutated);
  const negativePreviewPng = await rgbaToPng(negativeSeed.preview);
  const negativeExportPng = await rgbaToPng(mutated);
  const negativePreviewSha = await sha256(negativePreviewPng);
  const negativeExportSha = await sha256(negativeExportPng);
  await window.goldenHarness.writeArtifact(
    'negative-preview.png',
    negativePreviewPng,
  );
  await window.goldenHarness.writeArtifact(
    'negative-export-mutated.png',
    negativeExportPng,
  );
  const negative = {
    injectedPixelMutation: true,
    ...negativeComparison,
    previewSha256: negativePreviewSha,
    exportSha256: negativeExportSha,
    comparatorPassed:
      negativeComparison.differingPixels === 0 &&
      negativePreviewSha === negativeExportSha,
  };

  const totalFrames = Math.round(timeline.totalDuration * FPS);
  await window.goldenHarness.startEncoder({
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
  });
  for (let index = 0; index < totalFrames; index += 1) {
    const timeUs = Math.round(((index + 0.5) / FPS) * 1e6);
    const plan = evaluationPlanFromResolvedTimeline(
      timeline,
      timeUs,
      sources,
      output,
    );
    const frame = await evaluateFrame(plan, context);
    await readbackFrame(frame, {
      async write(rgba) {
        await window.goldenHarness.writeEncoderFrame(rgba);
      },
    });
    frame.close();
  }
  const encoded = await window.goldenHarness.finishEncoder();
  const colorPatches = await inspectColorPatches(output);
  const texturedCrossPathDiff = await inspectTexturedCrossPath(
    output,
    timeline,
    layerTimeline,
  );
  const frameLifetime = await inspectFrameLifetime(output);
  const transitionGlErrorsBefore = compositor.stats.glErrors;
  const transitionParity = await inspectTransitionParity(
    output, session, context, previewCanvas,
  );
  const transitionSemantics = await inspectTransitionSemantics(
    output, compositor, metrics,
  );
  const transitionStats = {
    glErrors: compositor.stats.glErrors - transitionGlErrorsBefore,
  };
  const lookGlErrorsBefore = compositor.stats.glErrors;
  const lookParity = await inspectLookParity(
    output, session, context, previewCanvas,
  );
  const lookStats = {
    glErrors: compositor.stats.glErrors - lookGlErrorsBefore,
  };
  const gopTail = await inspectGopTailGolden({
    baseUrl: SOURCE_URL,
    layerUrl: SOURCE_B_URL,
    matteColorUrl: MATTE_COLOR_URL,
    matteMaskUrl: MATTE_MASK_URL,
    output,
  });
  const metricJson = metrics.toJSON();
  const semanticPlans = Object.fromEntries(
    SAMPLE_POINTS.map(([label, timeUs]) => {
      const plan = evaluationPlanFromResolvedTimeline(
        timeline,
        timeUs,
        sources,
        output,
      );
      return [
        label,
        {
          sourceTimesUs: plan.base.map((layer) => layer.sourceTimeUs),
          transition: plan.transition,
          visuals: plan.base.map((layer) => layer.visual),
        },
      ];
    }),
  ) as Record<
    string,
    {
      sourceTimesUs: number[];
      transition: ResolvedTransition | undefined;
      visuals: ResolvedCutVisual[];
    }
  >;
  const transitionMeasurements = Object.fromEntries(
    [
      'dissolve-mid',
      'fade-black-mid',
      'fade-white-mid',
      'reveal-down-mid',
      'reveal-up-mid',
    ].map((label) => {
      const rgba = renderedByLabel.get(label)!;
      return [
        label,
        {
          meanRgb: meanRgb(rgba),
          topMeanRgb: meanRgb(rgba, 0, HEIGHT / 2),
          bottomMeanRgb: meanRgb(rgba, HEIGHT / 2),
          halfDistance: colorDistance(
            meanRgb(rgba, 0, HEIGHT / 2),
            meanRgb(rgba, HEIGHT / 2),
          ),
        },
      ];
    }),
  ) as Record<
    string,
    {
      meanRgb: [number, number, number];
      topMeanRgb: [number, number, number];
      bottomMeanRgb: [number, number, number];
      halfDistance: number;
    }
  >;
  await window.goldenHarness.writeArtifact(
    'metrics.json',
    new TextEncoder().encode(`${JSON.stringify(metricJson, null, 2)}\n`),
  );

  const requiredMetricStages: FrameMetricStage[] = [
    'decode',
    'tick',
    'upload',
    'shader',
    'shaderGpu',
    'readback',
    'pboWait',
    'rowFlip',
    'sink',
    ...(REQUESTED_UPLOAD_PATH === 'copyTo'
      ? ['copy', 'copyTo', 'planeCompact'] as FrameMetricStage[]
      : []),
  ];
  const planNamed = (label: string) => {
    const value = semanticPlans[label];
    if (!value || !value.visuals[0])
      throw new Error(`missing semantic plan ${label}`);
    return value;
  };
  const measurementNamed = (label: string) => {
    const value = transitionMeasurements[label];
    if (!value) throw new Error(`missing transition measurement ${label}`);
    return value;
  };
  const hashNamed = (label: string) => {
    const value = parity.find((sample) => sample.label === label)?.exportSha256;
    if (typeof value !== 'string')
      throw new Error(`missing parity hash ${label}`);
    return value;
  };
  const semanticPass =
    planNamed('speed-start').sourceTimesUs[0] === 1_500_000 &&
    planNamed('framing-static').visuals[0]!.framing.width === 0.6 &&
    Math.abs(planNamed('zoom-mid').visuals[0]!.framing.scale - 1.5) < 1e-9 &&
    planNamed('transform').visuals[0]!.transform.rotateDegrees === 12 &&
    planNamed('freeze-inside-a').sourceTimesUs[0] === 400_000 &&
    planNamed('freeze-inside-b').sourceTimesUs[0] === 400_000 &&
    hashNamed('freeze-inside-a') === hashNamed('freeze-inside-b') &&
    planNamed('freeze-after').sourceTimesUs[0] === 700_000 &&
    ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up'].every(
      (type) =>
        planNamed(`${type}-mid`).transition?.type === type &&
        Math.abs((planNamed(`${type}-mid`).transition?.progress ?? -1) - 0.5) <
          1e-9,
    ) &&
    measurementNamed('fade-black-mid').meanRgb.every((value) => value < 3) &&
    measurementNamed('fade-white-mid').meanRgb.every((value) => value > 252) &&
    colorDistance(
      measurementNamed('dissolve-mid').meanRgb,
      meanRgb(renderedByLabel.get('dissolve-before')!),
    ) > 1 &&
    colorDistance(
      measurementNamed('dissolve-mid').meanRgb,
      meanRgb(renderedByLabel.get('dissolve-after')!),
    ) > 1 &&
    transitionSemantics.pass;
  const pass =
    parity.length === SAMPLE_POINTS.length &&
    parity.every((sample) => sample.pass === true) &&
    negative.comparatorPassed === false &&
    negative.differingPixels === 1 &&
    encoded.frames === totalFrames &&
    Math.abs(encoded.durationSeconds - timeline.totalDuration) <= 1 / FPS &&
    encoded.distinctExtractedHashes === 3 &&
    requiredMetricStages.every(
      (stage) =>
        metricJson[stage].count > 0 &&
        metricJson[stage].p50Ms != null &&
        metricJson[stage].p95Ms != null,
    ) &&
    semanticPass &&
    layerParity.length === layerSamplePoints.length &&
    layerParity.every((sample) => sample.pass === true) &&
    layerNegative.comparatorPassed === false &&
    layerNegative.differingPixels === 1 &&
    layerSemantic.pass &&
    layerStats.pass &&
    matteParity.length === matteSamplePoints.length &&
    matteParity.every((sample) => sample.pass === true) &&
    matteNegative.comparatorPassed === false &&
    matteNegative.differingPixels === 1 &&
    matteSemantic.pass &&
    matteSync.frames === 300 &&
    matteSync.mismatches === 0 &&
    matteSync.maxDeltaUs === 0 &&
    matteSync.maxFrameLag === 0 &&
    matteSync.laggedFrames === 0 &&
    matteStats.vp9Decodes === 0 &&
    matteStats.h264Decodes > 0 &&
    matteStats.glErrors === 0 &&
    colorPatches.pass &&
    frameLifetime.pass &&
    transitionParity.pass &&
    transitionSemantics.pass &&
    transitionStats.glErrors === 0 &&
    lookParity.pass &&
    lookStats.glErrors === 0 &&
    gopTail.pass &&
    compositor.uploadPath === REQUESTED_UPLOAD_PATH;

  session.destroy();
  layerSession.destroy();
  matteColorSession.destroy();
  matteMaskSession.destroy();
  stillSource.destroy();
  compositor.dispose();
  await window.goldenHarness.complete({
    pass,
    uploadPath: {
      requested: REQUESTED_UPLOAD_PATH,
      effective: compositor.uploadPath,
      fallbackReason: compositor.stats.directUploadFallbackReason,
      frameDimensions: compositor.stats.directUploadFrameDimensions,
    },
    fixture: {
      cuts: edit.cuts.length,
      durationSeconds: timeline.totalDuration,
      samplePoints: SAMPLE_POINTS,
    },
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoDecoder !== 'undefined',
      webgl2: true,
      nativeFormats: [...nativeFormats],
    },
    parity,
    layerParity,
    matteParity,
    negative,
    layerNegative,
    matteNegative,
    encoded,
    semantic: {
      pass: semanticPass,
      plans: semanticPlans,
      transitionMeasurements,
    },
    layerSemantic,
    layerStats,
    matteSemantic,
    matteSync,
    matteStats,
    colorPatches,
    texturedCrossPathDiff,
    frameLifetime,
    transitionParity: transitionParity.rows,
    transitionNegative: transitionParity.negative,
    transitionSemantics,
    transitionStats,
    lookParity: lookParity.rows,
    lookIntensity: lookParity.intensityRows,
    lookStats,
    gopTail,
    metrics: metricJson,
    warnings,
  });
}

void run().catch(async (error) => {
  const message =
    error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  console.error(message);
  await window.goldenHarness.fail(message);
});
