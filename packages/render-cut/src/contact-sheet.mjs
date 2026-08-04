import { mkdir } from "node:fs/promises";
import { join } from "node:path";

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

function formatNumber(value) {
  return Number(value).toFixed(6);
}
