import { MP4Clip } from '@webav/av-cliper';
import {
  ClipSessionPool,
  FrameMetrics,
  LookaheadFrameSource,
  WarmupManager,
  WebGL2Compositor,
  compareRgba,
  evaluateFrame,
} from '../../src/index.js';
import type { EvaluationPlan, NativeFrameSource } from '../../src/index.js';

interface SeekHarness {
  fixtureUrl: string;
  complete(result: unknown): Promise<boolean>;
  fail(message: string): Promise<boolean>;
}

declare global {
  interface Window { seekHarness: SeekHarness; }
}

const FPS = 30;
const FRAME_US = 1e6 / FPS;
const framePtsUs = (frameNumber: number) => Math.round(frameNumber * FRAME_US);
const frameMidpointUs = (frameNumber: number) => Math.round((frameNumber + 0.5) * FRAME_US);
const decodedFrameNumber = (frame: Pick<VideoFrame, 'timestamp'>) =>
  Math.round(frame.timestamp * FPS / 1e6);

const SourceGopTailFrames = [119, 179, 239] as const;
const MatteGopTailFrames = [119, 179, 389] as const;

const baseVisual = {
  framing: { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 },
  transform: { x: 0, y: 0, scale: 1, rotateDegrees: 0 },
  opacity: 1,
} as const;

const layerVisual = {
  crop: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
  perspective: null,
  transform: { x: 18, y: -9, scale: 0.78, rotateDegrees: 4 },
} as const;

async function renderPlan(
  plan: EvaluationPlan,
  compositor: WebGL2Compositor,
  metrics: FrameMetrics,
): Promise<Uint8Array> {
  const frame = await evaluateFrame(plan, { compositor, metrics });
  try {
    return await frame.surface.readRgba();
  } finally {
    frame.close();
  }
}

function singleLane(source: ClipSessionPool): NativeFrameSource {
  return {
    decode(timeUs, metrics) {
      return source.decode(timeUs, metrics);
    },
  };
}

