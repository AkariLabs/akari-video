import {
  buildResolvedTimelinePlan,
  ClipSession,
  ClipSessionPool,
  copyNativeYuvFrame,
  evaluateFrame,
  evaluationPlanFromResolvedTimeline,
  FrameMetrics,
  LookaheadCache,
  readbackFrame,
  WebCodecsH264Encoder,
  WebGL2Compositor
} from '../../src/index.js';
import type { FrameEngineCut, FrameEngineLayer, NativeFrameSource } from '../../src/index.js';
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
type StageClassification = 'inclusive' | 'exclusive' | 'one-shot';
interface ProfileStage extends MetricSummary {
  classification: StageClassification;
  relationship: string;
  perFrameContributionMs: number | null;
  derived?: boolean;
  formula?: string;
}
interface FrameBenchBridge {
  fixtureUrl: string;
  workerUrl: string;
  startRawEncoder(options: { width: number; height: number; fps: number }): Promise<string>;
  writeRawFrame(bytes: Uint8Array): Promise<number>;
  finishRawEncoder(): Promise<EncoderResult>;
  startH264Mux(options: { width: number; height: number; fps: number }): Promise<string>;
  writeH264Chunk(bytes: Uint8Array): Promise<number>;
  finishH264Mux(): Promise<EncoderResult>;
  abortEncoder(): Promise<boolean>;
  invokeRoundTrip(bytes: Uint8Array): Promise<number>;
  portRoundTrip(bytes: Uint8Array): Promise<{ id: number; length: number }>;
  runRenderCut(): Promise<{ elapsedMs: number; path: string; durationSeconds: number; inputSha256: string; sameInputBytes: boolean }>;
  psnr(): Promise<{ averageDb: number | null; status: number }>;
  complete(result: unknown): Promise<boolean>;
  fail(message: string): Promise<boolean>;
}
declare global { interface Window { frameBench: FrameBenchBridge; } }

interface SkippedPhase {
  skipped: string;
  elapsedMs: number;
}

interface PhaseContext {
  readonly signal: AbortSignal;
  wait<T>(label: string, promise: PromiseLike<T>): Promise<T>;
}

type PhaseResult<T> = T | SkippedPhase;

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const DURATION = 13;
const FRAME_COUNT = DURATION * FPS;
const SOURCE_URL = window.frameBench.fixtureUrl;
const query = new URL(window.location.href).searchParams;
const REPEAT_COUNT = Number(query.get('repeat') ?? '3');
const REQUESTED_UPLOAD_PATH = query.get('uploadPath') === 'copyTo' ? 'copyTo' : 'direct';
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

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

const STAGE_RELATIONSHIPS: Record<string, Pick<ProfileStage, 'classification' | 'relationship'>> = {
  decode: { classification: 'inclusive', relationship: 'contains tick and decode overhead' },
  tick: { classification: 'exclusive', relationship: 'part of decode' },
  copy: { classification: 'inclusive', relationship: 'contains copyTo + planeCompact' },
  copyTo: { classification: 'exclusive', relationship: 'part of copy' },
  planeCompact: { classification: 'exclusive', relationship: 'part of copy' },
  upload: { classification: 'exclusive', relationship: 'standalone compositor stage' },
  shader: { classification: 'inclusive', relationship: 'CPU wall for shader submission/synchronization' },
  shaderGpu: { classification: 'exclusive', relationship: 'GPU measurement corresponding to shader' },
  readback: { classification: 'inclusive', relationship: 'contains pboWait + rowFlip + buffer read' },
  pboWait: { classification: 'exclusive', relationship: 'part of readback' },
  rowFlip: { classification: 'exclusive', relationship: 'part of readback' },
  sink: { classification: 'inclusive', relationship: 'contains ipcTransit + ipcWrite + ffmpegDrain' },
  ipcTransit: { classification: 'exclusive', relationship: 'derived part of sink' },
  ipcWrite: { classification: 'exclusive', relationship: 'part of sink' },
  ffmpegDrain: { classification: 'exclusive', relationship: 'part of sink' },
  ffmpegClose: { classification: 'one-shot', relationship: 'once per export; excluded from per-frame ranking' }
};

