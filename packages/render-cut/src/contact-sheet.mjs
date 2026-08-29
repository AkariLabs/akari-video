import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { computeVideoRuns, resolveCutSegments } from "./cut-timeline.mjs";
import { runChecked } from "./rasterize.mjs";

// タスク契約「検査 3」の上限・間引き規則: これを超えたら等間隔サンプリングで間引く
// （同一入力 → 同一時刻列を保証するため、上限値と規則はここに固定する）。
export const CONTACT_SHEET_MAX_FRAMES = 12;

// plan（predicted_duration_seconds・preset.fps）と edit の cuts/overlays だけから代表時刻を
// 決定論で導出する。ffprobe/ffmpeg の実測値には一切依存しない — 同一 edit.json + 同一素材なら
// 常に同じ時刻列になることを保証するため。
export function deriveContactSheetTimestamps({ cuts, overlays, durationSeconds, fps }) {
  if (!(durationSeconds > 0) || !(fps > 0)) return [];
  const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
  const halfFrame = 1 / fps / 2;
  const toFrameIndex = (seconds) => Math.min(totalFrames - 1, Math.max(0, Math.round(seconds * fps)));

  const candidateSeconds = [
    0, // 冒頭
    ...deriveCutBoundarySeconds(cuts, durationSeconds).map((boundary) => boundary + halfFrame), // 各カット境界の直後
    ...(overlays ?? [])
      .filter((overlay) => Number.isFinite(overlay?.start) && overlay.duration > 0)
      .map((overlay) => overlay.start + overlay.duration / 2), // 各オーバーレイ・字幕区間の中点
    durationSeconds - halfFrame, // 終盤（末尾直前）
  ];

  const timeByFrameIndex = new Map();
  for (const seconds of candidateSeconds) {
    if (!Number.isFinite(seconds)) continue;
    const frameIndex = toFrameIndex(seconds);
    if (!timeByFrameIndex.has(frameIndex)) timeByFrameIndex.set(frameIndex, frameIndex / fps);
  }
  const sortedFrameIndexes = [...timeByFrameIndex.keys()].sort((left, right) => left - right);
  return thinEvenly(sortedFrameIndexes, CONTACT_SHEET_MAX_FRAMES).map(
    (frameIndex) => timeByFrameIndex.get(frameIndex),
  );
}

// resolveCutSegments/computeVideoRuns は cut-timeline.mjs の既存関数（track・at・gap を含めて
// version 0/1 共通で扱える）。ここでは「合成後タイムライン上で絵が切り替わる位置」だけを取り出す
// ので、最初のラン開始（=0、上で別枠として足す「冒頭」と重複）は除く。xfade の重み付き遷移そのものは
// 対象にしない（判定材料生成であり verify ではないため、これで十分）。
function deriveCutBoundarySeconds(cuts, durationSeconds) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  const segments = resolveCutSegments(cuts);
  const runs = computeVideoRuns(segments, durationSeconds);
  return runs.slice(1).map((run) => run.outStart);
}

// 上限を超えたときの間引き規則: 最初と最後を必ず残し、残りは等間隔サンプリングする。
// 入力配列はソート済み前提（呼び出し側で保証）。
function thinEvenly(sortedValues, max) {
  if (max <= 0) return [];
  if (sortedValues.length <= max) return sortedValues;
  const picked = new Set();
  for (let index = 0; index < max; index += 1) {
    const position = Math.round((index * (sortedValues.length - 1)) / (max - 1));
    picked.add(sortedValues[position]);
  }
  return [...picked].sort((left, right) => left - right);
}

export function contactSheetGridDimensions(count) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, rows };
}