export async function inspectGopTailGolden(options: {
  baseUrl: string;
  layerUrl: string;
  matteColorUrl: string;
  matteMaskUrl: string;
  output: EvaluationPlan['output'];
}) {
  const compositor = new WebGL2Compositor();
  const metrics = new FrameMetrics();
  const rows: Array<Record<string, unknown>> = [];
  const categories = [
    {
      category: 'base',
      frameNumbers: SourceGopTailFrames,
      movingUrls: [options.baseUrl],
      plan(sources: NativeFrameSource[], timeUs: number): EvaluationPlan {
        return {
          timeUs,
          base: [{ id: 'gop-base', source: sources[0]!, sourceTimeUs: timeUs, visual: baseVisual }],
          layers: [],
          output: options.output,
        };
      },
    },
    {
      category: 'layers',
      frameNumbers: SourceGopTailFrames,
      movingUrls: [options.layerUrl],
      plan(sources: NativeFrameSource[], timeUs: number): EvaluationPlan {
        return {
          timeUs,
          base: [{ id: 'gop-layer-base', source: sources[0]!, sourceTimeUs: timeUs, visual: baseVisual }],
          layers: [{
            id: 'gop-layer', kind: 'video', source: sources[0]!, sourceTimeUs: timeUs,
            mask: null, visual: layerVisual, blend: 'screen', opacity: 0.72,
          }],
          output: options.output,
        };
      },
    },
    {
      category: 'matte',
      frameNumbers: MatteGopTailFrames,
      movingUrls: [options.matteColorUrl, options.matteMaskUrl],
      plan(sources: NativeFrameSource[], timeUs: number): EvaluationPlan {
        return {
          timeUs,
          base: [{ id: 'gop-matte-base', source: sources[0]!, sourceTimeUs: timeUs, visual: baseVisual }],
          layers: [{
            id: 'gop-matte', kind: 'matte', source: sources[0]!, sourceTimeUs: timeUs,
            mask: { kind: 'greyscale', source: sources[1]!, sourceTimeUs: timeUs },
            visual: layerVisual, blend: 'normal', opacity: 1,
          }],
          output: options.output,
        };
      },
    },
  ] as const;

  try {
    for (const category of categories) {
      const sequential = category.movingUrls.map((url, index) =>
        new ClipSessionPool(`gop-${category.category}-sequential-${index}`, url));
      const reference = new Map<number, Uint8Array>();
      try {
        let advanced = -1;
        for (const frameNumber of category.frameNumbers) {
          for (let next = advanced + 1; next <= frameNumber; next += 1) {
            for (const source of sequential) {
              const frame = await source.decode(frameMidpointUs(next));
              frame.close();
            }
          }
          advanced = frameNumber;
          reference.set(frameNumber, await renderPlan(
            category.plan(sequential.map(singleLane), frameMidpointUs(frameNumber)),
            compositor,
            metrics,
          ));
        }
      } finally {
        for (const source of sequential) source.destroy();
      }

      const random = category.movingUrls.map((url, index) =>
        new ClipSessionPool(`gop-${category.category}-random-${index}`, url));
      try {
        for (const frameNumber of [...category.frameNumbers].reverse()) {
          const absolute = new ClipSessionPool(
            `gop-${category.category}-absolute-${frameNumber}`,
            category.movingUrls[0],
          );
          let actualFrameNumber: number;
          try {
            const frame = await absolute.decode(frameMidpointUs(frameNumber));
            try {
              actualFrameNumber = decodedFrameNumber(frame);
            } finally {
              frame.close();
            }
          } finally {
            absolute.destroy();
          }
          const actual = await renderPlan(
            category.plan(random.map(singleLane), frameMidpointUs(frameNumber)),
            compositor,
            metrics,
          );
          const expected = reference.get(frameNumber)!;
          const comparison = compareRgba(expected, actual);
          rows.push({
            category: category.category,
            frameNumber,
            decodedFrameNumber: actualFrameNumber,
            timeUs: frameMidpointUs(frameNumber),
            accessOrder: 'descending-random',
            ...comparison,
            pass: actualFrameNumber === frameNumber
              && comparison.differingPixels === 0
              && comparison.maxDelta === 0,
          });
        }
      } finally {
        for (const source of random) source.destroy();
      }
    }
    return {
      rows,
      pass: rows.length === 9 && rows.every(row => row.pass === true),
    };
  } finally {
    compositor.dispose();
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

async function freshDecode(frameNumber: number, targetUs: number) {
  const pool = new ClipSessionPool(`random-${frameNumber}-${targetUs}`, window.seekHarness.fixtureUrl);
  const started = performance.now();
  try {
    const frame = await pool.decode(targetUs);
    try {
      return {
        requestedFrame: frameNumber,
        targetUs,
        timestampUs: frame.timestamp,
        decodedFrame: decodedFrameNumber(frame),
        elapsedMs: performance.now() - started,
      };
    } finally {
      frame.close();
    }
  } finally {
    pool.destroy();
  }
}

async function rawDecode(frameNumber: number, targetUs: number) {
  const response = await fetch(window.seekHarness.fixtureUrl);
  if (!response.body) throw new Error('fixture body unavailable');
  const clip = new MP4Clip(response.body, { audio: false });
  try {
    await clip.ready;
    const result = await clip.tick(targetUs);
    const row = {
      requestedFrame: frameNumber,
      targetUs,
      timestampUs: result.video?.timestamp ?? null,
      decodedFrame: result.video ? decodedFrameNumber(result.video) : null,
    };
    result.video?.close();
    return row;
  } finally {
    clip.destroy();
  }
}

async function profileCold(frameNumber: number): Promise<number> {
  const result = await freshDecode(frameNumber, frameMidpointUs(frameNumber));
  if (result.decodedFrame !== frameNumber) throw new Error(`profile decoded ${result.decodedFrame}, wanted ${frameNumber}`);
  return result.elapsedMs;
}

async function profileWarmRandom(
  positions: Readonly<Record<string, number>>,
): Promise<Record<string, number[]>> {
  const pool = new ClipSessionPool('warm-random', window.seekHarness.fixtureUrl);
  const session = await pool.getSession();
  await session.load();
  const samples = Object.fromEntries(Object.keys(positions).map(position => [position, [] as number[]]));
  const entries = Object.entries(positions);
  try {
    for (let repeat = 0; repeat < 8; repeat += 1) {
      const order = [...entries.slice(repeat % entries.length), ...entries.slice(0, repeat % entries.length)];
      for (const [position, frameNumber] of order) {
        const detour = await session.decode(frameMidpointUs(0));
        detour.close();
        const started = performance.now();
        const frame = await session.decode(frameMidpointUs(frameNumber));
        const elapsedMs = performance.now() - started;
        const actual = decodedFrameNumber(frame);
        frame.close();
        if (actual !== frameNumber) throw new Error(`warm random decoded ${actual}, wanted ${frameNumber}`);
        samples[position]!.push(elapsedMs);
      }
    }
    return samples;
  } finally {
    pool.destroy();
  }
}

async function profileLookahead(frameNumber: number): Promise<{ prefetchMs: number; reachMs: number; hit: boolean }> {
  const pool = new ClipSessionPool(`lookahead-${frameNumber}-${performance.now()}`, window.seekHarness.fixtureUrl);
  let hit = false;
  const source = new LookaheadFrameSource(pool, {
    fps: FPS,
    onAccess: access => { hit = access.hit; },
  });
  const targetUs = frameMidpointUs(frameNumber);
  try {
    const prefetchStarted = performance.now();
    await source.prefetch(targetUs);
    const prefetchMs = performance.now() - prefetchStarted;
    const reachStarted = performance.now();
    const frame = await source.decode(targetUs);
    const reachMs = performance.now() - reachStarted;
    const actual = decodedFrameNumber(frame);
    frame.close();
    if (actual !== frameNumber) throw new Error(`lookahead decoded ${actual}, wanted ${frameNumber}`);
    return { prefetchMs, reachMs, hit };
  } finally {
    source.clear();
    pool.destroy();
  }
}

async function profileWarmup(frameNumber: number): Promise<{ warmupMs: number; reachMs: number }> {
  const pool = new ClipSessionPool(`warmup-${frameNumber}-${performance.now()}`, window.seekHarness.fixtureUrl);
  const session = await pool.getSession();
  const manager = new WarmupManager(1.5);
  try {
    const warmupMs = await new Promise<number>((resolve, reject) => {
      manager.maybeWarmup(0, session, frameMidpointUs(frameNumber), (_id, elapsedMs) => resolve(elapsedMs));
      window.setTimeout(() => reject(new Error('warmup callback timed out')), 15_000);
    });
    const started = performance.now();
    const frame = await session.decode(frameMidpointUs(frameNumber));
    const reachMs = performance.now() - started;
    const actual = decodedFrameNumber(frame);
    frame.close();
    if (actual !== frameNumber) throw new Error(`warmup decoded ${actual}, wanted ${frameNumber}`);
    return { warmupMs, reachMs };
  } finally {
    manager.reset();
    pool.destroy();
  }
}

async function run(): Promise<void> {
  const indexPool = new ClipSessionPool('index', window.seekHarness.fixtureUrl);
  const indexSession = await indexPool.getSession();
  await indexSession.load();
  const keyframeTimesUs = indexSession.getKeyframeTimesUs();
  const optionalReachLimit = indexSession as typeof indexSession & {
    getLastFrameStartUs?: () => number | null;
  };
  const indexedLastFrameStartUs = typeof optionalReachLimit.getLastFrameStartUs === 'function'
    ? optionalReachLimit.getLastFrameStartUs()
    : null;
  const durationUs = indexSession.meta?.duration ?? null;
  indexPool.destroy();
  if (keyframeTimesUs.length === 0) throw new Error('fixture keyframe index could not be loaded');
  if (keyframeTimesUs.length < 3) throw new Error('fixture has too few GOPs');
  if (durationUs == null || !Number.isFinite(durationUs)) throw new Error('fixture duration is unavailable');
  const legacyTailSafeLimitUs = keyframeTimesUs.at(-1)! - 1_000_000;
  const requests: Array<{ frameNumber: number; mode: 'midpoint' | 'pts'; targetUs: number }> = [];
  for (let index = 0; index < keyframeTimesUs.length - 1; index += 1) {
    const startFrame = Math.round(keyframeTimesUs[index]! * FPS / 1e6);
    const nextFrame = Math.round(keyframeTimesUs[index + 1]! * FPS / 1e6);
    for (const frameNumber of [nextFrame - 2, nextFrame - 1, nextFrame]) {
      if (frameNumber < startFrame
        || frameMidpointUs(frameNumber) > legacyTailSafeLimitUs
        || framePtsUs(frameNumber) > legacyTailSafeLimitUs) continue;
      for (const [mode, targetUs] of [
        ['midpoint', frameMidpointUs(frameNumber)],
        ['pts', framePtsUs(frameNumber)],
      ] as const) {
        requests.push({ frameNumber, mode, targetUs });
      }
    }
  }
  const finalGopStartFrame = Math.round(keyframeTimesUs.at(-1)! * FPS / 1e6);
  const finalFrameNumber = Math.round(durationUs * FPS / 1e6) - 1;
  const reachLimitUs = framePtsUs(finalFrameNumber);
  for (let frameNumber = finalGopStartFrame; frameNumber <= finalFrameNumber; frameNumber += 1) {
    for (const [mode, targetUs] of [
      ['midpoint', frameMidpointUs(frameNumber)],
      ['pts', framePtsUs(frameNumber)],
    ] as const) {
      requests.push({ frameNumber, mode, targetUs });
    }
  }
  requests.sort((left, right) => ((left.frameNumber * 17 + (left.mode === 'pts' ? 7 : 0)) % 31)
    - ((right.frameNumber * 17 + (right.mode === 'pts' ? 7 : 0)) % 31));

  const clipSession = [];
  for (const request of requests) {
    clipSession.push({ ...request, ...await freshDecode(request.frameNumber, request.targetUs) });
  }
  const rawVendor = [];
  for (const request of requests.slice(0, 20)) {
    rawVendor.push({ ...request, ...await rawDecode(request.frameNumber, request.targetUs) });
  }

  const profileFrames = {
    head: 120,
    middle: 135,
    tail: 149,
  } as const;
  const cold: Record<string, number[]> = { head: [], middle: [], tail: [] };
  for (let repeat = 0; repeat < 8; repeat += 1) {
    for (const [position, frameNumber] of Object.entries(profileFrames)) {
      cold[position]!.push(await profileCold(frameNumber));
    }
  }
  const warm = await profileWarmRandom(profileFrames);
  const summarize = (values: readonly number[]) => ({
    samples: values,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  });
  const lookahead = [];
  const warmup = [];
  for (let repeat = 0; repeat < 8; repeat += 1) {
    lookahead.push(await profileLookahead(profileFrames.tail));
    warmup.push(await profileWarmup(profileFrames.tail));
  }
  const pass = clipSession.length > 0
    && clipSession.every(row => row.decodedFrame === row.frameNumber)
    && clipSession.filter(row => row.requestedFrame === finalFrameNumber).length === 2
    && lookahead.every(row => row.hit);
  await window.seekHarness.complete({
    pass,
    fps: FPS,
    keyframeTimesUs,
    reachLimitUs,
    indexedLastFrameStartUs,
    legacyTailSafeLimitUs,
    finalFrameNumber,
    requestCount: requests.length,
    clipSession,
    rawVendor,
    performance: {
      cold: Object.fromEntries(Object.entries(cold).map(([position, values]) => [position, summarize(values)])),
      warm: Object.fromEntries(Object.entries(warm).map(([position, values]) => [position, summarize(values)])),
      lookahead: {
        prefetch: summarize(lookahead.map(row => row.prefetchMs)),
        reach: summarize(lookahead.map(row => row.reachMs)),
        hits: lookahead.filter(row => row.hit).length,
      },
      warmup: {
        warmup: summarize(warmup.map(row => row.warmupMs)),
        reach: summarize(warmup.map(row => row.reachMs)),
      },
    },
  });
}

if ('seekHarness' in window) {
  void run().catch(async error => {
    await window.seekHarness.fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
  });
}
