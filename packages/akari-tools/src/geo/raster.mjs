// タイル画像の展開・結合・切り出し・標高の復号。取得（ネットワーク）は terrain.mjs が担う。
import { spawnSync } from "node:child_process";

import { resolveFfmpeg } from "../../../media-bin/src/index.mjs";
import { decodeRgbPng } from "./png.mjs";
import { TILE_SIZE } from "./tiles.mjs";

/** 地理院タイルの標高 PNG の無効値。 */
export const INVALID_DEM = Object.freeze([128, 0, 0]);

export function isPng(bytes) {
  return bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a;
}

export function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * JPEG を ffmpeg で PNG に展開してから読む。AKARI は映像処理に ffmpeg を要求するため、
 * 新しい画像依存を足さずに既存の解決経路（packages/media-bin）をそのまま使う。
 */
export function decodeJpegToRgb(bytes, { env = process.env, spawn = spawnSync, resolve = resolveFfmpeg } = {}) {
  let ffmpeg;
  try {
    ffmpeg = resolve({ env });
  } catch (error) {
    throw new Error(`写真タイル（JPEG）の展開には ffmpeg が必要です: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = spawn(ffmpeg, ["-v", "error", "-i", "pipe:0", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], {
    input: bytes,
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  if (result.error) throw new Error(`ffmpeg を起動できませんでした: ${result.error.message}`);
  if (result.status !== 0 || !result.stdout?.length) {
    const detail = String(result.stderr ?? "").trim().split("\n").pop() || `exit ${result.status}`;
    throw new Error(`写真タイル（JPEG）の展開に失敗しました: ${detail}`);
  }
  return decodeRgbPng(result.stdout);
}

/** タイル 1 枚を RGB にする。layer は "dem"（PNG のみ）か "photo"（JPEG）。 */
export function decodeTile(bytes, layer, options = {}) {
  if (isPng(bytes)) return decodeRgbPng(bytes);
  if (layer === "dem") throw new Error("標高タイルが PNG ではありません（dem_png は PNG で返ります）");
  if (!isJpeg(bytes)) throw new Error("写真タイルが JPEG でも PNG でもありません");
  return decodeJpegToRgb(bytes, options);
}

/**
 * タイルを 256px 格子に並べて 1 枚の RGB にする。
 * tiles は Map<"x,y", { width, height, rgb }>。
 */
export function composeTiles({ range, tiles, tileSize = TILE_SIZE }) {
  const width = range.columns * tileSize;
  const height = range.rows * tileSize;
  const rgb = Buffer.alloc(width * height * 3);
  for (let row = 0; row < range.rows; row += 1) {
    for (let column = 0; column < range.columns; column += 1) {
      const x = range.xMin + column;
      const y = range.yMin + row;
      const tile = tiles.get(`${x},${y}`);
      if (!tile) throw new Error(`タイル ${x},${y} がありません`);
      if (tile.width !== tileSize || tile.height !== tileSize) {
        throw new Error(`タイル ${x},${y} の寸法が ${tile.width}x${tile.height} です（${tileSize}px が必要）`);
      }
      const tileStride = tileSize * 3;
      const targetStride = width * 3;
      for (let line = 0; line < tileSize; line += 1) {
        tile.rgb.copy(
          rgb,
          (row * tileSize + line) * targetStride + column * tileStride,
          line * tileStride,
          (line + 1) * tileStride,
        );
      }
    }
  }
  return { width, height, rgb };
}

/** 結合画像から world 画素座標の矩形を切り出す。 */
export function cropRgb(image, rect, { originX, originY }) {
  const offsetX = rect.left - originX;
  const offsetY = rect.top - originY;
  if (offsetX < 0 || offsetY < 0 || offsetX + rect.width > image.width || offsetY + rect.height > image.height) {
    throw new Error("切り出し矩形が結合画像の外にはみ出しています");
  }
  const rgb = Buffer.alloc(rect.width * rect.height * 3);
  for (let row = 0; row < rect.height; row += 1) {
    image.rgb.copy(
      rgb,
      row * rect.width * 3,
      ((offsetY + row) * image.width + offsetX) * 3,
      ((offsetY + row) * image.width + offsetX + rect.width) * 3,
    );
  }
  return { width: rect.width, height: rect.height, rgb };
}

export function isInvalidDem(rgb, index) {
  const offset = index * 3;
  return rgb[offset] === INVALID_DEM[0] && rgb[offset + 1] === INVALID_DEM[1] && rgb[offset + 2] === INVALID_DEM[2];
}

/** gsi-dem の符号化（R*65536 + G*256 + B、100 分の 1 m）を標高 m にする。 */
export function decodeElevation(r, g, b) {
  const encoded = r * 65536 + g * 256 + b;
  const signed = encoded >= 0x800000 ? encoded - 0x1000000 : encoded;
  return signed * 0.01;
}

/**
 * 無効値 (128,0,0) を最寄りの有効画素で埋める。
 * 幅優先探索なので、同時に複数の有効画素から届く場合は行優先の近い側が決定的に勝つ。
 */
export function fillInvalidDem(rgb, width, height) {
  const count = width * height;
  const distances = new Int32Array(count).fill(-1);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < count; index += 1) {
    if (isInvalidDem(rgb, index)) continue;
    distances[index] = 0;
    queue[tail] = index;
    tail += 1;
    const elevation = decodeElevation(rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]);
    if (elevation < minimum) minimum = elevation;
    if (elevation > maximum) maximum = elevation;
  }
  const validCount = tail;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    const column = current % width;
    const row = Math.floor(current / width);
    const neighbours = [];
    if (column > 0) neighbours.push(current - 1);
    if (column + 1 < width) neighbours.push(current + 1);
    if (row > 0) neighbours.push(current - width);
    if (row + 1 < height) neighbours.push(current + width);
    for (const next of neighbours) {
      if (distances[next] !== -1) continue;
      distances[next] = distances[current] + 1;
      rgb[next * 3] = rgb[current * 3];
      rgb[next * 3 + 1] = rgb[current * 3 + 1];
      rgb[next * 3 + 2] = rgb[current * 3 + 2];
      queue[tail] = next;
      tail += 1;
    }
  }
  return {
    validCount,
    filledCount: count - validCount,
    elevation: validCount ? [minimum, maximum] : [0, 0],
    fullyValid: validCount === count,
  };
}
