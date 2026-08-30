import './tail-decoder-probe.js';
import { ClipSessionPool } from '../../src/index.js';
import {
  resetTailDecoderProbe,
  snapshotTailDecoders,
  tailDecoderTotals,
  type TailDecoderSnapshot,
} from './tail-decoder-probe.js';

interface StressHarness {
  fixtures: {
    source: string;
    bframeTail: string;
    bframe: string;
  };
  options: {
    trials: number;
    concurrency: number;
  };
  complete(result: unknown): Promise<boolean>;
  fail(message: string): Promise<boolean>;
}

interface FinderTracePayload {
  reason: string;
  at: number;
  [key: string]: unknown;
}

interface FinderTraceEntry extends FinderTracePayload {
  seq: number;
}

declare global {
  interface Window { stressHarness: StressHarness; }
  var __akariFinderTrace: ((payload: FinderTracePayload) => void) | undefined;
}

interface FixtureSpec {
  name: 'source.mp4' | 'bframe-tail-bf2-30.mp4' | 'bframe-bf2-30.mp4';
  url: string;
  frameCount: number;
}

interface Target {
  frameNumber: number;
  mode: 'midpoint' | 'pts';
  targetUs: number;
}

interface TrialRequest extends Target {
  trial: number;
  fixture: FixtureSpec;
}

interface TrialRow {
  trial: number;
  fixture: FixtureSpec['name'];
  requestedFrame: number;
  mode: Target['mode'];
  targetUs: number;
  ok: boolean;
  elapsedMs: number;
  decodedFrame: number | null;
  timestampUs: number | null;
  error?: string;
  decoders?: TailDecoderSnapshot[];
  lastFrameStartUs?: number | null;
  lastKeyframeTimeUs?: number | null;
  durationUs?: number | null;
  warnings?: string[];
  finderTrace?: FinderTraceEntry[];
}

const FPS = 30;
const FINDER_TRACE_LIMIT = 4000;
const FINDER_TRACE_ROW_LIMIT = 60;
const finderTrace: FinderTraceEntry[] = [];
const finderTraceReasonCounts = new Map<string, number>();
let finderTraceSeq = 0;
const framePtsUs = (frameNumber: number) => Math.round(frameNumber / FPS * 1e6);
const frameMidpointUs = (frameNumber: number) => Math.round((frameNumber + 0.5) / FPS * 1e6);
const decodedFrameNumber = (frame: Pick<VideoFrame, 'timestamp'>) =>
  Math.round(frame.timestamp * FPS / 1e6);

function targetsFor(frameCount: number): Target[] {
  const frameNumbers = new Set<number>();
  for (let frameNumber = 29; frameNumber < frameCount; frameNumber += 30) {
    frameNumbers.add(frameNumber);
  }
  for (let frameNumber = frameCount - 3; frameNumber < frameCount; frameNumber += 1) {
    frameNumbers.add(frameNumber);
  }
  return [...frameNumbers].sort((left, right) => left - right).map((frameNumber, index) => {
    const mode = index % 2 === 0 ? 'midpoint' : 'pts';
    return {
      frameNumber,
      mode,
      targetUs: mode === 'midpoint' ? frameMidpointUs(frameNumber) : framePtsUs(frameNumber),
    };
  });
}

function fullError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function finderTraceForWindow(started: number, ended: number): FinderTraceEntry[] {
  return finderTrace
    .filter(entry => entry.at >= started && entry.at <= ended)
    .slice(-FINDER_TRACE_ROW_LIMIT);
}

