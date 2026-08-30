import { ClipSession } from '../../src/index.js';

export const B_FRAME_VARIANTS = [
  { id: 'bf0-30', file: 'bframe-bf0-30.mp4', bFrames: 0, reorderFrames: 0, fps: 30 },
  { id: 'bf1-30', file: 'bframe-bf1-30.mp4', bFrames: 1, reorderFrames: 1, fps: 30 },
  { id: 'bf2-30', file: 'bframe-bf2-30.mp4', bFrames: 2, reorderFrames: 2, fps: 30 },
  { id: 'bf3-30', file: 'bframe-bf3-30.mp4', bFrames: 3, reorderFrames: 2, fps: 30 },
  { id: 'bf2-60', file: 'bframe-bf2-60.mp4', bFrames: 2, reorderFrames: 2, fps: 60 },
] as const;

const B_FRAME_TAIL_VARIANTS = [
  { id: 'tail-bf2-30', file: 'bframe-tail-bf2-30.mp4', bFrames: 2, hasAudio: false, fps: 30 },
  { id: 'tail-bf0-30', file: 'bframe-tail-bf0-30.mp4', bFrames: 0, hasAudio: false, fps: 30 },
  { id: 'tail-bf2-30-aac', file: 'bframe-tail-bf2-30-aac.mp4', bFrames: 2, hasAudio: true, fps: 30 },
  { id: 'tail-bf0-30-aac', file: 'bframe-tail-bf0-30-aac.mp4', bFrames: 0, hasAudio: true, fps: 30 },
] as const;
const B_FRAME_TAIL_TARGETS = [0, 1, 180, 357, 358, 359] as const;
const ENDPOINT_VARIANTS = [
  { id: 'endpoint-bf0-24', file: 'endpoint-bf0-24.mp4', bFrames: 0 },
  { id: 'endpoint-bf2-24', file: 'endpoint-bf2-24.mp4', bFrames: 2 },
] as const;

declare global {
  var __AKARI_FRAME_ENGINE_SOURCE__: string | undefined;
}

type Coverage = 'full' | 'sampled';

const frameMidpointUs = (frameNumber: number, fps: number) =>
  Math.round(((frameNumber + 0.5) / fps) * 1e6);

function frameTargets(frameCount: number, fps: number, coverage: Coverage): number[] {
  if (coverage === 'full') return Array.from({ length: frameCount }, (_value, index) => index);
  const gop = fps / 2;
  const targets = new Set<number>();
  for (let start = 0; start < frameCount; start += gop) {
    for (const offset of [0, 1, gop - 2, gop - 1]) targets.add(start + offset);
  }
  return [...targets].filter(frame => frame >= 0 && frame < frameCount).sort((a, b) => a - b);
}

function randomizedFrames(frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_value, index) => (index * 37) % frameCount);
}

class FrameNumberReader {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = 320;
    this.canvas.height = 180;
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('B-frame number canvas unavailable');
    this.context = context;
  }

  read(frame: VideoFrame): number {
    this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      const pixel = this.context.getImageData(bit * 40 + 20, 90, 1, 1).data;
      if (pixel[0]! + pixel[1]! + pixel[2]! > 128 * 3) value |= 1 << bit;
    }
    return value;
  }
}

class TailFrameNumberReader {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = 320;
    this.canvas.height = 180;
    const context = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('B-frame tail number canvas unavailable');
    this.context = context;
  }

  read(frame: VideoFrame): number {
    this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    let value = 0;
    for (let bit = 0; bit < 16; bit += 1) {
      const pixel = this.context.getImageData(bit * 20 + 10, 90, 1, 1).data;
      if (pixel[0]! + pixel[1]! + pixel[2]! > 128 * 3) value |= 1 << bit;
    }
    return value;
  }
}

async function inspectFrame(
  session: ClipSession,
  reader: FrameNumberReader,
  variant: (typeof B_FRAME_VARIANTS)[number],
  mode: 'sequential' | 'random',
  requestedFrame: number,
) {
  const frame = await session.decode(frameMidpointUs(requestedFrame, variant.fps));
  try {
    const decodedFrame = reader.read(frame);
    const timestampFrame = Math.round(frame.timestamp * variant.fps / 1e6);
    return {
      variant: variant.id,
      bFrames: variant.bFrames,
      reorderFrames: variant.reorderFrames,
      fps: variant.fps,
      mode,
      requestedFrame,
      decodedFrame,
      timestampFrame,
      timestampUs: frame.timestamp,
      durationUs: frame.duration,
      pass: decodedFrame === requestedFrame && timestampFrame === requestedFrame,
    };
  } finally {
    frame.close();
  }
}

