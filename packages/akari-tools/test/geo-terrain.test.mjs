import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runGeoCommand } from "../bin/geo.mjs";
import { encodeRgbPng, decodeRgbPng } from "../src/geo/png.mjs";
import { MISSING_PHOTO_RGB, decodeElevation, fillInvalidDem, isInvalidDem } from "../src/geo/raster.mjs";
import { ATTRIBUTION, buildTerrain } from "../src/geo/terrain.mjs";
import { cropRect, sizeMeters } from "../src/geo/tiles.mjs";
import { toolsText } from "../src/i18n.mjs";

const BBOX = "139.7680,35.6750,139.7681,35.6753";
const SAGAMIHARA = "139.3445,35.5960,139.3555,35.6050";
const ZOOM = 14;

function encodeElevation(meters) {
  let encoded = Math.round(meters * 100);
  if (encoded < 0) encoded += 0x1000000;
  return [(encoded >> 16) & 0xff, (encoded >> 8) & 0xff, encoded & 0xff];
}

function demTile(x, y) {
  const base = 100 + (x - 14552) * 10 + (y - 6451);
  const [r, g, b] = encodeElevation(base);
  const rgb = Buffer.alloc(256 * 256 * 3);
  for (let index = 0; index < 256 * 256; index += 1) {
    rgb[index * 3] = r;
    rgb[index * 3 + 1] = g;
    rgb[index * 3 + 2] = b;
  }
  if (x === 14553 && y === 6452) {
    for (const [column, row] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      rgb.set([128, 0, 0], (row * 256 + column) * 3);
    }
  }
  return encodeRgbPng(rgb, 256, 256);
}

function photoTile(x, y) {
  const rgb = Buffer.alloc(256 * 256 * 3);
  for (let index = 0; index < 256 * 256; index += 1) {
    rgb[index * 3] = (x - 14552) * 100;
    rgb[index * 3 + 1] = (y - 6451) * 100;
    rgb[index * 3 + 2] = 7;
  }
  return encodeRgbPng(rgb, 256, 256);
}

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const match = /\/xyz\/(dem_png|seamlessphoto)\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)$/u.exec(url);
    assert.ok(match, `想定外の URL: ${url}`);
    const [, layer, zoom, x, y] = match;
    assert.equal(Number(zoom), ZOOM);
    const bytes = layer === "dem_png" ? demTile(Number(x), Number(y)) : photoTile(Number(x), Number(y));
    return { ok: true, status: 200, arrayBuffer: async () => bytes };
  };
  return { calls, fetchImpl };
}

