// bbox とズームから地理院タイルの番号・切り出し矩形・実寸を決める純関数。
// タイル番号は Web メルカトル（slippy map）の標準式に従う。

export const TILE_SIZE = 256;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 14;
const EARTH_RADIUS_M = 6378137;
const MAX_MERCATOR_LAT = 85.0511287798066;

/** 西,南,東,北 の配列を検証して数値の object にする。 */
export function parseBbox(value) {
  const parts = Array.isArray(value)
    ? value.map(Number)
    : String(value ?? "").split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("bbox は「西,南,東,北」の 4 つの数値で指定してください（例: 139.33,35.56,139.40,35.61）");
  }
  const [west, south, east, north] = parts;
  if (west < -180 || east > 180 || south < -MAX_MERCATOR_LAT || north > MAX_MERCATOR_LAT) {
    throw new Error("bbox が世界測地系の範囲外です（経度 -180〜180、緯度 -85.05〜85.05）");
  }
  if (!(west < east) || !(south < north)) {
    throw new Error("bbox は 西 < 東 かつ 南 < 北 の順で指定してください");
  }
  return { west, south, east, north };
}

export function parseZoom(value, fallback = 14) {
  if (value === undefined || value === null || value === "") return fallback;
  const zoom = Number(value);
  if (!Number.isInteger(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
    throw new Error(`zoom は ${MIN_ZOOM}〜${MAX_ZOOM} の整数で指定してください`);
  }
  return zoom;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function lonToTileX(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

export function latToTileY(lat, zoom) {
  const radians = (lat * Math.PI) / 180;
  const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
  return Math.floor(value * 2 ** zoom);
}

/** bbox が含むタイル番号の範囲。y は北が小さい。 */
export function tileRange(bbox, zoom) {
  const maximum = 2 ** zoom - 1;
  const xMin = clamp(lonToTileX(bbox.west, zoom), 0, maximum);
  const xMax = clamp(lonToTileX(bbox.east, zoom), 0, maximum);
  const yMin = clamp(latToTileY(bbox.north, zoom), 0, maximum);
  const yMax = clamp(latToTileY(bbox.south, zoom), 0, maximum);
  const columns = xMax - xMin + 1;
  const rows = yMax - yMin + 1;
  return { xMin, xMax, yMin, yMax, columns, rows, count: columns * rows };
}

export function lonToPixelX(lon, zoom) {
  return ((lon + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

export function latToPixelY(lat, zoom) {
  const radians = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * TILE_SIZE * 2 ** zoom;
}

/**
 * bbox を覆う画素矩形。left/top は世界画素座標の切り下げ、width/height は
 * タイル境界をまたぐ場合も含めた被覆に必要な枚数（最低 1 画素）。
 */
export function cropRect(bbox, zoom) {
  const left = Math.floor(lonToPixelX(bbox.west, zoom));
  const right = Math.ceil(lonToPixelX(bbox.east, zoom));
  const top = Math.floor(latToPixelY(bbox.north, zoom));
  const bottom = Math.ceil(latToPixelY(bbox.south, zoom));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** その緯度・ズームでの 1 画素あたりの地上距離（m）。 */
export function metersPerPixel(lat, zoom) {
  return (Math.cos((lat * Math.PI) / 180) * 2 * Math.PI * EARTH_RADIUS_M) / (TILE_SIZE * 2 ** zoom);
}

/** 切り出した画素の実寸（幅, 奥行）。 */
export function sizeMeters({ bbox, zoom }) {
  const rect = cropRect(bbox, zoom);
  const centerLat = (bbox.south + bbox.north) / 2;
  const scale = metersPerPixel(centerLat, zoom);
  return [round(rect.width * scale, 1), round(rect.height * scale, 1)];
}

/** 上限タイル数に収まる最大の zoom。収まらなければ null。 */
export function zoomWithinTileLimit(bbox, requestedZoom, maxTiles) {
  for (let zoom = requestedZoom; zoom >= MIN_ZOOM; zoom -= 1) {
    if (tileRange(bbox, zoom).count <= maxTiles) return zoom;
  }
  return null;
}

export function googleTileUrl(layer, zoom, x, y) {
  if (layer === "dem") return `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${zoom}/${x}/${y}.png`;
  if (layer === "photo") return `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${zoom}/${x}/${y}.jpg`;
  throw new Error(`不明なタイル種別です: ${layer}`);
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
