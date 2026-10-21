// `akari geo terrain` の本体。地理院タイルを取得・キャッシュし、高さマップ・写真・
// terrain.json を作る。取得関数は差し替え可能にして、テストではネットワークに出ない。
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { toolsText } from "../i18n.mjs";
import { encodeRgbPng } from "./png.mjs";
import {
  INVALID_DEM,
  MISSING_PHOTO_RGB,
  composeTiles,
  createSolidTile,
  cropRgb,
  decodeTile,
  fillInvalidDem,
} from "./raster.mjs";
import {
  cropRect,
  googleTileUrl,
  parseBbox,
  parseZoom,
  sizeMeters,
  tileRange,
  zoomWithinTileLimit,
} from "./tiles.mjs";

export const ATTRIBUTION = "出典: 国土地理院（地理院タイル）";
export const DEFAULT_MAX_TILES = 64;
const LAYERS = [
  { id: "dem", folder: "dem_png", extension: "png" },
  { id: "photo", folder: "seamlessphoto", extension: "jpg" },
];

export function resolveGeoCacheDir({ env = process.env, home = homedir() } = {}) {
  if (env.AKARI_GEO_CACHE_DIR) return path.resolve(env.AKARI_GEO_CACHE_DIR);
  const akariHome = env.AKARI_HOME || path.join(home, ".akari");
  return path.join(akariHome, "cache", "geo");
}

async function readIfPresent(file) {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, file);
}

async function fetchWithRetry(url, { fetchImpl, attempts = 3 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "akari-video-geo/1.0 (+https://github.com/AkariLabs/akari-video)" },
        signal: AbortSignal.timeout(30000),
      });
      const status = typeof response.status === "number"
        ? response.status
        : (response.ok === false ? 400 : 200);
      // 地理院タイルは海や範囲外のタイルが 404 になる。呼び出し側で「無効なタイル」として扱う。
      if (status === 404) return null;
      if (response.ok === false || status >= 400) {
        const error = new Error(`HTTP ${status}: ${url}`);
        error.status = status;
        // 404 以外の 4xx は再試行しても変わらない。
        if (status < 500) throw error;
        lastError = error;
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) throw new Error(`空のタイルが返りました: ${url}`);
        return bytes;
      }
    } catch (error) {
      if (error?.status && error.status < 500) throw error;
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw new Error(`タイルを取得できませんでした: ${url}（${lastError instanceof Error ? lastError.message : String(lastError)}）`);
}

/** タイル 1 枚を読む。404 は null（そのタイルは無い）。 */
async function loadTile({ layer, zoom, x, y, cacheDir, fetchImpl, stats }) {
  const file = path.join(cacheDir, layer.folder, String(zoom), String(x), `${y}.${layer.extension}`);
  const cached = await readIfPresent(file);
  if (cached) {
    stats.cached += 1;
    return cached;
  }
  const url = googleTileUrl(layer.id, zoom, x, y);
  const bytes = await fetchWithRetry(url, { fetchImpl });
  if (bytes === null) return null;
  await writeAtomic(file, bytes);
  stats.fetched += 1;
  return bytes;
}

function limitMessage({ range, zoom, maxTiles, bbox }) {
  const suggestion = zoomWithinTileLimit(bbox, zoom - 1, maxTiles);
  const advice = suggestion === null
    ? `bbox を狭めてください（zoom ${zoom} では ${range.columns}×${range.rows} = ${range.count} 枚必要）`
    : `--zoom ${suggestion} 以下を指定してください（zoom ${suggestion} なら ${tileRange(bbox, suggestion).count} 枚）`;
  return `タイル数が上限（${maxTiles}）を超えます: zoom ${zoom} で ${range.columns}×${range.rows} = ${range.count} 枚。${advice}`;
}

/**
 * 地形素材を作る。
 * @param {{ bbox: string|number[], zoom?: number, outDir: string, maxTiles?: number,
 *   cacheDir?: string, fetchImpl?: Function, env?: object, log?: Function }} options
 */
