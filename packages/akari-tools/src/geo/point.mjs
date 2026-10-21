// `akari geo point` の本体。terrain.json の declaration と同じ縮尺・基準で、
// 経緯度（と任意の標高 m）から 3D 座標 [x, y, z] を出す。
// 画像の行 0 = 北（-z）・列 0 = 西（-x）という three-runtime.js の地形と同じ向き。
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { decodeRgbPng } from "./png.mjs";
import { decodeElevation, isInvalidDem } from "./raster.mjs";
import { cropRect, latToPixelY, lonToPixelX, parseBbox, parseZoom } from "./tiles.mjs";

const DEFAULT_SIZE = [10, 10];
const DEFAULT_BASELINE = "min";

const MAX_MERCATOR_LAT = 85.0511287798066;

/** "経度,緯度" または "経度,緯度,高さm" を読む。 */
export function parseLonLat(value) {
  const parts = String(value ?? "").split(",").map((part) => Number(part.trim()));
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("--lonlat は「経度,緯度」または「経度,緯度,高さm」の数値で指定してください");
  }
  const [lon, lat, height] = parts;
  if (lon < -180 || lon > 180 || lat < -MAX_MERCATOR_LAT || lat > MAX_MERCATOR_LAT) {
    throw new Error("--lonlat の経度は -180〜180、緯度は -85.05〜85.05 で指定してください");
  }
  return { lon, lat, height };
}

/** terrain.json の declaration を、既定値を補った形で返す。 */
export function terrainDeclaration(terrain) {
  if (!terrain || typeof terrain !== "object") throw new Error("terrain.json が object ではありません");
  const declared = terrain.declaration && typeof terrain.declaration === "object"
    ? terrain.declaration
    : {};
  const meters = Array.isArray(declared.meters)
    ? declared.meters.map(Number)
    : (Array.isArray(terrain.size_m) ? terrain.size_m.map(Number) : null);
  const size = Array.isArray(declared.size)
    ? declared.size.map(Number)
    : (meters ? meters.map((value) => value / 100) : [...DEFAULT_SIZE]);
  const encoding = declared.encoding ?? terrain.encoding ?? "gsi-dem";
  if (encoding !== "gsi-dem" && encoding !== "grayscale") {
    throw new Error(`terrain.json の encoding が不明です: ${encoding}`);
  }
  for (const [label, value] of [["size", size], ["meters", meters]]) {
    if (value !== null && (!Array.isArray(value) || value.length !== 2 || value.some((item) => !(item > 0)))) {
      throw new Error(`terrain.json の ${label} は [幅, 奥行] の正の数値である必要があります`);
    }
  }
  const baseline = declared.baseline ?? DEFAULT_BASELINE;
  if (baseline !== "min" && baseline !== "sea") {
    throw new Error(`terrain.json の baseline は "min" または "sea" である必要があります: ${baseline}`);
  }
  const exaggeration = Number(declared.exaggeration ?? 1);
  if (!(exaggeration > 0)) throw new Error("terrain.json の exaggeration は正の数値である必要があります");
  return {
    heightmap: declared.heightmap ?? null,
    texture: declared.texture ?? null,
    encoding,
    size,
    meters,
    baseline,
    exaggeration,
  };
}

/** heightmap.png の標高の範囲（有効画素だけ）と有効画素数。 */
export function heightmapElevationRange(image) {
  let minimum = Infinity;
  let maximum = -Infinity;
  let validCount = 0;
  for (let index = 0; index < image.width * image.height; index += 1) {
    if (isInvalidDem(image.rgb, index)) continue;
    const elevation = decodeElevation(
      image.rgb[index * 3], image.rgb[index * 3 + 1], image.rgb[index * 3 + 2],
    );
    validCount += 1;
    if (elevation < minimum) minimum = elevation;
    if (elevation > maximum) maximum = elevation;
  }
  return validCount ? { min: minimum, max: maximum, validCount } : { min: 0, max: 0, validCount };
}

