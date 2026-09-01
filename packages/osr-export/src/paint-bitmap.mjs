/**
 * Offscreen window viewport pinning + fail-closed bitmap size check + empty-paint budget / warm-up.
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
 *
 * Empty paints (task 2026-09-02-osr-frame0-warmup, contract §11.8): right after start-up the
 * compositor answers `paint` with an image that is 0x0 or whose bitmap is 0 bytes for a while
 * (Intel iGPU and RTX alike, about 1 s or more), so a fixed "8 empty paints" limit gave up after
 * roughly one second. These helpers are electron-free as well and take an injectable clock (`now`):
 * - `warmUpOffscreenPaint` repeats capture → readBitmap (settle in between) until one non-empty
 *   bitmap arrives or `budgetMs` (OSR_WARM_UP_BUDGET_MS) has passed; the bitmap is discarded and the
 *   result `{ attempts, empty_attempts, elapsed_ms, satisfied }` goes to run.json `warm_up`.
 * - `captureNonEmptyBitmap` gives up when EITHER `emptyPaintBudgetMs` (OSR_EMPTY_PAINT_BUDGET_MS,
 *   settle time included) has elapsed OR `maximumEmptyAttempts` (OSR_MAXIMUM_EMPTY_ATTEMPTS) empty
 *   paints were seen, whichever comes first; the message names attempts, ms and the active GPU.
 * - `recordEmptyPaints` / `createEmptyPaintRecorder` keep run.json `emptyPaints[]` as
 *   `{ frame, attempts, elapsed_ms }` (elapsed counted from the start of the capture call).
 */
export const OSR_WARM_UP_BUDGET_MS = 5_000;
export const OSR_EMPTY_PAINT_BUDGET_MS = 2_000;
export const OSR_MAXIMUM_EMPTY_ATTEMPTS = 64;

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

// 空 paint が予算（時間 / 回数のどちらか）に達したときの 1 行。回数・ms・載った GPU（無ければ unknown）を含む。
export function emptyPaintFailureMessage({ frame, attempts, elapsedMs, activeDevice = null }) {
  return `frame ${frame}: offscreen paint returned an empty bitmap ${attempts} times over ${roundMs(elapsedMs)} ms（GPU: ${activeDevice ?? "unknown"}）`;
}

// warm-up が予算内に非空 bitmap を 1 枚も得られなかったときの 1 行（electron-main が fail-closed に使う）。
export function warmUpFailureMessage({ empty_attempts: emptyAttempts, elapsed_ms: elapsedMs, activeDevice = null }) {
  return `offscreen paint warm-up: ${emptyAttempts} empty paints over ${roundMs(elapsedMs)} ms（GPU: ${activeDevice ?? "unknown"}）`;
}

function sizeRecord(size) {
  return { width: Number(size?.width), height: Number(size?.height) };
}

function describeSize(size) {
  const { width, height } = sizeRecord(size);
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : "unknown";
}

function roundMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
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

/**
 * 起動直後の warm-up（契約 §11.8 裁定 1）。settleWindowViewport の直後・frame 0 の seek の前に呼び、capture → readBitmap を
 * 非空 bitmap が 1 枚取れるまで（間に settle）繰り返す。予算 `budgetMs` に達したら satisfied: false で返す（throw は呼び出し側）。
 * bitmap は捨てる（frame 0 は従来どおり seek → capture するので frameHashes / 出力には影響しない）。
 * `readBitmap(image)` は `{ empty: boolean }` を返す（electron-main は readPaintBitmap を束ねて渡す）。
 */
export async function warmUpOffscreenPaint({
  capture,
  settle,
  readBitmap,
  budgetMs = OSR_WARM_UP_BUDGET_MS,
  now = () => performance.now(),
}) {
  const started = now();
  let attempts = 0;
  let emptyAttempts = 0;
  for (;;) {
    attempts += 1;
    const image = await capture();
    const result = readBitmap(image);
    if (!result?.empty) return warmUpRecord({ attempts, emptyAttempts, elapsedMs: now() - started, satisfied: true });
    emptyAttempts += 1;
    const elapsedMs = now() - started;
    if (elapsedMs >= budgetMs) return warmUpRecord({ attempts, emptyAttempts, elapsedMs, satisfied: false });
    await settle();
  }
}

function warmUpRecord({ attempts, emptyAttempts, elapsedMs, satisfied }) {
  return { attempts, empty_attempts: emptyAttempts, elapsed_ms: roundMs(elapsedMs), satisfied };
}

/**
 * 非空 bitmap が取れるまで capture を繰り返す（間に settle）。空 paint は `onEmpty(frame)` で 1 回ずつ通知する。
 * 上限は時間 `emptyPaintBudgetMs`（settle の所要込み）と回数 `maximumEmptyAttempts` の両方で、どちらかに達したら
 * `emptyPaintFailureMessage` で throw する（契約 §11.8 裁定 2）。`activeDevice` は run.json gpu.devices の active の
 * device_string（electron-main が summarizeGpuAdapters から渡す・文字列のみ）。
 */
export async function captureNonEmptyBitmap({
  frame,
  width,
  height,
  capture,
  settle,
  onEmpty = () => {},
  maximumEmptyAttempts = OSR_MAXIMUM_EMPTY_ATTEMPTS,
  emptyPaintBudgetMs = OSR_EMPTY_PAINT_BUDGET_MS,
  viewport = null,
  activeDevice = null,
  now = () => performance.now(),
}) {
  const started = now();
  let emptyAttempts = 0;
  let paintMs = 0;
  let settleMs = 0;
  let toBitmapMs = 0;
  for (;;) {
    const paintStarted = now();
    const image = await capture();
    paintMs += now() - paintStarted;
    const result = readPaintBitmap(image, width, height, frame, viewport);
    toBitmapMs += result.toBitmapMs;
    if (!result.empty) return { bitmap: result.bitmap, emptyAttempts, paintMs: paintMs + settleMs, toBitmapMs };
    emptyAttempts += 1;
    onEmpty(frame);
    const elapsedMs = now() - started;
    if (emptyAttempts >= maximumEmptyAttempts || elapsedMs >= emptyPaintBudgetMs) {
      throw new Error(emptyPaintFailureMessage({ frame, attempts: emptyAttempts, elapsedMs, activeDevice }));
    }
    const settleStarted = now();
    await settle();
    settleMs += now() - settleStarted;
  }
}

// run.json emptyPaints[] の記録: 同じ frame は attempts / elapsed_ms を足し込む（既存 attempts の意味は不変・裁定 3）。
export function recordEmptyPaints(records, frame, attempts, elapsedMs = 0) {
  if (attempts === 0) return null;
  let record = records.find((entry) => entry.frame === frame);
  if (!record) {
    record = { frame, attempts: 0, elapsed_ms: 0 };
    records.push(record);
  }
  record.attempts += attempts;
  record.elapsed_ms = roundMs(record.elapsed_ms + elapsedMs);
  return record;
}

// captureNonEmptyBitmap の onEmpty に渡す記録子。生成（= capture 呼び出しの開始）からの経過を、その frame の既存 elapsed_ms に
// 上乗せして書く（stamp / hash の再試行で同じ frame を複数回 capture しても合計になる）。
export function createEmptyPaintRecorder(records, frame, now = () => performance.now()) {
  const started = now();
  let base = null;
  return () => {
    const record = recordEmptyPaints(records, frame, 1);
    if (base === null) base = record.elapsed_ms;
    record.elapsed_ms = roundMs(base + (now() - started));
  };
}
