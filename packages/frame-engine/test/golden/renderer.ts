import {
  BufferedRawFrameSink,
  buildResolvedTimelinePlan,
  ClipSessionPool,
  FrameMetrics,
  WebGL2Compositor,
  capturePresentedRgba,
  compareRgba,
  evaluateFrame,
  evaluationPlanFromResolvedTimeline,
  presentFrame,
  readbackFrame
} from '../../src/index.js';
import type { FrameEngineCut, FrameMetricStage, ResolvedCutVisual, ResolvedTransition } from '../../src/index.js';
import edit from './edit.json';

interface GoldenBridge {
  fixtureUrl: string;
  writeArtifact(name: string, bytes: Uint8Array): Promise<boolean>;
  startEncoder(options: { width: number; height: number; fps: number }): Promise<string>;
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
  interface Window { goldenHarness: GoldenBridge; }
}

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 30;
const SOURCE_URL = window.goldenHarness.fixtureUrl;
const SAMPLE_POINTS = [
  ['hard-cut-before', 900_000], ['hard-cut-after', 1_100_000],
  ['speed-start', 1_250_000], ['speed-end', 1_750_000],
  ['framing-static', 2_500_000],
  ['zoom-start', 3_050_000], ['zoom-mid', 3_500_000], ['zoom-end', 3_950_000],
  ['transform', 4_500_000],
  ['freeze-before', 5_200_000], ['freeze-inside-a', 5_450_000], ['freeze-inside-b', 5_750_000], ['freeze-after', 6_200_000],
  ['dissolve-before', 7_160_000], ['dissolve-mid', 7_350_000], ['dissolve-after', 7_540_000],
  ['fade-black-before', 7_860_000], ['fade-black-mid', 8_050_000], ['fade-black-after', 8_240_000],
  ['fade-white-before', 8_560_000], ['fade-white-mid', 8_750_000], ['fade-white-after', 8_940_000],
  ['reveal-down-before', 9_260_000], ['reveal-down-mid', 9_450_000], ['reveal-down-after', 9_640_000],
  ['reveal-up-before', 9_960_000], ['reveal-up-mid', 10_150_000], ['reveal-up-after', 10_340_000]
] as const;

function meanRgb(rgba: Uint8Array, startRow = 0, endRow = HEIGHT): [number, number, number] {
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
  return totals.map(value => value / pixels) as [number, number, number];
}