function buildStageProfile(metrics: Record<string, unknown>): {
  stages: Record<string, ProfileStage>;
  ranking: Array<{ name: string; p50Ms: number; count: number; perFrameContributionMs: number }>;
  dominantStage: { name: string; p50Ms: number; count: number; perFrameContributionMs: number } | null;
  oneShotStages: Array<{ name: string; p50Ms: number | null; count: number }>;
} {
  const metric = (name: string): MetricSummary | undefined => {
    const value = metrics[name];
    return typeof value === 'object' && value !== null && 'count' in value
      ? value as MetricSummary
      : undefined;
  };
  const sink = metric('sink');
  const ipcWrite = metric('ipcWrite');
  const ffmpegDrain = metric('ffmpegDrain');
  const ipcTransitP50 = sink?.p50Ms != null && ipcWrite?.p50Ms != null && ffmpegDrain?.p50Ms != null
    ? Math.max(0, sink.p50Ms - ipcWrite.p50Ms - ffmpegDrain.p50Ms)
    : null;
  const ipcTransitCount = Math.min(sink?.count ?? 0, ipcWrite?.count ?? 0, ffmpegDrain?.count ?? 0);
  const measured = Object.fromEntries(Object.entries(metrics).filter(
    (entry): entry is [string, MetricSummary] =>
      typeof entry[1] === 'object' && entry[1] !== null
      && 'count' in entry[1]
      && typeof entry[1].count === 'number',
  ));
  const withDerived: Record<string, MetricSummary> = {
    ...measured,
    ipcTransit: {
      count: ipcTransitCount,
      p50Ms: ipcTransitP50,
      p95Ms: null,
      maxMs: null
    }
  };
  const stages = Object.fromEntries(Object.entries(withDerived).map(([name, metric]) => {
    const relationship = STAGE_RELATIONSHIPS[name] ?? {
      classification: 'exclusive' as const,
      relationship: 'standalone stage'
    };
    const perFrameContributionMs = relationship.classification === 'exclusive' && metric.p50Ms != null
      ? metric.p50Ms * metric.count / FRAME_COUNT
      : null;
    return [name, {
      ...metric,
      ...relationship,
      perFrameContributionMs,
      ...(name === 'ipcTransit' ? {
        derived: true,
        formula: 'sink.p50Ms - (ipcWrite.p50Ms + ffmpegDrain.p50Ms)'
      } : {})
    }];
  })) as Record<string, ProfileStage>;
  const ranking = Object.entries(stages)
    .filter((entry): entry is [string, ProfileStage & { p50Ms: number; perFrameContributionMs: number }] =>
      entry[1].classification === 'exclusive'
      && entry[1].p50Ms != null
      && entry[1].perFrameContributionMs != null
      && entry[1].count > 0)
    .map(([name, metric]) => ({
      name,
      p50Ms: metric.p50Ms,
      count: metric.count,
      perFrameContributionMs: metric.perFrameContributionMs
    }))
    .sort((left, right) => right.perFrameContributionMs - left.perFrameContributionMs);
  const oneShotStages = Object.entries(stages)
    .filter(([, metric]) => metric.classification === 'one-shot')
    .map(([name, metric]) => ({ name, p50Ms: metric.p50Ms, count: metric.count }));
  return { stages, ranking, dominantStage: ranking[0] ?? null, oneShotStages };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSkipped<T>(value: PhaseResult<T>): value is PhaseResult<T> & SkippedPhase {
  return typeof value === 'object' && value !== null && 'skipped' in value;
}

async function runPhase<T extends object>(name: string, timeoutMs: number, fn: (context: PhaseContext) => Promise<T>): Promise<PhaseResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  let timer = 0;
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeoutError = new Error(`${name} timed out after ${timeoutMs}ms`);
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
    timer = window.setTimeout(() => {
      controller.abort(timeoutError);
      rejectTimeout(timeoutError);
    }, timeoutMs);
  });
  const context: PhaseContext = {
    signal: controller.signal,
    wait(label, promise) {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error(`${name}/${label} aborted`)
        ), { once: true });
      });
      return Promise.race([Promise.resolve(promise), aborted]);
    }
  };
  console.log(`[phase] start ${name} timeout=${timeoutMs}ms`);
  const operation = fn(context);
  try {
    const value = await Promise.race([operation, timeout]);
    const elapsedMs = performance.now() - started;
    Object.assign(value, { phaseElapsedMs: elapsedMs });
    console.log(`[phase] end ${name} elapsed=${elapsedMs.toFixed(1)}ms`);
    return value;
  } catch (error) {
    controller.abort(error);
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>(resolve => window.setTimeout(resolve, 5_000))
    ]);
    const elapsedMs = performance.now() - started;
    const skipped = errorMessage(error);
    console.log(`[phase] end ${name} elapsed=${elapsedMs.toFixed(1)}ms skipped=${skipped}`);
    return { skipped, elapsedMs };
  } finally {
    window.clearTimeout(timer);
  }
}

function plansForFrames(count = FRAME_COUNT) {
  const source = { decode: async () => { throw new Error('plan-only source'); } };
  const sources = new Map([[SOURCE_URL, source]]);
  return Array.from({ length: count }, (_unused, index) =>
    evaluationPlanFromResolvedTimeline(timeline, Math.round(((index + 0.5) / FPS) * 1e6), sources, output));
}

async function profileSource(
  context: PhaseContext,
  label: string,
  source: NativeFrameSource,
  plans: ReturnType<typeof plansForFrames>
) {
  const metrics = new FrameMetrics();
  const compositor = new WebGL2Compositor(undefined, { uploadPath: REQUESTED_UPLOAD_PATH });
  const sources = new Map([[SOURCE_URL, source]]);
  const started = performance.now();
  try {
    for (const template of plans) {
      const plan = evaluationPlanFromResolvedTimeline(timeline, template.timeUs, sources, output);
      const frame = await context.wait(`${label} evaluate frame`, evaluateFrame(plan, { compositor, metrics }));
      try {
        await context.wait(`${label} readback frame`, readbackFrame(frame, { write() {} }));
      } finally {
        frame.close();
      }
    }
    const totalMs = performance.now() - started;
    return { label, totalMs, stages: metrics.toJSON() };
  } finally {
    compositor.dispose();
  }
}

