import { ClipSession } from '../../src/index.js';

export const B_FRAME_VARIANTS = [
  { id: 'bf0-30', file: 'bframe-bf0-30.mp4', bFrames: 0, reorderFrames: 0, fps: 30 },
  { id: 'bf1-30', file: 'bframe-bf1-30.mp4', bFrames: 1, reorderFrames: 1, fps: 30 },
  { id: 'bf2-30', file: 'bframe-bf2-30.mp4', bFrames: 2, reorderFrames: 2, fps: 30 },
  { id: 'bf3-30', file: 'bframe-bf3-30.mp4', bFrames: 3, reorderFrames: 2, fps: 30 },
  { id: 'bf2-60', file: 'bframe-bf2-60.mp4', bFrames: 2, reorderFrames: 2, fps: 60 },
] as const;

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
