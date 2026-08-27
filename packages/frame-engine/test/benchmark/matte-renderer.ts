import { ClipSessionPool, FrameMetrics } from '../../src/index.js';

declare global {
  interface Window {
    matteBenchmark: {
      complete(result: unknown): Promise<boolean>;
      fail(message: string): Promise<boolean>;
    };
  }
}

const FPS = 30;
const FRAMES = 900;
const colorUrl = 'frame-engine-matte://fixture/color.mp4';
const alphaUrl = 'frame-engine-matte://fixture/alpha.webm';
const maskUrl = 'frame-engine-matte://fixture/mask.mp4';

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function summarize(values: readonly number[]) {
  return {
    frames: values.length,
    meanMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

async function withTimeout<T>(name: string, milliseconds: number, operation: () => Promise<T>) {
  let timeout = 0;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = window.setTimeout(() => reject(new Error(`${name} timed out after ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function phase<T>(name: string, milliseconds: number, operation: () => Promise<T>) {
  try {
    return { skipped: false as const, ...(await withTimeout(name, milliseconds, operation)) };
  } catch (error) {
    return { skipped: true as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function measureV2() {
  const warnings: string[] = [];
  const seekActivity = { backwardRequests: 0, decoderRuntimeErrors: 0, softwareFallbacks: 0 };
  const onWarning = (warning: string) => {
    warnings.push(warning);
    if (/decoder runtime error/iu.test(warning)) seekActivity.decoderRuntimeErrors += 1;
    if (/software decoder fallback/iu.test(warning)) seekActivity.softwareFallbacks += 1;
  };
  const color = new ClipSessionPool('matte-bench-color', colorUrl, { onWarning });
  const mask = new ClipSessionPool('matte-bench-mask', maskUrl, { onWarning });
  const metrics = new FrameMetrics();
  const wallSamples: number[] = [];
  const lastRequests = new Map<string, number>();
  let completedRequests = 0;
  let failedRequests = 0;
  const decode = async (source: ClipSessionPool, streamId: string, timeUs: number) => {
    const previous = lastRequests.get(streamId);
    if (previous != null && timeUs < previous) seekActivity.backwardRequests += 1;
    lastRequests.set(streamId, timeUs);
    const started = performance.now();
    try {
      const frame = await source.decode(timeUs, metrics, { streamId });
      completedRequests += 1;
      return frame;
    } catch (error) {
      failedRequests += 1;
      warnings.push(`${streamId} request ${timeUs}us failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      metrics.record('decode', performance.now() - started);
    }
  };
  try {
    for (let frameNumber = 0; frameNumber < FRAMES; frameNumber += 1) {
      const timeUs = Math.round(((frameNumber + 0.5) / FPS) * 1e6);
      const started = performance.now();
      const [colorFrame, maskFrame] = await Promise.all([
        decode(color, 'color', timeUs),
        decode(mask, 'mask', timeUs),
      ]);
      wallSamples.push(performance.now() - started);
      colorFrame?.close();
      maskFrame?.close();
    }
  } finally {
    color.destroy();
    mask.destroy();
  }
  return {
    codecs: ['h264', 'h264'],
    decodeStage: metrics.toJSON().decode,
    wallPerFrame: summarize(wallSamples),
    coldWallMs: wallSamples[0] ?? null,
    steadyWallPerFrame: summarize(wallSamples.slice(1)),
    seekActivity,
    seekOperations: seekActivity.backwardRequests + seekActivity.decoderRuntimeErrors,
    playbackQuality: {
      totalVideoFrames: completedRequests,
      droppedVideoFrames: failedRequests,
    },
    warnings,
  };
}

async function measureCurrent(mode: 'tolerant' | 'strict') {
  const videos = [document.createElement('video'), document.createElement('video')];
  const samples: number[] = [];
  let seekEvents = 0;
  let currentTimeAssignments = 0;
  for (const video of videos) {
    video.muted = true;
    video.preload = 'auto';
    video.src = alphaUrl;
    video.addEventListener('seeking', () => { seekEvents += 1; });
    document.body.append(video);
  }
  await Promise.all(videos.map(video => new Promise<void>((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }
    video.addEventListener('canplay', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('VP9 alpha video failed to load')), { once: true });
  })));
  for (const video of videos) {
    const callback = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      const processingDuration = metadata.processingDuration;
      if (Number.isFinite(processingDuration)) samples.push((processingDuration ?? 0) * 1000);
      if (!video.paused && !video.ended) video.requestVideoFrameCallback(callback);
    };
    video.requestVideoFrameCallback(callback);
  }
  const started = performance.now();
  await Promise.all(videos.map(video => video.play()));
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      const target = Math.min(29.99, (performance.now() - started) / 1000);
      for (const video of videos) {
        if (mode === 'strict' || Math.abs(video.currentTime - target) > 1 / FPS) {
          video.currentTime = target;
          currentTimeAssignments += 1;
        }
      }
      if (target >= 29.99) {
        window.clearInterval(timer);
        resolve();
      }
    }, 1000 / FPS);
  });
  const qualities = videos.map(video => video.getVideoPlaybackQuality());
  for (const video of videos) {
    video.pause();
    video.remove();
  }
  return {
    mode,
    codecs: ['vp9-alpha', 'vp9-alpha'],
    uaProcessingDuration: summarize(samples),
    coldProcessingDurationMs: samples[0] ?? null,
    steadyProcessingDuration: summarize(samples.slice(1)),
    currentTimeAssignments,
    seekingEvents: seekEvents,
    playbackQuality: {
      totalVideoFrames: qualities.reduce((sum, quality) => sum + quality.totalVideoFrames, 0),
      droppedVideoFrames: qualities.reduce((sum, quality) => sum + quality.droppedVideoFrames, 0),
      videos: qualities.map(quality => ({
        totalVideoFrames: quality.totalVideoFrames,
        droppedVideoFrames: quality.droppedVideoFrames,
      })),
    },
  };
}

async function run() {
  const v2 = await phase('v2 H.264 decode', 90_000, measureV2);
  const tolerant = await phase('current VP9 alpha tolerant playback', 45_000, () => measureCurrent('tolerant'));
  const strict = await phase('current VP9 alpha strict playback', 45_000, () => measureCurrent('strict'));
  await window.matteBenchmark.complete({
    pass: !v2.skipped,
    frames: FRAMES,
    seconds: FRAMES / FPS,
    v2,
    current: { tolerant, strict },
  });
}

void run().catch(error => window.matteBenchmark.fail(error instanceof Error ? error.stack ?? error.message : String(error)));