async function benchmarkLayerCount(context: PhaseContext, count: number) {
  const layers: FrameEngineLayer[] = Array.from({ length: count }, (_, index) => ({
    id: `bench-${index}`, t: 0, duration: 2, kind: 'video', src: SOURCE_URL,
    transform: { x: (index - count / 2) * 36, y: (index % 2 ? 1 : -1) * 20, scale: .34 + index * .025, rotate: index * 3 },
    opacity: .72, blend: index % 2 ? 'screen' : 'normal'
  }));
  const layerTimeline = buildResolvedTimelinePlan(edit.cuts as FrameEngineCut[], { fps: FPS, layers });
  const pool = new ClipSessionPool(`layer-bench-${count}`, SOURCE_URL);
  const sources = new Map([[SOURCE_URL, pool]]);
  const metrics = new FrameMetrics();
  const constructionStarted = performance.now();
  const compositor = new WebGL2Compositor(undefined, {
    synchronization: 'finish',
    uploadPath: REQUESTED_UPLOAD_PATH,
  });
  const gpuInitializationMs = performance.now() - constructionStarted;
  const frameWalls: number[] = [];
  try {
    for (let index = 0; index < 30; index += 1) {
      const plan = evaluationPlanFromResolvedTimeline(layerTimeline, Math.round((.25 + index / FPS) * 1e6), sources, output);
      const started = performance.now();
      const frame = await context.wait(`layers=${count} frame=${index}`, evaluateFrame(plan, { compositor, metrics }));
      const presentStarted = performance.now();
      void frame.surface.canvas;
      metrics.record('present', performance.now() - presentStarted);
      frameWalls.push(performance.now() - started);
      frame.close();
    }
    const stages = metrics.toJSON();
    return {
      count, frames: frameWalls.length, gpuInitializationMs,
      coldFirstFrameMs: frameWalls[0], steadyFrameMs: summarize(frameWalls.slice(1)),
      stages: Object.fromEntries((['decode','upload','shaderGpu','present'] as const).map(name => [name, stages[name]]))
    };
  } finally { pool.destroy(); compositor.dispose(); }
}

async function measureZeroCopy(context: PhaseContext) {
  const session = new ClipSession('zero-copy', SOURCE_URL);
  const metrics = new FrameMetrics();
  try {
    const decodeStarted = performance.now();
    const frame = await context.wait('zero-copy decode', session.decode(500_000, metrics));
    const decoderFirstFrameMs = performance.now() - decodeStarted;
    try {
      const copyStarted = performance.now();
      await copyNativeYuvFrame(frame, metrics);
      const copyToPlanesMs = performance.now() - copyStarted;
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable for direct VideoFrame upload');
      const texture = gl.createTexture();
      if (!texture) throw new Error('texture allocation failed');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const directStarted = performance.now();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);
      gl.finish();
      const directVideoFrameTexImageMs = performance.now() - directStarted;
      gl.deleteTexture(texture);
      return { decoderFirstFrameMs, copyToPlanesMs, directVideoFrameTexImageMs,
        directToCopyRatio: directVideoFrameTexImageMs / copyToPlanesMs };
    } finally { frame.close(); }
  } finally { session.destroy(); }
}

async function profileDecodeAndCache(context: PhaseContext) {
  const samplePlans = plansForFrames(24);
  const fullSession = new ClipSessionPool('profile-full', SOURCE_URL);
  const cacheSession = new ClipSession('profile-cache-fill', SOURCE_URL);
  const masters = new Map<number, VideoFrame>();
  try {
    const full = await context.wait('decode profile', profileSource(context, 'decode', fullSession, samplePlans));
    for (const plan of samplePlans) {
      const sourceTimeUs = evaluationPlanFromResolvedTimeline(
        timeline, plan.timeUs, new Map([[SOURCE_URL, cacheSession]]), output
      ).base[0]!.sourceTimeUs;
      if (!masters.has(sourceTimeUs)) {
        masters.set(sourceTimeUs, await context.wait('predecode cache fill', cacheSession.decode(sourceTimeUs)));
      }
    }
    const cachedSource: NativeFrameSource = {
      async decode(timeUs) {
        const master = masters.get(timeUs);
        if (!master) throw new Error(`predecoded frame missing at ${timeUs}`);
        return master.clone();
      }
    };
    const cached = await context.wait(
      'predecoded cache profile',
      profileSource(context, 'predecoded-cache', cachedSource, samplePlans)
    );
    const first = masters.values().next().value as VideoFrame | undefined;
    if (!first) throw new Error('fixed-frame profile has no decoded frame');
    const fixedSource: NativeFrameSource = { async decode() { return first.clone(); } };
    const fixed = await context.wait(
      'decode-less profile',
      profileSource(context, 'decode-less-fixed', fixedSource, samplePlans)
    );
    return {
      sampleFrames: samplePlans.length,
      full,
      cached,
      fixed,
      decodeShare: Math.max(0, (full.totalMs - cached.totalMs) / full.totalMs),
      cacheToFullRatio: cached.totalMs / full.totalMs,
      fixedToFullRatio: fixed.totalMs / full.totalMs
    };
  } finally {
    fullSession.destroy();
    for (const frame of masters.values()) frame.close();
    cacheSession.destroy();
  }
}

