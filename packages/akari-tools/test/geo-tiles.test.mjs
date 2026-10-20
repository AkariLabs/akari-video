import assert from "node:assert/strict";
import test from "node:test";

import {
  cropRect,
  googleTileUrl,
  latToTileY,
  lonToTileX,
  metersPerPixel,
  parseBbox,
  parseZoom,
  sizeMeters,
  tileRange,
  zoomWithinTileLimit,
} from "../src/geo/tiles.mjs";

const TOKYO = { west: 139.7669, south: 35.6810, east: 139.7673, north: 35.6814 };

test("geo tiles: 東京駅の z14 タイル番号は 14552/6451", () => {
  assert.equal(lonToTileX(139.767125, 14), 14552);
  assert.equal(latToTileY(35.681236, 14), 6451);
});

test("geo tiles: z1 の世界全体は 2x2 タイル", () => {
  const range = tileRange(parseBbox("-180,-85,180,85"), 1);
  assert.deepEqual(range, { xMin: 0, xMax: 1, yMin: 0, yMax: 1, columns: 2, rows: 2, count: 4 });
});

test("geo tiles: タイル境界をまたぐ bbox は 2x2 タイルになる", () => {
  const bbox = parseBbox("139.7680,35.6750,139.7681,35.6753");
  const range = tileRange(bbox, 14);
  assert.deepEqual(range, { xMin: 14552, xMax: 14553, yMin: 6451, yMax: 6452, columns: 2, rows: 2, count: 4 });
});

test("geo tiles: 切り出しは 1 画素の bbox でも最低 1 画素を覆う", () => {
  const bbox = parseBbox("139.7680,35.6750,139.7681,35.6753");
  const rect = cropRect(bbox, 14);
  assert.deepEqual(rect, { left: 3725567, top: 1651709, width: 2, height: 6 });
  const tiny = cropRect(parseBbox("139.7680001,35.6750001,139.7680002,35.6750002"), 14);
  assert.deepEqual(tiny, { left: 3725567, top: 1651714, width: 1, height: 1 });
});

test("geo tiles: bbox の実寸は画素数と緯度から決まる", () => {
  const bbox = parseBbox("139.3445,35.5960,139.3555,35.6050");
  const rect = cropRect(bbox, 14);
  const scale = metersPerPixel(35.6005, 14);
  const [width, depth] = sizeMeters({ bbox, zoom: 14 });
  assert.equal(width, Math.round(rect.width * scale * 10) / 10);
  assert.equal(depth, Math.round(rect.height * scale * 10) / 10);
  assert.ok(width > 900 && width < 1100, `width=${width}`);
  assert.ok(depth > 900 && depth < 1100, `depth=${depth}`);
});

test("geo tiles: bbox と zoom の検証", () => {
  assert.deepEqual(parseBbox("139,35,140,36"), { west: 139, south: 35, east: 140, north: 36 });
  assert.throws(() => parseBbox("139,35,139,36"), /西 < 東/);
  assert.throws(() => parseBbox("139,36,140,35"), /南 < 北/);
  assert.throws(() => parseBbox("139,35,140"), /4 つの数値/);
  assert.throws(() => parseBbox("139,35,181,36"), /範囲外/);
  assert.equal(parseZoom(undefined), 14);
  assert.throws(() => parseZoom(0), /1〜14/);
  assert.throws(() => parseZoom(15), /1〜14/);
});

test("geo tiles: 上限を超えたら収まる zoom を案内できる", () => {
  const bbox = parseBbox("139.0,35.0,140.0,36.0");
  assert.ok(tileRange(bbox, 14).count > 64);
  const suggested = zoomWithinTileLimit(bbox, 13, 64);
  assert.ok(suggested !== null && suggested < 14);
  assert.ok(tileRange(bbox, suggested).count <= 64);
  assert.equal(zoomWithinTileLimit(parseBbox("-180,-85,180,85"), 1, 1), null);
});

test("geo tiles: 取得 URL は地理院タイルの公開 URL", () => {
  assert.equal(googleTileUrl("dem", 14, 14552, 6451), "https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14552/6451.png");
  assert.equal(googleTileUrl("photo", 14, 14552, 6451), "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/14/14552/6451.jpg");
  assert.throws(() => googleTileUrl("other", 14, 0, 0), /不明なタイル種別/);
});

test("geo tiles: 東京駅を含む bbox の範囲は 1 タイルに収まる", () => {
  const range = tileRange(TOKYO, 14);
  assert.equal(range.count, 1);
  assert.equal(range.xMin, 14552);
  assert.equal(range.yMin, 6451);
});