function colorDistance(left: readonly number[], right: readonly number[]): number {
  return Math.sqrt(left.reduce((sum, value, index) => sum + (value - right[index]!) ** 2, 0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function rgbaToPng(rgba: Uint8Array): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG canvas unavailable');
  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), WIDTH, HEIGHT), 0, 0);
  const blob = await new Promise<Blob>((resolveBlob, reject) => {
    canvas.toBlob(value => value ? resolveBlob(value) : reject(new Error('PNG encoding returned null')), 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function run(): Promise<void> {
  const metrics = new FrameMetrics();
  const warnings: string[] = [];
  const session = new ClipSessionPool('fixture', SOURCE_URL, { onWarning: warning => warnings.push(warning) });
  const compositor = new WebGL2Compositor();
  const context = { compositor, metrics };
  const timeline = buildResolvedTimelinePlan(edit.cuts as FrameEngineCut[], { fps: FPS });
  const sources = new Map([[SOURCE_URL, session]]);
  const output = { width: WIDTH, height: HEIGHT, colorSpace: 'bt709-limited' as const };
  const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview');
  if (!previewCanvas) throw new Error('preview canvas missing');
  const parity: Array<Record<string, unknown>> = [];
  let negativeSeed: { preview: Uint8Array; exported: Uint8Array } | null = null;
  const nativeFormats = new Set<string>();
  const renderedByLabel = new Map<string, Uint8Array>();

  for (const [label, timeUs] of SAMPLE_POINTS) {
    const plan = evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, output);
    const frame = await evaluateFrame(plan, context);
    for (const format of frame.nativeFormats) nativeFormats.add(format);
    presentFrame(frame, previewCanvas);
    const previewRgba = capturePresentedRgba(previewCanvas);
    const sink = new BufferedRawFrameSink();
    await readbackFrame(frame, sink);
    const exportRgba = sink.frames[0]?.rgba;
    if (!exportRgba) throw new Error(`export sink produced no frame at ${timeUs}us`);
    const previewPng = await rgbaToPng(previewRgba);
    const exportPng = await rgbaToPng(exportRgba);
    const previewSha256 = await sha256(previewPng);
    const exportSha256 = await sha256(exportPng);
    const comparison = compareRgba(previewRgba, exportRgba);
    const stem = `parity-${String(parity.length + 1).padStart(2, '0')}-${label}`;
    await window.goldenHarness.writeArtifact(`${stem}-preview.png`, previewPng);
    await window.goldenHarness.writeArtifact(`${stem}-export.png`, exportPng);
    const pass = comparison.differingPixels === 0 && comparison.maxDelta === 0 && previewSha256 === exportSha256;
    parity.push({ label, timeUs, ...comparison, previewSha256, exportSha256, pass });
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
  await window.goldenHarness.writeArtifact('negative-preview.png', negativePreviewPng);
  await window.goldenHarness.writeArtifact('negative-export-mutated.png', negativeExportPng);
  const negative = {
    injectedPixelMutation: true,
    ...negativeComparison,
    previewSha256: negativePreviewSha,
    exportSha256: negativeExportSha,
    comparatorPassed: negativeComparison.differingPixels === 0 && negativePreviewSha === negativeExportSha
  };

  const totalFrames = Math.round(timeline.totalDuration * FPS);
  await window.goldenHarness.startEncoder({ width: WIDTH, height: HEIGHT, fps: FPS });
  for (let index = 0; index < totalFrames; index += 1) {
    const timeUs = Math.round(((index + 0.5) / FPS) * 1e6);
    const plan = evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, output);
    const frame = await evaluateFrame(plan, context);
    await readbackFrame(frame, {
      async write(rgba) {
        await window.goldenHarness.writeEncoderFrame(rgba);
      }
    });
    frame.close();
  }
  const encoded = await window.goldenHarness.finishEncoder();
  const metricJson = metrics.toJSON();
  const semanticPlans = Object.fromEntries(SAMPLE_POINTS.map(([label, timeUs]) => {
    const plan = evaluationPlanFromResolvedTimeline(timeline, timeUs, sources, output);
    return [label, {
      sourceTimesUs: plan.layers.map(layer => layer.sourceTimeUs),
      transition: plan.transition,
      visuals: plan.layers.map(layer => layer.visual)
    }];
  })) as Record<string, {
    sourceTimesUs: number[];
    transition: ResolvedTransition | undefined;
    visuals: ResolvedCutVisual[];
  }>;
  const transitionMeasurements = Object.fromEntries([
    'dissolve-mid', 'fade-black-mid', 'fade-white-mid', 'reveal-down-mid', 'reveal-up-mid'
  ].map(label => {
    const rgba = renderedByLabel.get(label)!;
    return [label, {
      meanRgb: meanRgb(rgba),
      topMeanRgb: meanRgb(rgba, 0, HEIGHT / 2),
      bottomMeanRgb: meanRgb(rgba, HEIGHT / 2),
      halfDistance: colorDistance(meanRgb(rgba, 0, HEIGHT / 2), meanRgb(rgba, HEIGHT / 2))
    }];
  })) as Record<string, {
    meanRgb: [number, number, number];
    topMeanRgb: [number, number, number];
    bottomMeanRgb: [number, number, number];
    halfDistance: number;
  }>;
  await window.goldenHarness.writeArtifact(
    'metrics.json',
    new TextEncoder().encode(`${JSON.stringify(metricJson, null, 2)}\n`)
  );

  const requiredMetricStages: FrameMetricStage[] = [
    'decode', 'tick', 'copy', 'copyTo', 'planeCompact', 'upload', 'shader', 'shaderGpu',
    'readback', 'pboWait', 'rowFlip', 'sink'
  ];
  const planNamed = (label: string) => {
    const value = semanticPlans[label];
    if (!value || !value.visuals[0]) throw new Error(`missing semantic plan ${label}`);
    return value;
  };
  const measurementNamed = (label: string) => {
    const value = transitionMeasurements[label];
    if (!value) throw new Error(`missing transition measurement ${label}`);
    return value;
  };
  const hashNamed = (label: string) => {
    const value = parity.find(sample => sample.label === label)?.exportSha256;
    if (typeof value !== 'string') throw new Error(`missing parity hash ${label}`);
    return value;
  };
  const semanticPass = planNamed('speed-start').sourceTimesUs[0] === 1_500_000
    && planNamed('framing-static').visuals[0]!.framing.width === 0.6
    && Math.abs(planNamed('zoom-mid').visuals[0]!.framing.scale - 1.5) < 1e-9
    && planNamed('transform').visuals[0]!.transform.rotateDegrees === 12
    && planNamed('freeze-inside-a').sourceTimesUs[0] === 400_000
    && planNamed('freeze-inside-b').sourceTimesUs[0] === 400_000
    && hashNamed('freeze-inside-a') === hashNamed('freeze-inside-b')
    && planNamed('freeze-after').sourceTimesUs[0] === 700_000
    && ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up']
      .every(type => planNamed(`${type}-mid`).transition?.type === type
        && Math.abs((planNamed(`${type}-mid`).transition?.progress ?? -1) - 0.5) < 1e-9)
    && measurementNamed('fade-black-mid').meanRgb.every(value => value < 3)
    && measurementNamed('fade-white-mid').meanRgb.every(value => value > 252)
    && colorDistance(measurementNamed('dissolve-mid').meanRgb, meanRgb(renderedByLabel.get('dissolve-before')!)) > 1
    && colorDistance(measurementNamed('dissolve-mid').meanRgb, meanRgb(renderedByLabel.get('dissolve-after')!)) > 1
    && measurementNamed('reveal-down-mid').halfDistance > 5
    && measurementNamed('reveal-up-mid').halfDistance > 5;
  const pass = parity.length === SAMPLE_POINTS.length
    && parity.every(sample => sample.pass === true)
    && negative.comparatorPassed === false
    && negative.differingPixels === 1
    && encoded.frames === totalFrames
    && Math.abs(encoded.durationSeconds - timeline.totalDuration) <= 1 / FPS
    && encoded.distinctExtractedHashes === 3
    && requiredMetricStages.every(stage => metricJson[stage].count > 0
      && metricJson[stage].p50Ms != null && metricJson[stage].p95Ms != null)
    && semanticPass;

  session.destroy();
  compositor.dispose();
  await window.goldenHarness.complete({
    pass,
    fixture: { cuts: edit.cuts.length, durationSeconds: timeline.totalDuration, samplePoints: SAMPLE_POINTS },
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoDecoder !== 'undefined',
      webgl2: true,
      nativeFormats: [...nativeFormats]
    },
    parity,
    negative,
    encoded,
    semantic: { pass: semanticPass, plans: semanticPlans, transitionMeasurements },
    metrics: metricJson,
    warnings
  });
}

void run().catch(async error => {
  const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  console.error(message);
  await window.goldenHarness.fail(message);
});