async function gopAndWarmup(context: PhaseContext) {
  const targets = [
    { label: 'cut-1-in', targetUs: 0 },
    { label: 'cut-1-out', targetUs: 3_250_000 },
    { label: 'cut-2-in', targetUs: 6_000_000 },
    { label: 'cut-2-out', targetUs: 9_250_000 },
    { label: 'cut-3-in', targetUs: 12_000_000 },
    { label: 'cut-3-out', targetUs: 15_250_000 },
    { label: 'cut-4-in', targetUs: 18_000_000 },
    { label: 'cut-4-out', targetUs: 21_250_000 }
  ];
  const measure = async (warm: boolean) => {
    const values: number[] = [];
    const details: Array<{ label: string; targetUs: number; nearestKeyframeUs: number | null; distanceUs: number | null; decodeMs: number }> = [];
    for (const [index, target] of targets.entries()) {
      const session = new ClipSession(`gop-${warm ? 'warm' : 'cold'}-${index}`, SOURCE_URL);
      try {
        await context.wait('GOP session load', session.load());
        const keyframes = session.getKeyframeTimesUs();
        const nearest = [...keyframes].reverse().find(value => value <= target.targetUs) ?? null;
        if (warm) await context.wait('GOP warmup', session.warmup(target.targetUs));
        const started = performance.now();
        const frame = await context.wait('GOP target decode', session.decode(target.targetUs));
        const elapsed = performance.now() - started;
        frame.close();
        values.push(elapsed);
        details.push({
          label: target.label,
          targetUs: target.targetUs,
          nearestKeyframeUs: nearest,
          distanceUs: nearest == null ? null : target.targetUs - nearest,
          decodeMs: elapsed
        });
      } finally {
        session.destroy();
      }
    }
    return { summary: summarize(values), details };
  };
  const cold = await context.wait('cold GOP profile', measure(false));
  const warm = await context.wait('warm GOP profile', measure(true));
  const cacheSession = new ClipSession('lookahead-source', SOURCE_URL);
  const lookahead = new LookaheadCache(2);
  try {
    const frame = await context.wait('lookahead seed decode', cacheSession.decode(targets[0]!.targetUs));
    lookahead.put(0, frame, cold.summary.p50Ms ?? 0);
    const hits: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const started = performance.now();
      const hit = lookahead.getClone(0);
      if (!hit) throw new Error('lookahead cache missed its resident frame');
      hit.frame.close();
      hits.push(performance.now() - started);
    }
    return {
      cold,
      warm,
      warmToColdP50Ratio: (warm.summary.p50Ms ?? 0) / Math.max(Number.EPSILON, cold.summary.p50Ms ?? 0),
      lookaheadHit: summarize(hits)
    };
  } finally {
    lookahead.clear();
    cacheSession.destroy();
  }
}

