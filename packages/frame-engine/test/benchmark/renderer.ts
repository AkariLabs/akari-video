import {
  buildResolvedTimelinePlan,
  ClipSession,
  ClipSessionPool,
  evaluateFrame,
  evaluationPlanFromResolvedTimeline,
  FrameMetrics,
  LookaheadCache,
  readbackFrame,
  WebCodecsH264Encoder,
  WebGL2Compositor
} from '../../src/index.js';
import type { FrameEngineCut, NativeFrameSource } from '../../src/index.js';
import edit from './edit.json';

interface EncoderResult {
  path: string;
  frames: number;
  totalMs: number;
  durationSeconds: number;
  ipcWrite: MetricSummary;
  ffmpegDrain: MetricSummary;
  ffmpegClose: MetricSummary;
}
interface MetricSummary { count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null; }
interface FrameBenchBridge {
  fixtureUrl: string;
  startRawEncoder(options: { width: number; height: number; fps: number }): Promise<string>;
  writeRawFrame(bytes: Uint8Array): Promise<number>;
  finishRawEncoder(): Promise<EncoderResult>;
  startH264Mux(options: { width: number; height: number; fps: number }): Promise<string>;
  writeH264Chunk(bytes: Uint8Array): Promise<number>;
  finishH264Mux(): Promise<EncoderResult>;
  invokeRoundTrip(bytes: Uint8Array): Promise<number>;
  portRoundTrip(bytes: Uint8Array, shared: boolean): Promise<{ id: number; length: number }>;
  runRenderCut(): Promise<{ elapsedMs: number; path: string; durationSeconds: number; inputSha256: string; sameInputBytes: boolean }>;
  psnr(): Promise<{ averageDb: number | null; status: number }>;
  complete(result: unknown): Promise<boolean>;
  fail(message: string): Promise<boolean>;
}
declare global { interface Window { frameBench: FrameBenchBridge; } }

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 13;
const FRAME_COUNT = DURATION * FPS;
const SOURCE_URL = window.frameBench.fixtureUrl;
const output = { width: WIDTH, height: HEIGHT, colorSpace: 'bt709-limited' as const };
const timeline = buildResolvedTimelinePlan(edit.cuts as FrameEngineCut[], { fps: FPS });

function percentile(values: readonly number[], percent: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent / 100) - 1)] ?? null;
}
function summarize(values: readonly number[]): MetricSummary {
  return { count: values.length, p50Ms: percentile(values, 50), p95Ms: percentile(values, 95), maxMs: values.length ? Math.max(...values) : null };
}

function plansForFrames(count = FRAME_COUNT) {
  const source = { decode: async () => { throw new Error('plan-only source'); } };
  const sources = new Map([[SOURCE_URL, source]]);
  return Array.from({ length: count }, (_unused, index) =>
    evaluationPlanFromResolvedTimeline(timeline, Math.round(((index + 0.5) / FPS) * 1e6), sources, output));
}

async function profileSource(label: string, source: NativeFrameSource, plans: ReturnType<typeof plansForFrames>) {
  const metrics = new FrameMetrics();
  const compositor = new WebGL2Compositor();
  const sources = new Map([[SOURCE_URL, source]]);
  const started = performance.now();
  for (const template of plans) {
    const plan = evaluationPlanFromResolvedTimeline(timeline, template.timeUs, sources, output);
    const frame = await evaluateFrame(plan, { compositor, metrics });
    await readbackFrame(frame, { write() {} });
    frame.close();
  }
  const totalMs = performance.now() - started;
  compositor.dispose();
  return { label, totalMs, stages: metrics.toJSON() };
}

async function profileDecodeAndCache() {
  const samplePlans = plansForFrames(24);
  const fullSession = new ClipSessionPool('profile-full', SOURCE_URL);
  const full = await profileSource('decode', fullSession, samplePlans);
  fullSession.destroy();

  const cacheSession = new ClipSession('profile-cache-fill', SOURCE_URL);
  const masters = new Map<number, VideoFrame>();
  for (const plan of samplePlans) {
    const sourceTimeUs = evaluationPlanFromResolvedTimeline(
      timeline, plan.timeUs, new Map([[SOURCE_URL, cacheSession]]), output
    ).layers[0]!.sourceTimeUs;
    if (!masters.has(sourceTimeUs)) masters.set(sourceTimeUs, await cacheSession.decode(sourceTimeUs));
  }
  const cachedSource: NativeFrameSource = {
    async decode(timeUs) {
      const master = masters.get(timeUs);
      if (!master) throw new Error(`predecoded frame missing at ${timeUs}`);
      return master.clone();
    }
  };
  const cached = await profileSource('predecoded-cache', cachedSource, samplePlans);
  const first = masters.values().next().value as VideoFrame | undefined;
  if (!first) throw new Error('fixed-frame profile has no decoded frame');
  const fixedSource: NativeFrameSource = { async decode() { return first.clone(); } };
  const fixed = await profileSource('decode-less-fixed', fixedSource, samplePlans);
  for (const frame of masters.values()) frame.close();
  cacheSession.destroy();
  return {
    full,
    cached,
    fixed,
    decodeShare: Math.max(0, (full.totalMs - cached.totalMs) / full.totalMs),
    cacheToFullRatio: cached.totalMs / full.totalMs,
    fixedToFullRatio: fixed.totalMs / full.totalMs
  };
}