// 13 コマを 12+1 にせず 7+6 にするため、必要なシート数を先に確定して均等配分する。
// media/capture 共用の純関数。各要素は 1..perSheet、総和は count になる。
export function splitContactSheetCounts(count, perSheet = CONTACT_SHEET_MAX_FRAMES) {
  if (!Number.isInteger(count) || count < 0) throw new Error("count は 0 以上の整数で指定してください");
  if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > CONTACT_SHEET_MAX_FRAMES) {
    throw new Error(`perSheet は 1〜${CONTACT_SHEET_MAX_FRAMES} の整数で指定してください`);
  }
  if (count === 0) return [];
  const sheetCount = Math.ceil(count / perSheet);
  const base = Math.floor(count / sheetCount);
  const remainder = count % sheetCount;
  return Array.from({ length: sheetCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function contactSheetCellDimensions({
  count,
  sourceWidth,
  sourceHeight,
  maxWidth = 2576,
  maxHeight = 1456,
}) {
  const { cols, rows } = contactSheetGridDimensions(count);
  const safeWidth = Math.max(2, Number(sourceWidth) || 1920);
  const safeHeight = Math.max(2, Number(sourceHeight) || 1080);
  const sourceCapHeight = Math.max(1080, safeHeight);
  const sourceCapWidth = sourceCapHeight * safeWidth / safeHeight;
  const gap = 2;
  const maxCellWidth = Math.min(Math.floor((maxWidth - gap * (cols - 1)) / cols), Math.floor(sourceCapWidth));
  const maxCellHeight = Math.min(Math.floor((maxHeight - gap * (rows - 1)) / rows), Math.floor(sourceCapHeight));
  const scale = Math.min(maxCellWidth / safeWidth, maxCellHeight / safeHeight);
  const width = Math.max(2, Math.floor(safeWidth * scale / 2) * 2);
  const height = Math.max(2, Math.floor(safeHeight * scale / 2) * 2);
  return { cols, rows, width, height, sheetWidth: width * cols + gap * (cols - 1), sheetHeight: height * rows + gap * (rows - 1) };
}

// timestamps の各時刻を静止画として抜き、1 枚のタイル画像に結合する。ffmpeg 本体を直叩きするのみ
// （render-cut ハードルール 10）。1 枚も無ければ何もせず null を返す。
export async function renderContactSheet({
  ffmpegCommand,
  videoPath,
  timestamps,
  temporaryDirectory,
  outputPath,
}) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return null;
  const framesDirectory = join(temporaryDirectory, "contact-sheet-frames");
  await mkdir(framesDirectory, { recursive: true });
  const framePattern = join(framesDirectory, "frame-%03d.png");
  timestamps.forEach((seconds, index) => {
    const framePath = join(framesDirectory, `frame-${String(index + 1).padStart(3, "0")}.png`);
    runChecked(ffmpegCommand, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-ss",
      formatNumber(Math.max(0, seconds)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      framePath,
    ]);
  });
  const { cols, rows } = contactSheetGridDimensions(timestamps.length);
  runChecked(ffmpegCommand, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-start_number",
    "1",
    "-i",
    framePattern,
    "-vf",
    `tile=${cols}x${rows}`,
    "-frames:v",
    "1",
    outputPath,
  ]);
  return outputPath;
}

// 観察コマンド向け。既存 renderContactSheet の引数・ffmpeg 呼び出しは変更せず、
// ラベル・寸法上限・中間グレー背景が必要な呼び出しだけこの追加 API を使う。
export async function renderLabeledContactSheet({
  ffmpegCommand,
  videoPath,
  timestamps,
  labels,
  sourceWidth,
  sourceHeight,
  temporaryDirectory,
  outputPath,
}) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return null;
  const framesDirectory = join(temporaryDirectory, "labeled-contact-sheet-frames");
  await mkdir(framesDirectory, { recursive: true });
  const framePattern = join(framesDirectory, "frame-%03d.png");
  const dimensions = contactSheetCellDimensions({ count: timestamps.length, sourceWidth, sourceHeight });
  for (const [index, seconds] of timestamps.entries()) {
    const framePath = join(framesDirectory, `frame-${String(index + 1).padStart(3, "0")}.png`);
    const labelPath = join(framesDirectory, `label-${String(index + 1).padStart(3, "0")}.png`);
    await writeFile(labelPath, renderLabelPng(labels?.[index] ?? ""));
    runChecked(ffmpegCommand, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", videoPath,
      "-i", labelPath,
      "-ss", formatNumber(Math.max(0, seconds)),
      "-frames:v", "1",
      "-filter_complex", [
        `[0:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease`,
        `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=0x808080[base]`,
        `[base][1:v]overlay=12:H-h-12`,
      ].join(","),
      framePath,
    ]);
  }
  runChecked(ffmpegCommand, [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-start_number", "1", "-i", framePattern,
    "-vf", `tile=${dimensions.cols}x${dimensions.rows}:padding=2:margin=0:color=0x808080`,
    "-frames:v", "1", outputPath,
  ]);
  return outputPath;
}

function formatNumber(value) {
  return Number(value).toFixed(6);
}

const LABEL_GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  "m": ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  "s": ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  "f": ["00110", "01001", "01000", "11100", "01000", "01000", "01000"],
};

function renderLabelPng(text) {
  const scale = 4;
  const padding = 4;
  const glyphWidth = 5 * scale;
  const glyphHeight = 7 * scale;
  const spacing = scale;
  const value = String(text);
  const width = padding * 2 + Math.max(1, value.length) * glyphWidth + Math.max(0, value.length - 1) * spacing;
  const height = padding * 2 + glyphHeight;
  const pixels = Buffer.alloc(width * height * 4);
  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3];
  };
  for (const [characterIndex, character] of [...value].entries()) {
    const glyph = LABEL_GLYPHS[character];
    if (!glyph) continue;
    const originX = padding + characterIndex * (glyphWidth + spacing);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let y = -1; y <= scale; y += 1) for (let x = -1; x <= scale; x += 1) {
          setPixel(originX + column * scale + x, padding + row * scale + y, [0, 0, 0, 255]);
        }
      }
    }
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
          setPixel(originX + column * scale + x, padding + row * scale + y, [255, 255, 255, 255]);
        }
      }
    }
  }
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    pixels.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); typeBuffer.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