async function ipcComparison(context: PhaseContext) {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
  const invoke: number[] = [];
  const messagePort: number[] = [];
  const workerTransfer: number[] = [];
  const workerShared: number[] = [];
  const sharedAvailable = typeof SharedArrayBuffer !== 'undefined' && crossOriginIsolated;
  if (!sharedAvailable) throw new Error('SharedArrayBuffer requires a cross-origin-isolated renderer');
  const worker = new Worker(window.frameBench.workerUrl);
  const channel = new MessageChannel();
  let nextWorkerId = 1;
  const pending = new Map<number, {
    resolve(value: { id: number; length: number; shared: boolean; buffer: ArrayBuffer | SharedArrayBuffer }): void;
    reject(error: Error): void;
  }>();
  channel.port1.onmessage = event => {
    const resolver = pending.get(event.data?.id);
    if (!resolver) return;
    pending.delete(event.data.id);
    resolver.resolve(event.data);
  };
  channel.port1.start();
  worker.addEventListener('error', event => {
    const error = new Error(`IPC worker failed: ${event.message}`);
    for (const resolver of pending.values()) resolver.reject(error);
    pending.clear();
  });
  worker.postMessage({ kind: 'connect' }, [channel.port2]);
  const workerRoundTrip = (
    kind: 'array-buffer-transfer' | 'shared-array-buffer',
    buffer: ArrayBuffer | SharedArrayBuffer
  ) => {
    const id = nextWorkerId++;
    const result = new Promise<{ id: number; length: number; shared: boolean; buffer: ArrayBuffer | SharedArrayBuffer }>(
      (resolve, reject) => pending.set(id, { resolve, reject })
    );
    if (kind === 'array-buffer-transfer' && buffer instanceof ArrayBuffer) {
      channel.port1.postMessage({ id, kind, buffer }, [buffer]);
    } else {
      channel.port1.postMessage({ id, kind, buffer });
    }
    return result;
  };
  try {
    for (let index = 0; index < 8; index += 1) {
      let started = performance.now();
      const invokeLength = await context.wait('ipcRenderer.invoke copy', window.frameBench.invokeRoundTrip(bytes));
      if (invokeLength !== bytes.byteLength) throw new Error(`ipcRenderer.invoke returned ${invokeLength} bytes`);
      invoke.push(performance.now() - started);

      started = performance.now();
      const portResult = await context.wait('MessagePortMain copy', window.frameBench.portRoundTrip(bytes));
      if (portResult.length !== bytes.byteLength) throw new Error(`MessagePortMain returned ${portResult.length} bytes`);
      messagePort.push(performance.now() - started);

      const transfer = Uint8Array.from(bytes);
      started = performance.now();
      const transferResult = await context.wait(
        'worker ArrayBuffer transfer',
        workerRoundTrip('array-buffer-transfer', transfer.buffer)
      );
      if (transferResult.length !== bytes.byteLength || transferResult.shared) {
        throw new Error('worker ArrayBuffer transfer returned invalid metadata');
      }
      workerTransfer.push(performance.now() - started);

      const shared = new SharedArrayBuffer(bytes.byteLength);
      new Uint8Array(shared).set(bytes);
      started = performance.now();
      const sharedResult = await context.wait(
        'worker SharedArrayBuffer',
        workerRoundTrip('shared-array-buffer', shared)
      );
      if (sharedResult.length !== bytes.byteLength || !sharedResult.shared) {
        throw new Error('worker SharedArrayBuffer returned invalid metadata');
      }
      workerShared.push(performance.now() - started);
    }
  } finally {
    for (const resolver of pending.values()) resolver.reject(new Error('IPC worker stopped'));
    pending.clear();
    channel.port1.close();
    worker.terminate();
  }
  return {
    bytesPerFrame: bytes.byteLength,
    invoke: {
      lane: 'renderer-main-invoke-copy',
      boundary: 'renderer-to-main',
      mechanism: 'ipcRenderer.invoke structured clone',
      ...summarize(invoke)
    },
    messagePort: {
      lane: 'renderer-main-message-port-copy',
      boundary: 'renderer-to-main',
      mechanism: 'MessagePortMain structured clone without transfer list',
      ...summarize(messagePort)
    },
    sharedBuffer: {
      lane: 'renderer-main-shared-array-buffer',
      boundary: 'renderer-to-main',
      mechanism: 'MessagePortMain SharedArrayBuffer',
      available: false,
      reasonCode: 'PROCESS_BOUNDARY_UNSUPPORTED',
      reason: 'SharedArrayBuffer does not cross the renderer-to-main process boundary; MessagePortMain receives event.data as null'
    },
    worker: {
      arrayBufferTransfer: {
        lane: 'renderer-worker-array-buffer-transfer',
        boundary: 'renderer-to-worker',
        mechanism: 'MessageChannel ArrayBuffer transfer list',
        available: workerTransfer.length > 0,
        ...summarize(workerTransfer)
      },
      sharedBuffer: {
        lane: 'renderer-worker-shared-array-buffer',
        boundary: 'renderer-to-worker',
        mechanism: 'MessageChannel SharedArrayBuffer',
        available: workerShared.length > 0,
        reason: null,
        ...summarize(workerShared)
      }
    },
    messagePortToInvokeP50Ratio: (percentile(messagePort, 50) ?? 0) / Math.max(Number.EPSILON, percentile(invoke, 50) ?? 0),
    workerTransferToInvokeP50Ratio: workerTransfer.length
      ? (percentile(workerTransfer, 50) ?? 0) / Math.max(Number.EPSILON, percentile(invoke, 50) ?? 0)
      : null,
    workerSharedToInvokeP50Ratio: workerShared.length
      ? (percentile(workerShared, 50) ?? 0) / Math.max(Number.EPSILON, percentile(invoke, 50) ?? 0)
      : null
  };
}

async function exportRawFfmpeg(context: PhaseContext) {
  const session = new ClipSessionPool('raw-export', SOURCE_URL);
  const compositor = new WebGL2Compositor(undefined, { uploadPath: REQUESTED_UPLOAD_PATH });
  const metrics = new FrameMetrics();
  const sources = new Map([[SOURCE_URL, session]]);
  const started = performance.now();
  let encoderStarted = false;
  let encoderFinished = false;
  try {
    await context.wait('start raw encoder', window.frameBench.startRawEncoder({ width: WIDTH, height: HEIGHT, fps: FPS }));
    encoderStarted = true;
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const plan = evaluationPlanFromResolvedTimeline(timeline, Math.round(((index + 0.5) / FPS) * 1e6), sources, output);
      const frame = await context.wait('evaluate raw frame', evaluateFrame(plan, { compositor, metrics }));
      try {
        await context.wait('readback and write raw frame', readbackFrame(frame, {
          async write(rgba) {
            await context.wait('renderer-to-main raw frame', window.frameBench.writeRawFrame(rgba));
          }
        }));
      } finally {
        frame.close();
      }
    }
    const sink = await context.wait('finish raw encoder', window.frameBench.finishRawEncoder());
    encoderFinished = true;
    const totalMs = performance.now() - started;
    return { totalMs, sink, stages: metrics.toJSON() };
  } finally {
    if (encoderStarted && !encoderFinished) {
      try { await window.frameBench.abortEncoder(); } catch (error) { console.warn(`raw encoder cleanup: ${errorMessage(error)}`); }
    }
    session.destroy();
    compositor.dispose();
  }
}