/** 画素位置の標高（無効値は null）。 */
export function elevationAt(image, column, row) {
  const index = row * image.width + column;
  if (isInvalidDem(image.rgb, index)) return null;
  return decodeElevation(
    image.rgb[index * 3], image.rgb[index * 3 + 1], image.rgb[index * 3 + 2],
  );
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * 経緯度 → 3D 座標。
 * @param {{ terrain: object, image: {width:number,height:number,rgb:Buffer},
 *   lon: number, lat: number, height?: number, exaggeration?: number }} options
 */
export function terrainPoint({ terrain, image, lon, lat, height, exaggeration }) {
  const declaration = terrainDeclaration(terrain);
  if (exaggeration !== undefined) {
    const override = Number(exaggeration);
    if (!(override > 0) || !Number.isFinite(override)) {
      throw new Error(`--exaggeration は正の数値で指定してください: ${exaggeration}`);
    }
    // シーンで terrain.exaggeration を変えたとき、同じ値を渡して y を合わせる。
    declaration.exaggeration = override;
  }
  const bbox = parseBbox(terrain.bbox);
  const zoom = parseZoom(terrain.zoom);
  const rect = cropRect(bbox, zoom);
  const px = lonToPixelX(lon, zoom) - rect.left;
  const py = latToPixelY(lat, zoom) - rect.top;
  // 画像の外側は端に丸める（bbox の外を指しても破綻しない）。
  const u = clamp01(px / rect.width);
  const v = clamp01(py / rect.height);
  const x = (u - 0.5) * declaration.size[0];
  const z = (v - 0.5) * declaration.size[1];

  let elevation;
  if (height !== undefined) {
    elevation = Number(height);
    if (!Number.isFinite(elevation)) throw new Error(`高さが数値ではありません: ${height}`);
  } else {
    const column = Math.min(image.width - 1, Math.max(0, Math.round(px)));
    const row = Math.min(image.height - 1, Math.max(0, Math.round(py)));
    const sampled = elevationAt(image, column, row);
    elevation = sampled === null ? 0 : sampled;
  }

  let y;
  if (declaration.encoding === "gsi-dem") {
    const range = heightmapElevationRange(image);
    const baselineOffset = declaration.baseline === "sea" ? 0 : range.min;
    const verticalScale = declaration.meters ? declaration.size[0] / declaration.meters[0] : 1;
    y = (elevation - baselineOffset) * verticalScale * declaration.exaggeration;
  } else {
    // grayscale は画像の輝度を 0〜1 の高さとして扱う（ランタイムと同じ）。
    const column = Math.min(image.width - 1, Math.max(0, Math.round(px)));
    const row = Math.min(image.height - 1, Math.max(0, Math.round(py)));
    const index = (row * image.width + column) * 3;
    const luminance = (0.2126 * image.rgb[index] + 0.7152 * image.rgb[index + 1] + 0.0722 * image.rgb[index + 2]) / 255;
    y = luminance * declaration.exaggeration;
  }
  return { x, y, z, elevation, declaration };
}

async function isFile(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// terrain.json から親をたどって AKARI プロジェクトの根（edit.json がある）を返す。
async function findProjectRoot(directory) {
  let current = directory;
  while (true) {
    if (await isFile(path.join(current, "edit.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * terrain.json と高さマップを読む。heightmap は次の順で探す:
 * 1. terrain.json からの相対パス（ファイル名だけの従来の形）
 * 2. AKARI プロジェクト基準のパス（geo terrain がプロジェクト内へ出した形）
 * 3. terrain.json と同じディレクトリのファイル名（プロジェクト外へ移した形）
 */
export async function loadTerrainFiles(terrainPath) {
  const absolute = path.resolve(terrainPath);
  const terrain = JSON.parse(await readFile(absolute, "utf8"));
  const declaration = terrainDeclaration(terrain);
  const directory = path.dirname(absolute);
  const declared = declaration.heightmap ?? "heightmap.png";
  const candidates = [path.resolve(directory, declared)];
  const projectRoot = await findProjectRoot(directory);
  if (projectRoot) candidates.push(path.resolve(projectRoot, declared));
  candidates.push(path.join(directory, path.basename(declared)));
  const unique = [...new Set(candidates)];
  let heightmapPath = unique[0];
  for (const candidate of unique) {
    if (await isFile(candidate)) {
      heightmapPath = candidate;
      break;
    }
  }
  const image = decodeRgbPng(await readFile(heightmapPath));
  return { terrain, image, declaration, heightmapPath };
}

/** CLI 用に 3 桁へ丸めた [x, y, z]。 */
export function roundPoint(point) {
  return [point.x, point.y, point.z].map((value) => Math.round(value * 1000) / 1000);
}
