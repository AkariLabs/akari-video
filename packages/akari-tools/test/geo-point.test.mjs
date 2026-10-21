import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runGeoCommand } from "../bin/geo.mjs";
import {
  heightmapElevationRange,
  loadTerrainFiles,
  parseLonLat,
  roundPoint,
  terrainDeclaration,
  terrainPoint,
} from "../src/geo/point.mjs";
import { encodeRgbPng } from "../src/geo/png.mjs";
import { cropRect, latToPixelY, lonToPixelX, sizeMeters } from "../src/geo/tiles.mjs";

const ZOOM = 14;
const WORLD = 256 * 2 ** ZOOM;
const BBOX = "139.7680,35.6750,139.7681,35.6753";
const BBOX_OBJECT = { west: 139.768, south: 35.675, east: 139.7681, north: 35.6753 };
const RECT = cropRect(BBOX_OBJECT, ZOOM);
const SIZE = sizeMeters({ bbox: BBOX_OBJECT, zoom: ZOOM });

function encodeElevation(meters) {
  let encoded = Math.round(meters * 100);
  if (encoded < 0) encoded += 0x1000000;
  return [(encoded >> 16) & 0xff, (encoded >> 8) & 0xff, encoded & 0xff];
}

function pixelXToLon(x) {
  return (x / WORLD) * 360 - 180;
}

function pixelYToLat(y) {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / WORLD))) * 180) / Math.PI;
}

/** RECT と同じ 2x6 画素。行ごとに 100,200,...,600 m。 */
function heightmap() {
  const rgb = Buffer.alloc(RECT.width * RECT.height * 3);
  for (let row = 0; row < RECT.height; row += 1) {
    const [r, g, b] = encodeElevation(100 * (row + 1));
    for (let column = 0; column < RECT.width; column += 1) {
      rgb.set([r, g, b], (row * RECT.width + column) * 3);
    }
  }
  return { width: RECT.width, height: RECT.height, rgb };
}

const TERRAIN = {
  bbox: BBOX.split(",").map(Number),
  zoom: ZOOM,
  size_m: SIZE,
  encoding: "gsi-dem",
  declaration: {
    heightmap: "heightmap.png",
    texture: "texture.png",
    encoding: "gsi-dem",
    size: [0.4, 0.6],
    meters: [40, 60],
    baseline: "min",
  },
};

test("geo point: 四隅と中央が declaration の size / meters / baseline に合う", () => {
  const image = heightmap();
  const left = RECT.left;
  const top = RECT.top;
  const pointAt = (pixelX, pixelY, height) => terrainPoint({
    terrain: TERRAIN,
    image,
    lon: pixelXToLon(pixelX),
    lat: pixelYToLat(pixelY),
    height,
  });
  const close = (actual, expected) => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  };

  // north-west / north-east / south-west / south-east。画像の端 = 地形の端。
  const northWest = pointAt(left, top);
  close(northWest.x, -0.2);
  close(northWest.z, -0.3);
  // 行 0 の画素は 100 m。baseline min なので最低標高が y=0。
  close(northWest.y, 0);

  const northEast = pointAt(left + RECT.width, top);
  close(northEast.x, 0.2);
  close(northEast.z, -0.3);

  const southWest = pointAt(left, top + RECT.height);
  close(southWest.x, -0.2);
  close(southWest.z, 0.3);
  // 行 5 は 600 m -> (600-100) * (0.4/40) = 5。
  close(southWest.y, 5);

  const southEast = pointAt(left + RECT.width, top + RECT.height);
  close(southEast.x, 0.2);
  close(southEast.z, 0.3);

  // 中央は画素 (1,3) = 400 m -> (400-100) * 0.01 = 3。
  const center = pointAt(left + RECT.width / 2, top + RECT.height / 2);
  close(center.x, 0);
  close(center.z, 0);
  close(center.y, 3);
  assert.equal(center.elevation, 400);

  // 高さを渡すと高さマップより優先する（500 m -> 4）。
  const given = pointAt(left + RECT.width / 2, top + RECT.height / 2, 500);
  close(given.y, 4);
});

test("geo point: baseline sea は標高 0 m を y=0 にし、exaggeration を掛ける", () => {
  const terrain = {
    ...TERRAIN,
    declaration: { ...TERRAIN.declaration, baseline: "sea", exaggeration: 2 },
  };
  const point = terrainPoint({
    terrain,
    image: heightmap(),
    lon: pixelXToLon(RECT.left + RECT.width / 2),
    lat: pixelYToLat(RECT.top + RECT.height / 2),
  });
  assert.ok(Math.abs(point.y - 400 * 0.01 * 2) < 1e-9);
});

test("geo point: terrain.json の declaration を既定値込みで読む", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-geo-point-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const heightmapPath = path.join(root, "heightmap.png");
  await writeFile(heightmapPath, encodeRgbPng(heightmap().rgb, RECT.width, RECT.height));
  const terrainPath = path.join(root, "terrain.json");
  await writeFile(terrainPath, JSON.stringify(TERRAIN));

  const declaration = terrainDeclaration(TERRAIN);
  assert.equal(declaration.encoding, "gsi-dem");
  assert.deepEqual(declaration.size, [0.4, 0.6]);
  assert.deepEqual(declaration.meters, [40, 60]);
  assert.equal(declaration.baseline, "min");

  const loaded = await loadTerrainFiles(terrainPath);
  assert.equal(loaded.image.width, RECT.width);
  assert.equal(loaded.image.height, RECT.height);
  const range = heightmapElevationRange(loaded.image);
  assert.equal(range.min, 100);
  assert.equal(range.max, 600);
  assert.equal(range.validCount, RECT.width * RECT.height);

  // size_m から declaration を補う（meters の 1/100）。
  const derived = terrainDeclaration({ bbox: TERRAIN.bbox, zoom: ZOOM, size_m: SIZE, encoding: "gsi-dem" });
  assert.deepEqual(derived.meters, SIZE);
  assert.deepEqual(derived.size, [SIZE[0] / 100, SIZE[1] / 100]);
  assert.equal(derived.baseline, "min");
});