async function gopAndWarmup() {
  const targets = [6_000_000, 6_500_000, 7_500_000, 12_000_000, 13_000_000, 13_500_000];
  const measure = async (warm: boolean) => {
    const values: number[] = [];
    const details: Array<{ targetUs: number; nearestKeyframeUs: number | null; distanceUs: number | null; decodeMs: number }> = [];
    for (const [index, target] of targets.entries()) {
      const session = new ClipSession(`gop-${warm ? 'warm' : 'cold'}-${index}`, SOURCE_URL);
      await session.load();
      const keyframes = session.getKeyframeTimesUs();
      const nearest = [...keyframes].reverse().find(value => value <= target) ?? null;
      if (warm) await session.warmup(target);
      const started = performance.now();
      const frame = await session.decode(target);
      const elapsed = performance.now() - started;
      frame.close();
      session.destroy();
      values.push(elapsed);
      details.push({ targetUs: target, nearestKeyframeUs: nearest, distanceUs: nearest == null ? null : target - nearest, decodeMs: elapsed });
    }
    return { summary: summarize(values), details };
  };
  const cold = await measure(false);
  const warm = await measure(true);
  const cacheSession = new ClipSession('lookahead-source', SOURCE_URL);
  const frame = await cacheSession.decode(targets[0]!);
  const lookahead = new LookaheadCache(2);
  lookahead.put(0, frame, cold.summary.p50Ms ?? 0);
  const hits: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const started = performance.now();
    const hit = lookahead.getClone(0);
    if (!hit) throw new Error('lookahead cache missed its resident frame');
    hit.frame.close();
    hits.push(performance.now() - started);
  }
  lookahead.clear();
  cacheSession.destroy();
  return {
    cold,
    warm,
    warmToColdP50Ratio: (warm.summary.p50Ms ?? 0) / Math.max(Number.EPSILON, cold.summary.p50Ms ?? 0),
    lookaheadHit: summarize(hits)
  };
}

async function ipcComparison() {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
  const invoke: number[] = [];
  const messagePort: number[] = [];
  const shared: number[] = [];
  let sharedError: string | null = null;
  for (let index = 0; index < 8; index += 1) {
    let started = performance.now();
    await window.frameBench.invokeRoundTrip(bytes);
    invoke.push(performance.now() - started);
    started = performance.now();
    await window.frameBench.portRoundTrip(bytes, false);
    messagePort.push(performance.now() - started);
    try {
      started = performance.now();
      await window.frameBench.portRoundTrip(bytes, true);
      shared.push(performance.now() - started);
    } catch (error) {
      sharedError = String(error);
    }
  }
  return {
    bytesPerFrame: bytes.byteLength,
    invoke: summarize(invoke),
    messagePort: summarize(messagePort),
    sharedBuffer: { available: shared.length > 0, ...summarize(shared), error: sharedError },
    messagePortToInvokeP50Ratio: (percentile(messagePort, 50) ?? 0) / Math.max(Number.EPSILON, percentile(invoke, 50) ?? 0),
    sharedToInvokeP50Ratio: shared.length
      ? (percentile(shared, 50) ?? 0) / Math.max(Number.EPSILON, percentile(invoke, 50) ?? 0)
      : null
  };
}

async function exportRawFfmpeg() {
  const session = new ClipSessionPool('raw-export', SOURCE_URL);
  const compositor = new WebGL2Compositor(document.querySelector<HTMLCanvasElement>('#surface') ?? undefined);
  const metrics = new FrameMetrics();
  const sources = new Map([[SOURCE_URL, session]]);
  const started = performance.now();
  await window.frameBench.startRawEncoder({ width: WIDTH, height: HEIGHT, fps: FPS });
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const plan = evaluationPlanFromResolvedTimeline(timeline, Math.round(((index + 0.5) / FPS) * 1e6), sources, output);
    const frame = await evaluateFrame(plan, { compositor, metrics });
    await readbackFrame(frame, { async write(rgba) { await window.frameBench.writeRawFrame(rgba); } });
    frame.close();
  }
  const sink = await window.frameBench.finishRawEncoder();
  const totalMs = performance.now() - started;
  session.destroy();
  compositor.dispose();
  return { totalMs, sink, stages: metrics.toJSON() };
}

