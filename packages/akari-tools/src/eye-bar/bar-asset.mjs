// bar-asset.mjs — 黒帯素材（アルファ付き mov）の決定論生成。
//
// 契約 §4 の帯素材は「アルファ mov（or 単色矩形）」のいずれでもよいとされている。本実装は
// 単色矩形を選ぶ: 帯の形そのものがレイヤーの矩形いっぱい（透明な縁取りを持たない単色黒の
// 矩形）なので、フレーム全体を不透明黒で塗るだけで足りる。ffmpeg の `color=c=black` ソースは
// アルファチャンネルを持たないが、プロファイル 4444 の ProRes（alpha-carrying pix_fmt）へ
// 変換する過程で ffmpeg は「アルファ無し → アルファ有り」変換時にアルファを不透明（最大値）で
// 埋める（実測確認済み: 64x64 の color=black を yuva444p10le の prores_ks へ通すと
// 中心ピクセルの RGBA は (0,0,0,255)。alpha-check スクリプトの実測ログは report.md 参照）。
//
// エンコード構成は packages/bake-layer/src/encode.mjs の「定番構成」
// （prores_ks -profile:v 4 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0）をそのまま踏襲する
// （読み取り専用参照 — bake-layer 自体は編集していない。既に実績のあるアルファ ProRes 構成を
// 再発明しない）。
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";

/**
 * @param {object} options
 * @param {string} options.outPath 出力 .mov の絶対パス
 * @param {number} options.widthPx 帯素材のネイティブ幅（px、scale=1 のときの画面上の長さ）
 * @param {number} options.heightPx 帯素材のネイティブ高さ（px）
 * @param {number} options.durationSeconds 生成する尺（layer.duration 以上を渡すこと — trim=
 *   フィルタは入力を伸ばさないため、レイヤーの表示窓より短いと末尾が停止しない）
 * @param {number} options.fps
 * @param {string} [options.ffmpegCommand] 明示指定（省略時 resolveFfmpeg()）
 * @returns {{ ok: true, outPath, args } | { ok: false, reason, args }}
 */
export function generateBarAsset({ outPath, widthPx, heightPx, durationSeconds, fps, ffmpegCommand }) {
  const width = Math.max(2, Math.round(widthPx / 2) * 2);
  const height = Math.max(2, Math.round(heightPx / 2) * 2);
  const duration = Math.max(0.1, durationSeconds);
  const ffmpeg = ffmpegCommand ?? resolveFfmpeg();

  mkdirSync(dirname(outPath), { recursive: true });

  const args = [
    "-y",
    "-v", "error",
    "-f", "lavfi",
    "-i", `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`,
    "-c:v", "prores_ks",
    "-profile:v", "4",
    "-pix_fmt", "yuva444p10le",
    "-alpha_bits", "16",
    "-vendor", "apl0",
    outPath,
  ];
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: String(result.stderr ?? result.error?.message ?? `ffmpeg exited ${result.status}`).slice(0, 2000),
      args,
    };
  }
  return { ok: true, outPath, width, height, duration, fps, args };
}