test("geo point: --lonlat の 2 要素・3 要素と範囲外", () => {
  assert.deepEqual(parseLonLat("139.1,35.6"), { lon: 139.1, lat: 35.6, height: undefined });
  assert.deepEqual(parseLonLat("139.1,35.6,120.5"), { lon: 139.1, lat: 35.6, height: 120.5 });
  assert.throws(() => parseLonLat("139.1"), /経度,緯度/u);
  assert.throws(() => parseLonLat("139.1,35.6,1,2"), /経度,緯度/u);
  assert.throws(() => parseLonLat("200,35.6"), /経度は -180〜180/u);
  assert.throws(() => parseLonLat("139.1,90"), /緯度は -85\.05/u);
  assert.throws(() => parseLonLat("139.1,35.6,abc"), /経度,緯度/u);
});

test("geo point CLI: terrain.json と --lonlat から [x,y,z] を出す", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-geo-point-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "heightmap.png"), encodeRgbPng(heightmap().rgb, RECT.width, RECT.height));
  const terrainPath = path.join(root, "terrain.json");
  await writeFile(terrainPath, JSON.stringify(TERRAIN));

  const lines = [];
  const errors = [];
  const centerLon = pixelXToLon(RECT.left + RECT.width / 2);
  const centerLat = pixelYToLat(RECT.top + RECT.height / 2);
  const result = await runGeoCommand(
    ["point", "--terrain", terrainPath, "--lonlat", `${centerLon},${centerLat}`, "--json"],
    { log: (line) => lines.push(line), logError: (line) => errors.push(line) },
  );
  assert.equal(result.exitCode, 0, errors.join("\n"));
  const point = JSON.parse(lines.at(-1));
  assert.deepEqual(point, [0, 3, 0]);
  assert.deepEqual(roundPoint({ x: 0.12345, y: -1.23456, z: 2 }), [0.123, -1.235, 2]);

  const missing = await runGeoCommand(["point", "--terrain", terrainPath], {
    logError: (line) => errors.push(line),
  });
  assert.equal(missing.exitCode, 2);
  assert.match(errors.join("\n"), /--lonlat/u);

  const badTerrain = await runGeoCommand(["point", "--terrain", path.join(root, "nope.json"), "--lonlat", "139,35"], {
    logError: (line) => errors.push(line),
  });
  assert.equal(badTerrain.exitCode, 1);
});

test("geo point: --exaggeration はシーンの値を上書きする（CLI も）", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-geo-point-exaggeration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "heightmap.png"), encodeRgbPng(heightmap().rgb, RECT.width, RECT.height));
  const terrainPath = path.join(root, "terrain.json");
  await writeFile(terrainPath, JSON.stringify(TERRAIN));
  const centerLon = pixelXToLon(RECT.left + RECT.width / 2);
  const centerLat = pixelYToLat(RECT.top + RECT.height / 2);

  const doubled = terrainPoint({
    terrain: TERRAIN, image: heightmap(), lon: centerLon, lat: centerLat, exaggeration: 2,
  });
  assert.ok(Math.abs(doubled.y - 6) < 1e-9);
  assert.throws(
    () => terrainPoint({ terrain: TERRAIN, image: heightmap(), lon: centerLon, lat: centerLat, exaggeration: 0 }),
    /exaggeration は正の数値/u,
  );

  const lines = [];
  const errors = [];
  const result = await runGeoCommand([
    "point", "--terrain", terrainPath, "--lonlat", `${centerLon},${centerLat}`, "--exaggeration", "2",
  ], { log: (line) => lines.push(line), logError: (line) => errors.push(line) });
  assert.equal(result.exitCode, 0, errors.join("\n"));
  assert.deepEqual(JSON.parse(lines.at(-1)), [0, 6, 0]);
});

test("geo point: プロジェクト基準の declaration から高さマップを見つける", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "akari-geo-point-project-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const terrainDir = path.join(project, "overlays", "terrain");
  await mkdir(terrainDir, { recursive: true });
  await writeFile(path.join(project, "edit.json"), "{}\n");
  await writeFile(path.join(terrainDir, "heightmap.png"), encodeRgbPng(heightmap().rgb, RECT.width, RECT.height));
  const terrain = {
    ...TERRAIN,
    declaration: { ...TERRAIN.declaration, heightmap: "overlays/terrain/heightmap.png" },
  };
  const terrainPath = path.join(terrainDir, "terrain.json");
  await writeFile(terrainPath, JSON.stringify(terrain));

  const loaded = await loadTerrainFiles(terrainPath);
  assert.equal(loaded.heightmapPath, path.join(terrainDir, "heightmap.png"));
  assert.equal(loaded.image.width, RECT.width);

  // プロジェクトの外へ移しても、terrain.json と同じ場所のファイル名で見つかる。
  const movedDir = path.join(root, "moved");
  await mkdir(movedDir, { recursive: true });
  await writeFile(path.join(movedDir, "heightmap.png"), encodeRgbPng(heightmap().rgb, RECT.width, RECT.height));
  const movedPath = path.join(movedDir, "terrain.json");
  await writeFile(movedPath, JSON.stringify(terrain));
  const moved = await loadTerrainFiles(movedPath);
  assert.equal(moved.heightmapPath, path.join(movedDir, "heightmap.png"));
});