async function exportWebCodecs(context: PhaseContext) {
  const session = new ClipSessionPool('webcodecs-export', SOURCE_URL);
  const compositor = new WebGL2Compositor(undefined, {
    synchronization: 'flush',
    uploadPath: REQUESTED_UPLOAD_PATH,
  });
  const metrics = new FrameMetrics();
  const sources = new Map([[SOURCE_URL, session]]);
  const encoderOptions = { width: WIDTH, height: HEIGHT, fps: FPS, bitrate: 8_000_000 };
  let muxStarted = false;
  let muxFinished = false;
  let encoder: WebCodecsH264Encoder | null = null;
  try {
    if (!await context.wait('check WebCodecs support', WebCodecsH264Encoder.isSupported(encoderOptions))) {
      throw new Error('WebCodecs H.264 Annex B config is unsupported');
    }
    const started = performance.now();
    await context.wait('start H.264 mux', window.frameBench.startH264Mux({ width: WIDTH, height: HEIGHT, fps: FPS }));
    muxStarted = true;
    encoder = new WebCodecsH264Encoder({
      async write(bytes) {
        await context.wait('renderer-to-main H.264 chunk', window.frameBench.writeH264Chunk(bytes));
      }
    }, encoderOptions);
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const evaluationTimeUs = Math.round(((index + 0.5) / FPS) * 1e6);
      const plan = evaluationPlanFromResolvedTimeline(timeline, evaluationTimeUs, sources, output);
      const frame = await context.wait('evaluate WebCodecs frame', evaluateFrame(plan, { compositor, metrics }));
      try {
        encoder.encode(frame);
      } finally {
        frame.close();
      }
      if (encoder.encodeQueueSize > 8) {
        await context.wait('WebCodecs queue yield', new Promise<void>(resolve => window.setTimeout(resolve, 0)));
      }
    }
    await context.wait('flush WebCodecs encoder', encoder.finish());
    const sink = await context.wait('finish H.264 mux', window.frameBench.finishH264Mux());
    muxFinished = true;
    const totalMs = performance.now() - started;
    return { totalMs, sink, stages: metrics.toJSON(), config: encoder.config };
  } finally {
    encoder?.close();
    if (muxStarted && !muxFinished) {
      try { await window.frameBench.abortEncoder(); } catch (error) { console.warn(`H.264 mux cleanup: ${errorMessage(error)}`); }
    }
    session.destroy();
    compositor.dispose();
  }
}

type RawExportResult = Awaited<ReturnType<typeof exportRawFfmpeg>>;
type WebCodecsExportResult = Awaited<ReturnType<typeof exportWebCodecs>>;
type RenderCutResult = Awaited<ReturnType<FrameBenchBridge['runRenderCut']>>;
type PsnrResult = Awaited<ReturnType<FrameBenchBridge['psnr']>>;
interface RepeatedRun {
  run: number;
  exportRawFfmpeg: PhaseResult<RawExportResult>;
  exportWebCodecs: PhaseResult<WebCodecsExportResult>;
  runRenderCut: PhaseResult<RenderCutResult>;
  psnr: PhaseResult<PsnrResult>;
}