/** 指定したタイルだけ 404 を返す fetch（海・範囲外の再現）。 */
function fetchWithMissing({ demMissing = [], photoMissing = [] } = {}) {
  const dem = new Set(demMissing);
  const photo = new Set(photoMissing);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const match = /\/xyz\/(dem_png|seamlessphoto)\/(\d+)\/(\d+)\/(\d+)\.(png|jpg)$/u.exec(url);
    assert.ok(match, `想定外の URL: ${url}`);
    const [, layer, zoom, x, y] = match;
    assert.equal(Number(zoom), ZOOM);
    const missing = layer === "dem_png" ? dem.has(`${x},${y}`) : photo.has(`${x},${y}`);
    if (missing) return { ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) };
    const bytes = layer === "dem_png" ? demTile(Number(x), Number(y)) : photoTile(Number(x), Number(y));
    return { ok: true, status: 200, arrayBuffer: async () => bytes };
  };
  return { calls, fetchImpl };
}

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), "akari-geo-terrain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("geo terrain: 2x2 タイルを結合・切り出しし 3 ファイルを書く", async (t) => {
  const root = await workspace(t);
  const out = path.join(root, "out");
  const { calls, fetchImpl } = fakeFetch();
  const lines = [];
  const result = await buildTerrain({
    bbox: BBOX,
    zoom: ZOOM,
    outDir: out,
    cacheDir: path.join(root, "cache"),
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.equal(calls.length, 8);
  assert.deepEqual(result.tiles, { count: 4, fetched: 8, cached: 0 });
  assert.deepEqual(result.missing, { dem: 0, photo: 0 });
  assert.equal(result.filled, 2);
  assert.deepEqual(result.size, [2, 6]);
  assert.deepEqual(result.terrain, {
    bbox: [139.768, 35.675, 139.7681, 35.6753],
    zoom: 14,
    size_m: sizeMeters({ bbox: { west: 139.768, south: 35.675, east: 139.7681, north: 35.6753 }, zoom: 14 }),
    elevation_m: [100, 111],
    encoding: "gsi-dem",
    missing_tiles: { dem: 0, photo: 0 },
    attribution: "出典: 国土地理院（地理院タイル）",
  });
  assert.equal(result.terrain.attribution, ATTRIBUTION);
  assert.ok(lines.some((line) => line.includes("出典: 国土地理院")));
  assert.ok(lines.some((line) => line.includes("無効値を 2 画素補間")));

  for (const file of Object.values(result.files)) assert.ok((await stat(file)).isFile(), file);
  const written = JSON.parse(await readFile(result.files.terrain, "utf8"));
  assert.equal(written.attribution, "出典: 国土地理院（地理院タイル）");
  assert.equal((await readFile(result.files.terrain, "utf8")).includes("国土地理院"), true);

  const heightmap = decodeRgbPng(await readFile(result.files.heightmap));
  assert.equal(heightmap.width, 2);
  assert.equal(heightmap.height, 6);
  for (let index = 0; index < heightmap.width * heightmap.height; index += 1) {
    assert.equal(isInvalidDem(heightmap.rgb, index), false, `画素 ${index} が無効値のまま`);
  }

  const texture = decodeRgbPng(await readFile(result.files.texture));
  assert.equal(texture.width, 2);
  assert.equal(texture.height, 6);
  const pixel = (x, y) => [...texture.rgb.subarray((y * texture.width + x) * 3, (y * texture.width + x) * 3 + 3)];
  assert.deepEqual(pixel(0, 0), [0, 0, 7]);
  assert.deepEqual(pixel(1, 0), [100, 0, 7]);
  assert.deepEqual(pixel(0, 3), [0, 100, 7]);
  assert.deepEqual(pixel(1, 3), [100, 100, 7]);
});

test("geo terrain: 2 回目はキャッシュを再利用し取得しない", async (t) => {
  const root = await workspace(t);
  const cacheDir = path.join(root, "cache");
  const first = fakeFetch();
  await buildTerrain({ bbox: BBOX, zoom: ZOOM, outDir: path.join(root, "first"), cacheDir, fetchImpl: first.fetchImpl });
  assert.equal(first.calls.length, 8);

  const second = await buildTerrain({
    bbox: BBOX,
    zoom: ZOOM,
    outDir: path.join(root, "second"),
    cacheDir,
    fetchImpl: async (url) => { throw new Error(`キャッシュ済みなのに取得した: ${url}`); },
  });
  assert.deepEqual(second.tiles, { count: 4, fetched: 0, cached: 8 });
  const cached = await readdir(path.join(cacheDir, "dem_png", "14", "14552"));
  assert.ok(cached.includes("6451.png"));
  assert.ok((await stat(path.join(cacheDir, "seamlessphoto", "14", "14553", "6452.jpg"))).isFile());
});