export async function buildTerrain(options) {
  const {
    outDir,
    maxTiles = DEFAULT_MAX_TILES,
    fetchImpl = globalThis.fetch,
    env = process.env,
    log = () => {},
  } = options;
  if (!outDir) throw new Error("--out <dir> で出力先を指定してください");
  if (typeof fetchImpl !== "function") throw new Error("fetch を利用できません（Node.js 20 以上が必要です）");
  const bbox = parseBbox(options.bbox);
  const bboxText = Array.isArray(options.bbox) ? options.bbox.join(",") : String(options.bbox ?? "");
  const zoom = parseZoom(options.zoom);
  const limit = Number(maxTiles);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--max-tiles は 1 以上の整数で指定してください");
  const cacheDir = path.resolve(options.cacheDir ?? resolveGeoCacheDir({ env }));

  const range = tileRange(bbox, zoom);
  if (range.count > limit) throw new Error(limitMessage({ range, zoom, maxTiles: limit, bbox }));
  const rect = cropRect(bbox, zoom);
  const stats = { count: range.count, fetched: 0, cached: 0 };
  const missing = { dem: 0, photo: 0 };

  const composed = {};
  for (const layer of LAYERS) {
    const tiles = new Map();
    for (let y = range.yMin; y <= range.yMax; y += 1) {
      for (let x = range.xMin; x <= range.xMax; x += 1) {
        const bytes = await loadTile({ layer, zoom, x, y, cacheDir, fetchImpl, stats });
        if (bytes === null) {
          // 標高の 404 は「そのタイル全体が無効値」。写真の 404 は単色（海の色）で埋める。
          missing[layer.id] += 1;
          tiles.set(`${x},${y}`, createSolidTile(layer.id === "dem" ? INVALID_DEM : MISSING_PHOTO_RGB));
        } else {
          tiles.set(`${x},${y}`, decodeTile(bytes, layer.id));
        }
      }
    }
    if (layer.id === "dem" && missing.dem === range.count) {
      throw new Error(toolsText("tools.geo.error.allDemTilesMissing", { bbox: bboxText }));
    }
    const image = composeTiles({ range, tiles });
    composed[layer.id] = cropRgb(image, rect, {
      originX: range.xMin * 256,
      originY: range.yMin * 256,
    });
  }

  const demStats = fillInvalidDem(composed.dem.rgb, composed.dem.width, composed.dem.height);
  const size = sizeMeters({ bbox, zoom });
  // 3D の terrain 宣言にそのまま貼れる形。size は meters の 1/100（1 m = 0.01 ワールド単位）。
  const declaration = {
    heightmap: "heightmap.png",
    texture: "texture.png",
    encoding: "gsi-dem",
    size: [round2(size[0] / 100), round2(size[1] / 100)],
    meters: [round2(size[0]), round2(size[1])],
    baseline: "min",
  };
  const terrain = {
    bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
    zoom,
    size_m: size,
    elevation_m: [round2(demStats.elevation[0]), round2(demStats.elevation[1])],
    encoding: "gsi-dem",
    declaration,
    missing_tiles: { dem: missing.dem, photo: missing.photo },
    attribution: ATTRIBUTION,
  };

  const outputDir = path.resolve(outDir);
  await fs.mkdir(outputDir, { recursive: true });
  const files = {
    heightmap: path.join(outputDir, "heightmap.png"),
    texture: path.join(outputDir, "texture.png"),
    terrain: path.join(outputDir, "terrain.json"),
  };
  await fs.writeFile(files.heightmap, encodeRgbPng(composed.dem.rgb, composed.dem.width, composed.dem.height));
  await fs.writeFile(files.texture, encodeRgbPng(composed.photo.rgb, composed.photo.width, composed.photo.height));
  await fs.writeFile(files.terrain, `${JSON.stringify(terrain, null, 2)}\n`);

  log(`heightmap.png ${composed.dem.width}x${composed.dem.height}`);
  log(`texture.png ${composed.photo.width}x${composed.photo.height}`);
  log(`タイル ${stats.count} 枚（取得 ${stats.fetched} / キャッシュ ${stats.cached}）`);
  if (missing.dem || missing.photo) {
    log(toolsText("tools.geo.notice.missingTiles", { dem: missing.dem, photo: missing.photo }));
  }
  if (demStats.filledCount) log(`無効値を ${demStats.filledCount} 画素補間しました`);
  log(ATTRIBUTION);

  return {
    outDir: outputDir,
    files,
    terrain,
    size: [composed.dem.width, composed.dem.height],
    tiles: stats,
    missing,
    filled: demStats.filledCount,
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