async function run() {
  if (timeline.totalDuration !== DURATION) throw new Error(`benchmark timeline must be ${DURATION}s, got ${timeline.totalDuration}`);
  if (!Number.isInteger(REPEAT_COUNT) || REPEAT_COUNT < 1) {
    throw new Error(`BENCH_REPEAT must be a positive integer, got ${String(REPEAT_COUNT)}`);
  }
  const repeatedRuns: RepeatedRun[] = [];
  for (let index = 0; index < REPEAT_COUNT; index += 1) {
    const runNumber = index + 1;
    const rawResult = await runPhase(`exportRawFfmpeg[${runNumber}]`, 900_000, exportRawFfmpeg);
    const webCodecsResult = await runPhase(`exportWebCodecs[${runNumber}]`, 900_000, exportWebCodecs);
    const renderCutResult = await runPhase(`runRenderCut[${runNumber}]`, 900_000, context =>
      context.wait('render-cut invoke', window.frameBench.runRenderCut()));
    const psnrResult = await runPhase(`psnr[${runNumber}]`, 300_000, async context => {
      if (isSkipped(webCodecsResult)) throw new Error(`WebCodecs dependency skipped: ${webCodecsResult.skipped}`);
      if (isSkipped(renderCutResult)) throw new Error(`render-cut dependency skipped: ${renderCutResult.skipped}`);
      return context.wait('PSNR invoke', window.frameBench.psnr());
    });
    repeatedRuns.push({
      run: runNumber,
      exportRawFfmpeg: rawResult,
      exportWebCodecs: webCodecsResult,
      runRenderCut: renderCutResult,
      psnr: psnrResult
    });
  }
  const ratioRuns = repeatedRuns.flatMap((value, index) =>
    !isSkipped(value.exportWebCodecs)
      && !isSkipped(value.runRenderCut)
      && value.runRenderCut.elapsedMs > 0
      ? [{ index, run: value.run, ratio: value.exportWebCodecs.totalMs / value.runRenderCut.elapsedMs }]
      : []);
  const ratioSamples = ratioRuns.map(value => value.ratio);
  const ratioMedian = median(ratioSamples);
  const sourceRunIndex = ratioMedian == null
    ? 0
    : ratioRuns.reduce((best, value) =>
        Math.abs(value.ratio - ratioMedian) < Math.abs(best.ratio - ratioMedian) ? value : best
      ).index;
  const sourceRun = repeatedRuns[sourceRunIndex]!;
  const raw = sourceRun.exportRawFfmpeg;
  const webCodecs = sourceRun.exportWebCodecs;
  const renderCut = sourceRun.runRenderCut;
  const psnr = sourceRun.psnr;
  const profile = await runPhase('profileDecodeAndCache', 300_000, profileDecodeAndCache);
  const gop = await runPhase('gopAndWarmup', 300_000, gopAndWarmup);
  const ipc = await runPhase('ipcComparison', 120_000, ipcComparison);
  const layerScaling = [];
  for (const count of [0, 1, 3, 5]) {
    layerScaling.push(await runPhase(`layerScaling[${count}]`, 180_000, context => benchmarkLayerCount(context, count)));
  }
  const zeroCopy = await runPhase('layerZeroCopy', 120_000, measureZeroCopy);
  const durationTolerance = 1 / FPS;
  const phaseResults = {
    exportRawFfmpeg: raw,
    exportWebCodecs: webCodecs,
    runRenderCut: renderCut,
    psnr,
    profileDecodeAndCache: profile,
    gopAndWarmup: gop,
    ipcComparison: ipc,
    runs: repeatedRuns
  };
  const skippedPhases: Array<{ name: string; reason: string; elapsedMs: number }> = [];
  const repeatedNames = ['exportRawFfmpeg', 'exportWebCodecs', 'runRenderCut', 'psnr'] as const;
  for (const repeatedRun of repeatedRuns) {
    for (const name of repeatedNames) {
      const value = repeatedRun[name];
      if (isSkipped(value)) {
        skippedPhases.push({ name: `${name}[${repeatedRun.run}]`, reason: value.skipped, elapsedMs: value.elapsedMs });
      }
    }
  }
  for (const [name, value] of [
    ['profileDecodeAndCache', profile],
    ['gopAndWarmup', gop],
    ['ipcComparison', ipc]
  ] as const) {
    if (isSkipped(value)) skippedPhases.push({ name, reason: value.skipped, elapsedMs: value.elapsedMs });
  }
  const rawStageMetrics: Record<string, unknown> | null = isSkipped(raw)
    ? null
    : {
        ...raw.stages,
        ipcWrite: raw.sink.ipcWrite,
        ffmpegDrain: raw.sink.ffmpegDrain,
        ffmpegClose: raw.sink.ffmpegClose
      };
  const stageProfile = rawStageMetrics ? buildStageProfile(rawStageMetrics) : null;
  const stages = isSkipped(raw) ? { skipped: raw.skipped } : stageProfile!.stages;
  const dominantStage = stageProfile?.dominantStage ?? null;
  const ratio = ratioMedian;
  const improvementSamples = repeatedRuns.flatMap(value =>
    !isSkipped(value.exportRawFfmpeg) && !isSkipped(value.exportWebCodecs)
      ? [{
          run: value.run,
          beforeMs: value.exportRawFfmpeg.totalMs,
          afterMs: value.exportWebCodecs.totalMs,
          deltaMs: value.exportWebCodecs.totalMs - value.exportRawFfmpeg.totalMs,
          ratio: value.exportWebCodecs.totalMs / value.exportRawFfmpeg.totalMs
        }]
      : []);
  const beforeMedian = median(improvementSamples.map(value => value.beforeMs));
  const afterMedian = median(improvementSamples.map(value => value.afterMs));
  const improvements = beforeMedian != null && afterMedian != null
    ? [{
        name: 'WebCodecs direct surface export',
        beforeMs: beforeMedian,
        afterMs: afterMedian,
        deltaMs: afterMedian - beforeMedian,
        ratio: afterMedian / beforeMedian,
        samples: improvementSamples,
        evidence: 'repeated-run medians on the same surface path: before includes RGBA readback, 8MB/frame renderer-to-main copy, and raw ffmpeg pipe; after uses WebCodecs H.264 plus copy mux'
      }]
    : [];
  const pathSpecificStages = REQUESTED_UPLOAD_PATH === 'copyTo'
    ? ['copyTo', 'planeCompact']
    : ['upload'];
  const stageProfileEstablished = stageProfile != null && [
    'tick', ...pathSpecificStages, 'shaderGpu', 'pboWait', 'rowFlip',
    'ipcTransit', 'ipcWrite', 'ffmpegDrain', 'ffmpegClose'
  ].every(name => (stageProfile.stages[name]?.count ?? 0) > 0)
    && stageProfile.dominantStage?.name !== 'ffmpegClose'
    && stageProfile.oneShotStages.some(value => value.name === 'ffmpegClose');
  const allRepeatedOutputsValid = repeatedRuns.every(value =>
    !isSkipped(value.exportRawFfmpeg)
    && !isSkipped(value.exportWebCodecs)
    && !isSkipped(value.runRenderCut)
    && !isSkipped(value.psnr)
    && value.exportRawFfmpeg.sink.frames === FRAME_COUNT
    && value.exportWebCodecs.sink.frames === FRAME_COUNT
    && Math.abs(value.exportRawFfmpeg.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(value.exportWebCodecs.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(value.runRenderCut.durationSeconds - DURATION) <= durationTolerance
    && value.runRenderCut.elapsedMs > 0
    && value.runRenderCut.sameInputBytes === true
    && value.psnr.status === 0
    && value.psnr.averageDb != null
    && value.psnr.averageDb > 20);
  const pass = skippedPhases.length === 0
    && allRepeatedOutputsValid
    && !isSkipped(raw)
    && !isSkipped(webCodecs)
    && !isSkipped(renderCut)
    && !isSkipped(psnr)
    && !isSkipped(profile)
    && !isSkipped(gop)
    && !isSkipped(ipc)
    && raw.sink.frames === FRAME_COUNT
    && webCodecs.sink.frames === FRAME_COUNT
    && Math.abs(raw.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(webCodecs.sink.durationSeconds - DURATION) <= durationTolerance
    && Math.abs(renderCut.durationSeconds - DURATION) <= durationTolerance
    && renderCut.elapsedMs > 0
    && renderCut.sameInputBytes === true
    && stageProfileEstablished
    && profile.full.totalMs > 0
    && profile.cached.totalMs > 0
    && profile.fixed.totalMs > 0
    && ipc.sharedBuffer.available === false
    && ipc.worker.arrayBufferTransfer.available === true
    && ipc.worker.sharedBuffer.available === true
    && ratio != null
    && Number.isFinite(ratio)
    && psnr.status === 0
    && psnr.averageDb != null
    && psnr.averageDb > 20;
  const firstLayerScaling = layerScaling[0]!;
  await window.frameBench.complete({
    pass,
    uploadPath: {
      requested: REQUESTED_UPLOAD_PATH,
      effective: isSkipped(raw) ? null : raw.stages.uploadPath,
    },
    skippedPhases,
    phases: phaseResults,
    environment: {
      userAgent: navigator.userAgent,
      webCodecs: typeof VideoEncoder !== 'undefined',
      webgl2: true,
      crossOriginIsolated
    },
    frameCount: FRAME_COUNT,
    durationSeconds: DURATION,
    profile: {
      stages,
      decodeControls: profile,
      gop,
      dominantStage,
      exclusiveRanking: stageProfile?.ranking ?? [],
      oneShotStages: stageProfile?.oneShotStages ?? [],
      sourceRun: sourceRun.run
    },
    ipc,
    encoders: {
      ffmpegPipe: isSkipped(raw) ? raw : { totalMs: raw.totalMs, sink: raw.sink },
      webCodecs: isSkipped(webCodecs)
        ? webCodecs
        : { totalMs: webCodecs.totalMs, sink: webCodecs.sink, config: webCodecs.config },
      webCodecsToFfmpegRatio: !isSkipped(raw) && !isSkipped(webCodecs)
        ? webCodecs.totalMs / raw.totalMs
        : null
    },
    renderCut,
    ratio: {
      v2ToRenderCut: ratio,
      samples: ratioSamples,
      steadySamples: ratioSamples.slice(1),
      steadyMedian: median(ratioSamples.slice(1)),
      minimum: ratioSamples.length ? Math.min(...ratioSamples) : null,
      median: ratio,
      maximum: ratioSamples.length ? Math.max(...ratioSamples) : null,
      runs: REPEAT_COUNT
    },
    psnr,
    improvements,
    layerMeasurements: {
      scaling: layerScaling,
      zeroCopy,
      coldAttribution: isSkipped(firstLayerScaling) ? firstLayerScaling : {
        gpuInitializationMs: firstLayerScaling.gpuInitializationMs,
        firstFrameMs: firstLayerScaling.coldFirstFrameMs,
        steadyP50Ms: firstLayerScaling.steadyFrameMs.p50Ms,
        decoderFirstFrameMs: isSkipped(zeroCopy) ? null : zeroCopy.decoderFirstFrameMs,
        interpretation: 'GPU constructor, first decode, and steady-state frame wall are recorded independently; compare the three values to attribute the cold run.'
      }
    },
    outputs: {
      rawFfmpeg: isSkipped(raw)
        ? raw
        : { durationSeconds: raw.sink.durationSeconds, durationOk: Math.abs(raw.sink.durationSeconds - DURATION) <= durationTolerance },
      webCodecs: isSkipped(webCodecs)
        ? webCodecs
        : { durationSeconds: webCodecs.sink.durationSeconds, durationOk: Math.abs(webCodecs.sink.durationSeconds - DURATION) <= durationTolerance }
    }
  });
}

void run().catch(async error => {
  await window.frameBench.fail(error instanceof Error ? `${error.stack ?? error.message}` : String(error));
});
