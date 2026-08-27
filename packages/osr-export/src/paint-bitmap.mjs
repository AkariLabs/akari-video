export function readPaintBitmap(image, width, height, frame) {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return { empty: true, bitmap: null, toBitmapMs: 0 };
  const bitmapStarted = performance.now();
  const bitmap = image.toBitmap();
  const toBitmapMs = performance.now() - bitmapStarted;
  if (bitmap.length === 0) return { empty: true, bitmap: null, toBitmapMs };
  if (size.width !== width || size.height !== height + 1) {
    throw new Error(`frame ${frame} bitmap size ${size.width}x${size.height}, expected ${width}x${height + 1}; Electron の実プロセスへ --force-device-scale-factor=1 を渡してください`);
  }
  if (bitmap.length !== width * (height + 1) * 4) {
    throw new Error(`frame ${frame} bitmap byte length mismatch`);
  }
  return { empty: false, bitmap, toBitmapMs };
}

export async function captureNonEmptyBitmap({
  frame,
  width,
  height,
  capture,
  settle,
  onEmpty = () => {},
  maximumEmptyAttempts = 8,
}) {
  let emptyAttempts = 0;
  let paintMs = 0;
  let settleMs = 0;
  let toBitmapMs = 0;
  while (emptyAttempts < maximumEmptyAttempts) {
    const paintStarted = performance.now();
    const image = await capture();
    paintMs += performance.now() - paintStarted;
    const result = readPaintBitmap(image, width, height, frame);
    toBitmapMs += result.toBitmapMs;
    if (!result.empty) return { bitmap: result.bitmap, emptyAttempts, paintMs: paintMs + settleMs, toBitmapMs };
    emptyAttempts += 1;
    onEmpty(frame);
    if (emptyAttempts < maximumEmptyAttempts) {
      const settleStarted = performance.now();
      await settle();
      settleMs += performance.now() - settleStarted;
    }
  }
  throw new Error(`frame ${frame}: offscreen paint returned an empty bitmap ${emptyAttempts} times`);
}
