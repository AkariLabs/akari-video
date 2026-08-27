import type { CompositedFrame } from '../types.js';

/** Preview exit: consume an already-completed surface without evaluating the timeline again. */
export function presentFrame(frame: CompositedFrame, canvas: HTMLCanvasElement): void {
  if (canvas.width !== frame.surface.width) canvas.width = frame.surface.width;
  if (canvas.height !== frame.surface.height) canvas.height = frame.surface.height;
  // Golden/readback presentation keeps CPU backing; live WebGL presentation bypasses this copy.
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('2D preview canvas is unavailable');
  context.drawImage(frame.surface.canvas, 0, 0);
}

export function capturePresentedRgba(canvas: HTMLCanvasElement): Uint8Array {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('2D preview canvas is unavailable');
  return new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