test("geo terrain: 一部の標高タイルが 404 でも成功し、その範囲を無効値として補間する", async (t) => {
  const root = await workspace(t);
  const out = path.join(root, "out");
  const { fetchImpl } = fetchWithMissing({ demMissing: ["14553,6452"] });
  const lines = [];
  const result = await buildTerrain({
    bbox: BBOX,
    zoom: ZOOM,
    outDir: out,
    cacheDir: path.join(root, "cache"),
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.deepEqual(result.missing, { dem: 1, photo: 0 });
  assert.deepEqual(result.terrain.missing_tiles, { dem: 1, photo: 0 });
  // 404 のタイルが覆う切り出し内の 3 画素が補間される。
  assert.equal(result.filled, 3);
  // 404 のタイルが持っていた標高 111m は範囲に数えない。
  assert.deepEqual(result.terrain.elevation_m, [100, 110]);

  const heightmap = decodeRgbPng(await readFile(result.files.heightmap));
  assert.equal(heightmap.width, 2);
  assert.equal(heightmap.height, 6);
  for (let index = 0; index < heightmap.width * heightmap.height; index += 1) {
    assert.equal(isInvalidDem(heightmap.rgb, index), false, `画素 ${index} が無効値のまま`);
  }
  assert.ok(lines.includes(toolsText("tools.geo.notice.missingTiles", { dem: 1, photo: 0 })));
});

test("geo terrain: 標高タイルがすべて 404 なら i18n の文言で止まる", async (t) => {
  const root = await workspace(t);
  const { calls, fetchImpl } = fetchWithMissing({ demMissing: ["14552,6451", "14553,6451", "14552,6452", "14553,6452"] });
  const expected = toolsText("tools.geo.error.allDemTilesMissing", { bbox: BBOX });
  assert.notEqual(expected, "tools.geo.error.allDemTilesMissing");
  assert.match(expected, /404/u);

  await assert.rejects(
    () => buildTerrain({
      bbox: BBOX,
      zoom: ZOOM,
      outDir: path.join(root, "out"),
      cacheDir: path.join(root, "cache"),
      fetchImpl,
    }),
    (error) => {
      assert.equal(error.message, expected);
      return true;
    },
  );
  // 標高で止まるので写真タイルは取りに行かない。
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.includes("/dem_png/")));
});

test("geo terrain: 写真タイルが 404 なら単色で埋め missing_tiles に記録する", async (t) => {
  const root = await workspace(t);
  const lines = [];
  const { fetchImpl } = fetchWithMissing({
    photoMissing: ["14552,6451", "14553,6451", "14552,6452", "14553,6452"],
  });
  const result = await buildTerrain({
    bbox: BBOX,
    zoom: ZOOM,
    outDir: path.join(root, "out"),
    cacheDir: path.join(root, "cache"),
    fetchImpl,
    log: (line) => lines.push(line),
  });

  assert.deepEqual(result.missing, { dem: 0, photo: 4 });
  assert.deepEqual(result.terrain.missing_tiles, { dem: 0, photo: 4 });
  const texture = decodeRgbPng(await readFile(result.files.texture));
  assert.equal(texture.width, 2);
  assert.equal(texture.height, 6);
  for (let index = 0; index < texture.width * texture.height; index += 1) {
    assert.deepEqual(
      [...texture.rgb.subarray(index * 3, index * 3 + 3)],
      [...MISSING_PHOTO_RGB],
      `画素 ${index} が単色で埋まっていない`,
    );
  }
  assert.ok(lines.includes(toolsText("tools.geo.notice.missingTiles", { dem: 0, photo: 4 })));
});

test("geo terrain: 404 以外の 4xx は再試行せず、5xx は再試行して成功する", async (t) => {
  const root = await workspace(t);
  const forbiddenCalls = [];
  await assert.rejects(
    () => buildTerrain({
      bbox: BBOX,
      zoom: ZOOM,
      outDir: path.join(root, "forbidden"),
      cacheDir: path.join(root, "cache-forbidden"),
      fetchImpl: async (url) => {
        forbiddenCalls.push(url);
        return { ok: false, status: 403, arrayBuffer: async () => Buffer.alloc(0) };
      },
    }),
    /HTTP 403/u,
  );
  assert.equal(forbiddenCalls.length, 1);

  const base = fakeFetch();
  let attempts = 0;
  const flaky = async (url) => {
    attempts += 1;
    if (attempts <= 2) return { ok: false, status: 500, arrayBuffer: async () => Buffer.alloc(0) };
    return base.fetchImpl(url);
  };
  const result = await buildTerrain({
    bbox: BBOX,
    zoom: ZOOM,
    outDir: path.join(root, "retried"),
    cacheDir: path.join(root, "cache-retried"),
    fetchImpl: flaky,
  });
  assert.equal(attempts, 10, "最初の 1 枚は 2 回失敗して 3 回目に成功し、残り 7 枚は 1 回で成功する");
  assert.deepEqual(result.tiles, { count: 4, fetched: 8, cached: 0 });
});