function countTraceReasons(entries: readonly FinderTraceEntry[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return Object.fromEntries(counts);
}

async function failureSessionState(pool: ClipSessionPool): Promise<{
  lastFrameStartUs: number | null;
  lastKeyframeTimeUs: number | null;
  durationUs: number | null;
}> {
  try {
    const session = await pool.getSession();
    let lastFrameStartUs: number | null = null;
    let lastKeyframeTimeUs: number | null = null;
    let durationUs: number | null = null;
    try { lastFrameStartUs = session.getLastFrameStartUs(); } catch { /* 計測失敗は null で残す。 */ }
    try { lastKeyframeTimeUs = session.getKeyframeTimesUs().at(-1) ?? null; } catch { /* 同上。 */ }
    try { durationUs = session.meta?.duration ?? null; } catch { /* 同上。 */ }
    return { lastFrameStartUs, lastKeyframeTimeUs, durationUs };
  } catch {
    return { lastFrameStartUs: null, lastKeyframeTimeUs: null, durationUs: null };
  }
}

async function runTrial(request: TrialRequest): Promise<TrialRow> {
  const started = performance.now();
  const warnings: string[] = [];
  const pool = new ClipSessionPool(
    `tail-stress-${request.trial}-${request.fixture.name}-${request.frameNumber}-${request.mode}`,
    request.fixture.url,
    { onWarning: message => warnings.push(message) },
  );
  let decodedFrame: number | null = null;
  let timestampUs: number | null = null;
  let error: string | undefined;
  try {
    const frame = await pool.decode(request.targetUs);
    try {
      timestampUs = frame.timestamp;
      decodedFrame = decodedFrameNumber(frame);
    } finally {
      frame.close();
    }
    if (decodedFrame !== request.frameNumber) {
      error = `decoded frame ${decodedFrame}, wanted ${request.frameNumber} at ${request.targetUs}us`;
    }
  } catch (caught) {
    error = fullError(caught);
  }
  const ended = performance.now();

  const row: TrialRow = {
    trial: request.trial,
    fixture: request.fixture.name,
    requestedFrame: request.frameNumber,
    mode: request.mode,
    targetUs: request.targetUs,
    ok: error == null,
    elapsedMs: ended - started,
    decodedFrame,
    timestampUs,
  };
  try {
    if (error != null) {
      const sessionState = await failureSessionState(pool);
      row.error = error;
      row.decoders = snapshotTailDecoders();
      row.lastFrameStartUs = sessionState.lastFrameStartUs;
      row.lastKeyframeTimeUs = sessionState.lastKeyframeTimeUs;
      row.durationUs = sessionState.durationUs;
      row.warnings = warnings;
      row.finderTrace = finderTraceForWindow(started, ended);
    }
    return row;
  } finally {
    pool.destroy();
  }
}

function makeRequests(fixtures: readonly FixtureSpec[], trials: number): TrialRequest[] {
  const targets = new Map(fixtures.map(fixture => [fixture.name, targetsFor(fixture.frameCount)]));
  return Array.from({ length: trials }, (_value, trial) => {
    const fixture = fixtures[trial % fixtures.length]!;
    const fixtureTargets = targets.get(fixture.name)!;
    const target = fixtureTargets[Math.floor(trial / fixtures.length) % fixtureTargets.length]!;
    return { trial, fixture, ...target };
  });
}

function batchSizes(trials: number, concurrency: number): number[] {
  const sizes: number[] = [];
  let remaining = trials;
  while (remaining > 0) {
    let size = Math.min(concurrency, remaining);
    if (remaining - size === 1 && size > 2) size -= 1;
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

async function run(): Promise<void> {
  finderTrace.length = 0;
  finderTraceReasonCounts.clear();
  finderTraceSeq = 0;
  globalThis.__akariFinderTrace = payload => {
    finderTrace.push({ seq: finderTraceSeq++, ...payload });
    if (finderTrace.length > FINDER_TRACE_LIMIT) {
      finderTrace.splice(0, finderTrace.length - FINDER_TRACE_LIMIT);
    }
    finderTraceReasonCounts.set(payload.reason, (finderTraceReasonCounts.get(payload.reason) ?? 0) + 1);
  };
  const trials = window.stressHarness.options.trials;
  const concurrency = window.stressHarness.options.concurrency;
  if (!Number.isInteger(trials) || trials < 2) throw new Error(`trials must be an integer >= 2: ${trials}`);
  if (!Number.isInteger(concurrency) || concurrency < 2) {
    throw new Error(`concurrency must be an integer >= 2: ${concurrency}`);
  }
  resetTailDecoderProbe();
  const fixtures: FixtureSpec[] = [
    { name: 'source.mp4', url: window.stressHarness.fixtures.source, frameCount: 240 },
    { name: 'bframe-tail-bf2-30.mp4', url: window.stressHarness.fixtures.bframeTail, frameCount: 360 },
    { name: 'bframe-bf2-30.mp4', url: window.stressHarness.fixtures.bframe, frameCount: 60 },
  ];
  const requests = makeRequests(fixtures, trials);
  const rows: TrialRow[] = [];
  let offset = 0;
  for (const size of batchSizes(trials, concurrency)) {
    const batch = requests.slice(offset, offset + size);
    offset += size;
    const settled = await Promise.allSettled(batch.map(runTrial));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        rows.push(result.value);
        return;
      }
      const request = batch[index]!;
      rows.push({
        trial: request.trial,
        fixture: request.fixture.name,
        requestedFrame: request.frameNumber,
        mode: request.mode,
        targetUs: request.targetUs,
        ok: false,
        elapsedMs: 0,
        decodedFrame: null,
        timestampUs: null,
        error: fullError(result.reason),
        decoders: snapshotTailDecoders(),
        lastFrameStartUs: null,
        lastKeyframeTimeUs: null,
        durationUs: null,
        warnings: [],
      });
    });
  }

  rows.sort((left, right) => left.trial - right.trial);
  const failureDetail = rows.filter(row => !row.ok);
  const failureWindowEntries = new Map<number, FinderTraceEntry>();
  for (const row of failureDetail) {
    for (const entry of row.finderTrace ?? []) failureWindowEntries.set(entry.seq, entry);
  }
  const traceSummary = {
    all: Object.fromEntries(finderTraceReasonCounts),
    failureWindows: countTraceReasons([...failureWindowEntries.values()]),
  };
  const byFixture = Object.fromEntries(fixtures.map(fixture => {
    const fixtureRows = rows.filter(row => row.fixture === fixture.name);
    return [fixture.name, {
      trials: fixtureRows.length,
      failures: fixtureRows.filter(row => !row.ok).length,
    }];
  }));
  await window.stressHarness.complete({
    pass: failureDetail.length === 0,
    trials,
    concurrency,
    failures: failureDetail.length,
    byFixture,
    totals: tailDecoderTotals(),
    traceSummary,
    rows,
    failureDetail,
  });
}

if ('stressHarness' in window) {
  void run().catch(async error => {
    await window.stressHarness.fail(fullError(error));
  });
}
