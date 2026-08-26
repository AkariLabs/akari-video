import { buildTimelineMap } from '@akari-video/edit-store';
import type { EditCut } from '@akari-video/edit-store';
import {
  BufferedRawFrameSink,
  ClipSession,
  FrameMetrics,
  WebGL2Compositor,
  capturePresentedRgba,
  compareRgba,
  evaluateFrame,
  evaluationPlanFromTimelineMap,
  presentFrame,
  readbackFrame
} from '../../src/index.js';
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
const SAMPLE_TIMES_US = [200_000, 900_000, 1_100_000, 1_900_000, 2_100_000, 2_800_000];

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
  const session = new ClipSession('fixture', SOURCE_URL, { onWarning: warning => warnings.push(warning) });
  const compositor = new WebGL2Compositor();
  const context = { compositor, metrics };
  const timeline = buildTimelineMap(edit.cuts as EditCut[], { fps: FPS });
  const sources = new Map([[SOURCE_URL, session]]);
  const output = { width: WIDTH, height: HEIGHT, colorSpace: 'bt709-limited' as const };
  const previewCanvas = document.querySelector<HTMLCanvasElement>('#preview');
  if (!previewCanvas) throw new Error('preview canvas missing');
  const parity: Array<Record<string, unknown>> = [];
  let negativeSeed: { preview: Uint8Array; exported: Uint8Array } | null = null;
  const nativeFormats = new Set<string>();

  for (const timeUs of SAMPLE_TIMES_US) {
    const plan = evaluationPlanFromTimelineMap(timeline, timeUs, sources, output);
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
    const stem = `parity-${String(parity.length + 1).padStart(2, '0')}-${timeUs}us`;
    await window.goldenHarness.writeArtifact(`${stem}-preview.png`, previewPng);
    await window.goldenHarness.writeArtifact(`${stem}-export.png`, exportPng);
    const pass = comparison.differingPixels === 0 && comparison.maxDelta === 0 && previewSha256 === exportSha256;
    parity.push({ timeUs, ...comparison, previewSha256, exportSha256, pass });
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

  await window.goldenHarness.startEncoder({ width: WIDTH, height: HEIGHT, fps: FPS });
  for (let index = 0; index < 90; index += 1) {
    const timeUs = Math.round(((index + 0.5) / FPS) * 1e6);
    const plan = evaluationPlanFromTimelineMap(timeline, timeUs, sources, output);
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
  await window.goldenHarness.writeArtifact(
    'metrics.json',
    new TextEncoder().encode(`${JSON.stringify(metricJson, null, 2)}\n`)
  );

  const pass = parity.length === SAMPLE_TIMES_US.length
    && parity.every(sample => sample.pass === true)
    && negative.comparatorPassed === false
    && negative.differingPixels === 1
    && encoded.frames === 90
    && encoded.distinctExtractedHashes === 3
    && Object.values(metricJson).every(summary => summary.count > 0 && summary.p50Ms != null && summary.p95Ms != null);

  session.destroy();
  compositor.dispose();
  await window.goldenHarness.complete({
    pass,
    fixture: { cuts: edit.cuts.length, durationSeconds: timeline.totalDuration, sampleTimesUs: SAMPLE_TIMES_US },
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoDecoder !== 'undefined',
      webgl2: true,
      nativeFormats: [...nativeFormats]
    },
    parity,
    negative,
    encoded,
    metrics: metricJson,
    warnings
  });
}

void run().catch(async error => {
  const message = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
  console.error(message);
  await window.goldenHarness.fail(message);
});