export async function inspectBFrameAccess(
  fixtureRootUrl: string,
  coverage: Coverage,
) {
  const reader = new FrameNumberReader();
  const rows: Array<Awaited<ReturnType<typeof inspectFrame>>> = [];
  const offsets: Array<{
    variant: string;
    expectedUs: number;
    actualUs: number;
    durationUs: number | null;
    pass: boolean;
  }> = [];

  for (const variant of B_FRAME_VARIANTS) {
    const frameCount = variant.fps * 2;
    const targets = frameTargets(frameCount, variant.fps, coverage);
    const targetSet = new Set(targets);
    const source = new URL(variant.file, fixtureRootUrl).href;
    const sequential = new ClipSession(`bframe-${variant.id}-sequential`, source);
    try {
      await sequential.load();
      const expectedUs = Math.round((variant.reorderFrames / variant.fps) * 1e6);
      const actualUs = sequential.getDecoderTimestampOffsetUs();
      const durationUs = sequential.meta?.duration ?? null;
      offsets.push({
        variant: variant.id,
        expectedUs,
        actualUs,
        durationUs,
        pass: actualUs === expectedUs
          && durationUs != null
          && Math.abs(durationUs - 2_000_000) <= 1e6 / variant.fps,
      });
      for (let frameNumber = 0; frameNumber < frameCount; frameNumber += 1) {
        const row = await inspectFrame(sequential, reader, variant, 'sequential', frameNumber);
        if (targetSet.has(frameNumber)) rows.push(row);
      }
    } finally {
      sequential.destroy();
    }

    const random = new ClipSession(`bframe-${variant.id}-random`, source);
    try {
      for (const frameNumber of randomizedFrames(frameCount)) {
        if (!targetSet.has(frameNumber)) continue;
        rows.push(await inspectFrame(random, reader, variant, 'random', frameNumber));
      }
    } finally {
      random.destroy();
    }
  }

  const summaries = B_FRAME_VARIANTS.flatMap(variant =>
    (['sequential', 'random'] as const).map(mode => {
      const selected = rows.filter(row => row.variant === variant.id && row.mode === mode);
      return {
        variant: variant.id,
        bFrames: variant.bFrames,
        fps: variant.fps,
        mode,
        requests: selected.length,
        mismatches: selected.filter(row => !row.pass).length,
      };
    }));
  const expectedRows = B_FRAME_VARIANTS.reduce(
    (sum, variant) => sum + frameTargets(variant.fps * 2, variant.fps, coverage).length * 2,
    0,
  );
  return {
    coverage,
    expectedRows,
    rows,
    offsets,
    summaries,
    pass: rows.length === expectedRows
      && rows.every(row => row.pass)
      && offsets.every(offset => offset.pass)
      && summaries.every(summary => summary.requests > 0 && summary.mismatches === 0),
  };
}

export async function inspectBFrameTailAccess(fixtureRootUrl: string) {
  const reader = new TailFrameNumberReader();
  const rows: Array<Record<string, unknown>> = [];

  for (const variant of B_FRAME_TAIL_VARIANTS) {
    const source = new URL(variant.file, fixtureRootUrl).href;
    const session = new ClipSession(`bframe-${variant.id}`, source);
    try {
      for (const requestedFrame of B_FRAME_TAIL_TARGETS) {
        const requestedPtsUs = Math.round((requestedFrame / variant.fps) * 1e6);
        const frame = await session.decode(requestedPtsUs);
        try {
          const decodedFrame = reader.read(frame);
          const timestampFrame = Math.round(frame.timestamp * variant.fps / 1e6);
          rows.push({
            variant: variant.id,
            bFrames: variant.bFrames,
            hasAudio: variant.hasAudio,
            requestedFrame,
            requestedPtsUs,
            decodedFrame,
            timestampFrame,
            timestampUs: frame.timestamp,
            pass: decodedFrame === requestedFrame && timestampFrame === requestedFrame,
          });
        } finally {
          frame.close();
        }
      }
    } finally {
      session.destroy();
    }
  }

  return {
    rows,
    pass: rows.length === B_FRAME_TAIL_VARIANTS.length * B_FRAME_TAIL_TARGETS.length
      && rows.every(row => row.pass === true),
  };
}

export async function inspectEndpointTailAccess(fixtureRootUrl: string) {
  const reader = new TailFrameNumberReader();
  const rows: Array<Record<string, unknown>> = [];
  const previousMode = globalThis.__AKARI_FRAME_ENGINE_SOURCE__;
  try {
    for (const variant of ENDPOINT_VARIANTS) {
      const source = new URL(variant.file, fixtureRootUrl).href;
      for (const sourceMode of ['range', 'mp4clip'] as const) {
        globalThis.__AKARI_FRAME_ENGINE_SOURCE__ = sourceMode;
        for (const condition of [
          { id: 'hardware-default', hardwareAcceleration: undefined },
          { id: 'software', hardwareAcceleration: 'prefer-software' as const },
        ]) {
          const session = new ClipSession(
            `${variant.id}:${sourceMode}:${condition.id}`,
            source,
            { hardwareAcceleration: condition.hardwareAcceleration },
          );
          try {
            await session.load();
            const lastFrameStartUs = session.getLastFrameStartUs();
            const durationUs = session.meta?.duration ?? null;
            if (lastFrameStartUs == null || durationUs == null) {
              throw new Error(`${variant.id} endpoint metadata unavailable`);
            }
            const targets = [
              { kind: 'last-start', timeUs: lastFrameStartUs },
              { kind: 'half-frame', timeUs: lastFrameStartUs + Math.floor(1e6 / 48) },
              { kind: 'duration-minus-one', timeUs: durationUs - 1 },
            ] as const;
            for (const target of targets) {
              const frame = await session.decode(target.timeUs);
              try {
                const decodedFrame = reader.read(frame);
                rows.push({
                  variant: variant.id,
                  bFrames: variant.bFrames,
                  sourceMode,
                  condition: condition.id,
                  target: target.kind,
                  targetUs: target.timeUs,
                  lastFrameStartUs,
                  durationUs,
                  decodedFrame,
                  timestampUs: frame.timestamp,
                  pass: decodedFrame === 248 && frame.timestamp === lastFrameStartUs,
                });
              } finally {
                frame.close();
              }
            }
          } finally {
            session.destroy();
          }
        }
      }
    }
  } finally {
    globalThis.__AKARI_FRAME_ENGINE_SOURCE__ = previousMode;
  }
  return {
    rows,
    pass: rows.length === ENDPOINT_VARIANTS.length * 2 * 2 * 3
      && rows.every(row => row.pass === true),
  };
}