async function exportWebCodecs() {
  const session = new ClipSessionPool('webcodecs-export', SOURCE_URL);
  const compositor = new WebGL2Compositor(
    document.querySelector<HTMLCanvasElement>('#surface') ?? undefined,
    { synchronization: 'flush' }
  );
  const metrics = new FrameMetrics();
  const sources = new Map([[SOURCE_URL, session]]);
  const encoderOptions = { width: WIDTH, height: HEIGHT, fps: FPS, bitrate: 8_000_000 };
  if (!await WebCodecsH264Encoder.isSupported(encoderOptions)) {
    throw new Error('WebCodecs H.264 Annex B config is unsupported');
  }
  const started = performance.now();
  await window.frameBench.startH264Mux({ width: WIDTH, height: HEIGHT, fps: FPS });
  const encoder = new WebCodecsH264Encoder({
    async write(bytes) { await window.frameBench.writeH264Chunk(bytes); }
  }, encoderOptions);
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const evaluationTimeUs = Math.round(((index + 0.5) / FPS) * 1e6);
    const plan = evaluationPlanFromResolvedTimeline(timeline, evaluationTimeUs, sources, output);
    const frame = await evaluateFrame(plan, { compositor, metrics });
    encoder.encode(frame);
    frame.close();
    if (encoder.encodeQueueSize > 8) await new Promise(resolve => setTimeout(resolve, 0));
  }
  await encoder.finish();
  const sink = await window.frameBench.finishH264Mux();
  const totalMs = performance.now() - started;
  session.destroy();
  compositor.dispose();
  return { totalMs, sink, stages: metrics.toJSON(), config: encoder.config };
}

async function run() {
  if (timeline.totalDuration !== DURATION) throw new Error(`benchmark timeline must be ${DURATION}s, got ${timeline.totalDuration}`);
  const profile = await profileDecodeAndCache();
  const gop = await gopAndWarmup();
  const ipc = await ipcComparison();
  const raw = await exportRawFfmpeg();
  const webCodecs = await exportWebCodecs();
  const renderCut = await window.frameBench.runRenderCut();
  const psnr = await window.frameBench.psnr();
  const durationTolerance = 1 / FPS;
  const stages = {
    ...raw.stages,
    ipcWrite: raw.sink.ipcWrite,
    ffmpegDrain: raw.sink.ffmpegDrain,
    ffmpegClose: raw.sink.ffmpegClose
  };
  const ratio = webCodecs.totalMs / renderCut.elapsedMs;
  const pass = raw.sink.frames === FRAME_COUNT
    && webCodecs.sink.frames === FRAME_COUNT
    && Math.abs(raw.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(webCodecs.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(renderCut.durationSeconds - DURATION) <= durationTolerance
    && renderCut.elapsedMs > 0
    && renderCut.sameInputBytes === true
    && ipc.sharedBuffer.available === true
    && Number.isFinite(ratio)
    && psnr.averageDb != null
    && psnr.averageDb > 20;
  await window.frameBench.complete({
    pass,
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoEncoder !== 'undefined',
      webgl2: true,
      crossOriginIsolated
    },
    frameCount: FRAME_COUNT,
    durationSeconds: DURATION,
    profile: { stages, decodeControls: profile, gop },
    ipc,
    encoders: {
      ffmpegPipe: { totalMs: raw.totalMs, sink: raw.sink },
      webCodecs: { totalMs: webCodecs.totalMs, sink: webCodecs.sink, config: webCodecs.config },
      webCodecsToFfmpegRatio: webCodecs.totalMs / raw.totalMs
    },
    renderCut,
    ratio: { v2ToRenderCut: ratio },
    psnr,
    outputs: {
      rawFfmpeg: { durationSeconds: raw.sink.durationSeconds, durationOk: Math.abs(raw.sink.durationSeconds - DURATION) <= durationTolerance },
      webCodecs: { durationSeconds: webCodecs.sink.durationSeconds, durationOk: Math.abs(webCodecs.sink.durationSeconds - DURATION) <= durationTolerance }
    }
  });
}

void run().catch(async error => {
  await window.frameBench.fail(error instanceof Error ? `${error.stack ?? error.message}` : String(error));
});
