import type { CompositedFrame } from '../types.js';

/** Preview exit: consume an already-completed surface without evaluating the timeline again. */
export function presentFrame(frame: CompositedFrame, canvas: HTMLCanvasElement): void {
  canvas.width = frame.surface.width;
  canvas.height = frame.surface.height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('2D preview canvas is unavailable');
  context.drawImage(frame.surface.canvas, 0, 0);
}

export function capturePresentedRgba(canvas: HTMLCanvasElement): Uint8Array {
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('2D preview canvas is unavailable');
  return new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
