import type { CompositedFrame, RawFrameSink } from '../types.js';

/** Export exit: PBO-read the completed surface and hand the unchanged RGBA bytes to a sink. */
export async function readbackFrame(
  frame: CompositedFrame,
  sink: RawFrameSink
): Promise<void> {
  const rgba = await frame.surface.readRgba();
  const sinkStarted = performance.now();
  await sink.write(rgba, frame);
  frame.surface.recordSink(performance.now() - sinkStarted);
}

export class BufferedRawFrameSink implements RawFrameSink {
  readonly frames: Array<{ timeUs: number; rgba: Uint8Array }> = [];

  write(rgba: Uint8Array, frame: Pick<CompositedFrame, 'timeUs'>): void {
    this.frames.push({ timeUs: frame.timeUs, rgba: rgba.slice() });
  }
}