test("geo terrain: 上限タイル数を超えたら zoom を下げる案内で止まる", async (t) => {
  const root = await workspace(t);
  let called = false;
  await assert.rejects(
    () => buildTerrain({
      bbox: SAGAMIHARA,
      zoom: ZOOM,
      outDir: path.join(root, "out"),
      maxTiles: 3,
      cacheDir: path.join(root, "cache"),
      fetchImpl: async () => { called = true; throw new Error("呼ばない"); },
    }),
    /タイル数が上限（3）を超えます.*--zoom 12 以下を指定してください/su,
  );
  assert.equal(called, false);
});

test("geo terrain: 無効値は最寄りの有効画素で埋まり、標高の範囲は有効値だけから出す", () => {
  const rgb = Buffer.from([
    1, 2, 3, 1, 2, 3, 1, 2, 3,
    1, 2, 3, 128, 0, 0, 1, 2, 3,
    1, 2, 3, 1, 2, 3, 4, 5, 6,
  ]);
  const result = fillInvalidDem(rgb, 3, 3);
  assert.equal(result.validCount, 8);
  assert.equal(result.filledCount, 1);
  assert.equal(isInvalidDem(rgb, 4), false);
  assert.deepEqual([...rgb.subarray(12, 15)], [1, 2, 3]);
  assert.equal(decodeElevation(0, 39, 16), 100);
  assert.equal(decodeElevation(0xff, 0xff, 0xff), -0.01);
});

test("geo terrain: bbox の外側は切り出さず、寸法は被覆画素に一致する", () => {
  const rect = cropRect({ west: 139.768, south: 35.675, east: 139.7681, north: 35.6753 }, 14);
  assert.equal(rect.width, 2);
  assert.equal(rect.height, 6);
});

test("geo terrain CLI: --bbox と --out を必須にし、--json に出典を含める", async (t) => {
  const root = await workspace(t);
  const errors = [];
  const missing = await runGeoCommand(["terrain", "--bbox", BBOX], { logError: (line) => errors.push(line) });
  assert.equal(missing.exitCode, 2);
  assert.match(errors.join("\n"), /--out/);

  const unknown = await runGeoCommand(["mountain"], { logError: (line) => errors.push(line) });
  assert.equal(unknown.exitCode, 2);
  assert.match(errors.join("\n"), /不明な geo サブコマンド/);

  const messages = [];
  let received;
  const result = await runGeoCommand(
    ["terrain", "--bbox", BBOX, "--out", path.join(root, "out"), "--zoom", "14", "--max-tiles", "4", "--json"],
    {
      log: (line) => messages.push(line),
      buildTerrain: async (options) => {
        received = options;
        return {
          outDir: path.resolve(options.outDir),
          files: { heightmap: "h", texture: "t", terrain: "j" },
          terrain: { attribution: ATTRIBUTION, elevation_m: [1, 2] },
          size: [2, 6],
          tiles: { count: 4, fetched: 8, cached: 0 },
          filled: 0,
        };
      },
    },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(received.bbox, BBOX);
  assert.equal(received.zoom, "14");
  assert.equal(received.maxTiles, "4");
  const output = JSON.parse(messages.at(-1));
  assert.equal(output.terrain.attribution, ATTRIBUTION);
  assert.equal(output.tiles.count, 4);
});
