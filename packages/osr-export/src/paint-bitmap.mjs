/**
 * Offscreen window viewport pinning + fail-closed bitmap size check.
 *
 * Windows clamps a hidden BrowserWindow to the display *work area* when it is created (1920x1081
 * became 1920x1032 on a 1920x1080 display with a 48 px taskbar) and the offscreen paint bitmap
 * follows the window content size, so the first frame failed with
 * `bitmap size 1920x1032, expected 1920x1081`. The helpers below are electron-free so the
 * matching / emulation parameters / failure message can be unit-tested:
 * - `osrPageSize` is the page size the offscreen window must have (output + 1 px stamp row).
 * - `viewportMatches` compares a measurement with the requested page size (and DPR 1).
 * - `deviceEmulationParameters` builds the `webContents.enableDeviceEmulation` argument.
 * - `viewportRecord` is the run.json / receipt `viewport` record (snake_case `work_area`).
 * - `bitmapSizeMismatchMessage` names requested / measured / primary display / work area; the
 *   `--force-device-scale-factor=1` hint is only appended when devicePixelRatio is not 1.
 */
export function osrPageSize(width, height) {
  return { width: Number(width), height: Number(height) + 1 };
}

export function viewportMatches(requested, measured) {
  return Number(measured?.width) === Number(requested?.width)
    && Number(measured?.height) === Number(requested?.height)
    && Number(measured?.devicePixelRatio ?? 1) === 1;
}

export function deviceEmulationParameters({ width, height }) {
  return {
    screenPosition: "desktop",
    screenSize: { width, height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width, height },
    deviceScaleFactor: 1,
    scale: 1,
  };
}

export function viewportRecord({ requested, measured, emulated = false, display = null, workArea = null }) {
  return {
    requested: sizeRecord(requested),
    measured: sizeRecord(measured),
    emulated: Boolean(emulated),
    display: sizeRecord(display),
    work_area: sizeRecord(workArea),
  };
}

export function bitmapSizeMismatchMessage({
  frame,
  requested,
  measured,
  display = null,
  workArea = null,
  devicePixelRatio = 1,
  resized = false,
  emulated = false,
}) {
  const dpr = Number(devicePixelRatio ?? 1);
  const applied = `setContentSize ${resized ? "適用" : "未適用"} / device emulation ${emulated ? "適用" : "未適用"}`;
  let message = `frame ${frame} bitmap size ${describeSize(measured)}, expected ${describeSize(requested)}; `
    + `requested ${describeSize(requested)}, measured ${describeSize(measured)}, `
    + `primary display ${describeSize(display)}, work area ${describeSize(workArea)}; `
    + `オフスクリーン窓の bitmap を出力寸法 + stamp 行 1 px に固定できませんでした（${applied}）`;
  if (Number.isFinite(dpr) && dpr !== 1) {
    message += `; devicePixelRatio ${dpr} — Electron の実プロセスへ --force-device-scale-factor=1 を渡してください`;
  }
  return message;
}

function sizeRecord(size) {
  return { width: Number(size?.width), height: Number(size?.height) };
}

function describeSize(size) {
  const { width, height } = sizeRecord(size);
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : "unknown";
}

export function readPaintBitmap(image, width, height, frame, viewport = null) {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) return { empty: true, bitmap: null, toBitmapMs: 0 };
  const bitmapStarted = performance.now();
  const bitmap = image.toBitmap();
  const toBitmapMs = performance.now() - bitmapStarted;
  if (bitmap.length === 0) return { empty: true, bitmap: null, toBitmapMs };
  if (size.width !== width || size.height !== height + 1) {
    throw new Error(bitmapSizeMismatchMessage({
      frame,
      requested: osrPageSize(width, height),
      measured: size,
      display: viewport?.display ?? null,
      workArea: viewport?.work_area ?? viewport?.workArea ?? null,
      devicePixelRatio: viewport?.devicePixelRatio ?? 1,
      resized: viewport?.resized ?? false,
      emulated: viewport?.emulated ?? false,
    }));
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
  viewport = null,
}) {
  let emptyAttempts = 0;
  let paintMs = 0;
  let settleMs = 0;
  let toBitmapMs = 0;
  while (emptyAttempts < maximumEmptyAttempts) {
    const paintStarted = performance.now();
    const image = await capture();
    paintMs += performance.now() - paintStarted;
    const result = readPaintBitmap(image, width, height, frame, viewport);
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
