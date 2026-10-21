// terrain（高さマップ PNG / gsi-dem）と lines（progress / keys）の純関数テスト。
//
// three-runtime.js はブラウザ IIFE なので window だけ差して読み込み、公開した純関数を叩く。
// PNG は test-harness/fixtures/terrain-4x4.png（4x4・8bit グレースケール）を使い、
// 既知の画素値から頂点の高さを検算する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { runInNewContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../src/three-runtime.js"), "utf8");
const context = { window: {} };
runInNewContext(SOURCE, context, { filename: "three-runtime.js" });
const runtime = context.window.akari.threeRuntime;

// 最小の PNG デコーダ（8bit・非インターレース・color type 0/2）。fixture と、
// テスト内で組んだ gsi-dem の 2x2 RGB 画像だけを読む。
function decodePng(path) {
  const buffer = readFileSync(path);
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8);
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = source[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * channels;
    data[index * 4] = pixels[source];
    data[index * 4 + 1] = channels >= 3 ? pixels[source + 1] : pixels[source];
    data[index * 4 + 2] = channels >= 3 ? pixels[source + 2] : pixels[source];
    data[index * 4 + 3] = channels === 4 ? pixels[source + 3] : 255;
  }
  return { width, height, data };
}

const FIXTURE = decodePng(resolve(HERE, "fixtures/terrain-4x4.png"));
// 地理院 dem_png と同じ 8bit RGB。2x2 の既知値: 539.47 m / 100 m / -50 m / 無効値。
const GSI_FIXTURE = decodePng(resolve(HERE, "fixtures/terrain-gsi-dem-2x2.png"));

test("terrain: 既知の 4x4 PNG から頂点の高さが期待値になる", () => {
  const built = runtime.buildTerrainGeometryData({
    imageData: FIXTURE,
    segments: 2,
    size: [4, 6],
    exaggeration: 2,
    encoding: "grayscale",
  });
  assert.equal(built.segments, 2);
  assert.equal(built.positions.length, 9 * 3);
  assert.equal(built.indices.length, 2 * 2 * 6);
  // grid の index = iz * 3 + ix。fixture の行 0 は 0, 51, 102, 153。
  const heightAt = (ix, iz) => built.positions[(iz * 3 + ix) * 3 + 1];
  assert.equal(heightAt(0, 0), 0);
  assert.ok(Math.abs(heightAt(1, 0) - (102 / 255) * 2) < 1e-6);
  assert.ok(Math.abs(heightAt(2, 0) - (153 / 255) * 2) < 1e-6);
  assert.ok(Math.abs(heightAt(0, 1) - (102 / 255) * 2) < 1e-6);
  assert.ok(Math.abs(heightAt(2, 1) - (255 / 255) * 2) < 1e-6);
  assert.ok(Math.abs(heightAt(0, 2) - (51 / 255) * 2) < 1e-6);
  // 画像の行 0（上端）が奥（-z）、列 0 が左（-x）。UV の v は上端 = 1。
  assert.deepEqual([built.positions[0], built.positions[2]], [-2, -3]);
  assert.deepEqual([built.positions[8 * 3], built.positions[8 * 3 + 2]], [2, 3]);
  assert.deepEqual([built.uvs[0], built.uvs[1]], [0, 1]);
  assert.deepEqual([built.uvs[8 * 2], built.uvs[8 * 2 + 1]], [1, 0]);
});

test("terrain: gsi-dem は国土地理院の式（符号付き 24bit・100 分の 1 m）で復号する", () => {
  const encodeRaw = (raw) => [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
  // 地理院の実タイルに現れる生値 53947 は 539.47 m（旧式の -9460 m ではない）。
  assert.equal(runtime.decodeGsiDem(...encodeRaw(53947)), 539.47);
  assert.equal(runtime.decodeGsiDem(...encodeRaw(0)), 0);
  assert.equal(runtime.decodeGsiDem(...encodeRaw(10000)), 100);
  // x > 2^23 は (x - 2^24) * 0.01。負の標高も同じ式で読める。
  assert.equal(runtime.decodeGsiDem(...encodeRaw(0x1000000 - 5000)), -50);
  assert.equal(runtime.decodeGsiDem(...encodeRaw(0xffffff)), -0.01);
  // x = 2^23（RGB 128,0,0）は無効値。
  assert.equal(runtime.decodeGsiDem(128, 0, 0), null);
  assert.equal(runtime.decodeGsiDem(...encodeRaw(0x800000)), null);
  assert.equal(runtime.decodeGsiDem(...encodeRaw(0x800001)), -83886.07);

  const built = runtime.buildTerrainGeometryData({
    imageData: GSI_FIXTURE,
    segments: 1,
    size: [2, 2],
    exaggeration: 1,
    encoding: "gsi-dem",
    meters: [200, 200],
  });
  // baseline の既定は "min": 最低標高 -50 m が y=0。実寸は size/meters = 1/100。
  assert.equal(built.validSamples, 3);
  const expected = [539.47, 100, -50].map((elevation) => (elevation + 50) * 0.01);
  for (const [index, value] of expected.entries()) {
    assert.ok(Math.abs(built.heights[index] - value) < 1e-9, `${index}: ${built.heights[index]} != ${value}`);
  }
  // 無効値の画素は 0 m として扱い、地形を欠けさせない（baseline min では -50 m が 0）。
  assert.ok(Math.abs(built.heights[3] - 0.5) < 1e-9);
  assert.ok(Math.abs(built.minHeight - 0) < 1e-9);
  assert.ok(Math.abs(built.maxHeight - ((539.47 + 50) * 0.01)) < 1e-9);
  assert.ok(Math.abs(built.verticalScale - 0.01) < 1e-12);
});

test("terrain: baseline sea は標高 0 m を y=0 にし、exaggeration はその上に掛かる", () => {
  const encodeRaw = (raw) => [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
  const built = runtime.buildTerrainGeometryData({
    imageData: GSI_FIXTURE,
    segments: 1,
    size: [2, 2],
    exaggeration: 2,
    encoding: "gsi-dem",
    meters: [200, 200],
    baseline: "sea",
  });
  assert.ok(Math.abs(built.heights[0] - 539.47 * 0.01 * 2) < 1e-9);
  assert.ok(Math.abs(built.heights[1] - 100 * 0.01 * 2) < 1e-9);
  assert.ok(Math.abs(built.heights[2] - -50 * 0.01 * 2) < 1e-9);
  assert.ok(Math.abs(built.minHeight - -1) < 1e-9);
});

test("terrain: baseline min は間引いた格子ではなく画像全体の最低標高を使う", () => {
  const encodeRaw = (raw) => [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
  const elevations = [100, 100, 100, 100, -50, 100, 100, 100, 100];
  const data = new Uint8ClampedArray(elevations.flatMap((value) => [
    ...encodeRaw(value < 0 ? 0x1000000 + Math.round(value * 100) : Math.round(value * 100)), 255,
  ]));
  const built = runtime.buildTerrainGeometryData({
    imageData: { width: 3, height: 3, data },
    segments: 1,
    size: [2, 2],
    meters: [200, 200],
    encoding: "gsi-dem",
  });
  assert.equal(built.elevationMin, -50);
  assert.equal(built.validSamples, 9);
  // 格子は四隅（100 m）だけを標本するが、baseline は全体の -50 m。100 m は 1.5。
  for (const height of built.heights) assert.ok(Math.abs(height - 1.5) < 1e-9);
});

test("terrain: grayscale は meters / baseline を足しても既存の高さのまま", () => {
  const built = runtime.buildTerrainGeometryData({
    imageData: FIXTURE,
    segments: 2,
    size: [4, 6],
    exaggeration: 2,
    encoding: "grayscale",
    meters: [500, 500],
    baseline: "sea",
  });
  const heightAt = (ix, iz) => built.positions[(iz * 3 + ix) * 3 + 1];
  assert.equal(heightAt(0, 0), 0);
  assert.ok(Math.abs(heightAt(1, 0) - (102 / 255) * 2) < 1e-6);
  assert.ok(Math.abs(built.maxHeight - 2) < 1e-6);
});

test("terrain: 読み込み失敗・全画素無効・視野外の警告文を返す", () => {
  assert.match(runtime.terrainWarningMessages({ error: new Error("404") })[0], /読み込めません.*404/u);
  assert.equal(runtime.terrainWarningMessages({ validSamples: 3, visible: true }).length, 0);
  assert.match(runtime.terrainWarningMessages({ validSamples: 0 })[0], /すべて無効値/u);
  assert.match(runtime.terrainWarningMessages({ validSamples: 3, visible: false })[0], /視野に入っていません/u);
  assert.equal(runtime.terrainWarningMessages({ validSamples: 0, visible: false }).length, 2);
});

test("terrain: 実寸の縮尺は size / meters の比", () => {
  assert.equal(runtime.terrainVerticalScale([10, 10], null), 1);
  assert.equal(runtime.terrainVerticalScale([7, 7], [700, 700]), 0.01);
  assert.equal(runtime.terrainVerticalScale([20, 10], [2000, 1000]), 0.01);
});

test("terrain: 既定の segments は画像の解像度に合わせ、上限 512", () => {
  assert.equal(runtime.terrainSegmentsFor(undefined, 4, 4), 4);
  assert.equal(runtime.terrainSegmentsFor(undefined, 1000, 2000), 512);
  assert.equal(runtime.terrainSegmentsFor(16, 1000, 2000), 16);
});

test("terrain: 宣言の正例と既定値", () => {
  const defaults = runtime.validateTerrain({ heightmap: "media/height.png" });
  assert.equal(defaults.heightmap, "media/height.png");
  assert.equal(defaults.texture, null);
  assert.equal(defaults.encoding, "grayscale");
  assert.equal(defaults.exaggeration, 1);
  assert.deepEqual([...defaults.size], [10, 10]);
  assert.equal(defaults.segments, undefined);
  assert.equal(defaults.meters, null);
  assert.equal(defaults.baseline, "min");
  const full = runtime.validateTerrain({
    heightmap: "h.png", texture: "photo.jpg", encoding: "gsi-dem",
    exaggeration: 3, size: [20, 30], meters: [2000, 3000], baseline: "sea", segments: 256,
  });
  assert.equal(full.encoding, "gsi-dem");
  assert.equal(full.exaggeration, 3);
  assert.deepEqual([...full.size], [20, 30]);
  assert.deepEqual([...full.meters], [2000, 3000]);
  assert.equal(full.baseline, "sea");
  assert.equal(full.segments, 256);
});

test("terrain: 宣言の負例は理由つきで拒否", () => {
  assert.throws(() => runtime.validateTerrain(null), /object/u);
  assert.throws(() => runtime.validateTerrain({}), /heightmap/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", encoding: "dem" }), /gsi-dem/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", exaggeration: 0 }), /exaggeration/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", exaggeration: 101 }), /exaggeration/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", size: [0, 10] }), /size/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", meters: [0, 10] }), /meters/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", meters: [1] }), /meters/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", baseline: "ground" }), /baseline/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", segments: 0 }), /segments/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", segments: 513 }), /segments/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", segments: 1.5 }), /segments/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", color: "#fff" }), /未対応キー/u);
});

test("lines: progress の静的値と keys の前後保持・補間・ease", () => {
  const staticLine = runtime.validateLines([{
    points: [[0, 0, 0], [1, 0, 0]], progress: 0.25,
  }])[0];
  assert.equal(runtime.lineProgressAt(staticLine, 10), 0.25);

  const keys = runtime.validateLineKeys([
    { t: 0, progress: 0.2 },
    { t: 2, progress: 0.9, ease: "easeInOut" },
  ]);
  const animated = runtime.validateLines([{
    points: [[0, 0, 0], [1, 0, 0]], keys,
  }])[0];
  assert.equal(runtime.lineProgressAt(animated, -1), 0.2);
  assert.equal(runtime.lineProgressAt(animated, 0), 0.2);
  // easeInOut: u=0.2 → 4 * 0.2^3 = 0.032 → 0.2 + 0.7 * 0.032
  assert.ok(Math.abs(runtime.lineProgressAt(animated, 0.4) - (0.2 + 0.7 * 0.032)) < 1e-9);
  assert.equal(runtime.lineProgressAt(animated, 2), 0.9);
  assert.equal(runtime.lineProgressAt(animated, 99), 0.9);

  const linear = runtime.validateLines([{
    points: [[0, 0, 0], [1, 0, 0]],
    keys: runtime.validateLineKeys([{ t: 0, progress: 0 }, { t: 2, progress: 1 }]),
  }])[0];
  assert.ok(Math.abs(runtime.lineProgressAt(linear, 0.5) - 0.25) < 1e-9);
});

test("lines: keys の昇順違反は自動ソートせず両方の t を出す", () => {
  assert.throws(
    () => runtime.validateLineKeys([{ t: 2, progress: 0 }, { t: 1, progress: 1 }]),
    /昇順.*keys\[1\]\.t=1.*keys\[0\]\.t=2/u,
  );
  assert.throws(
    () => runtime.validateLineKeys([{ t: 1, progress: 0 }, { t: 1, progress: 1 }]),
    /昇順/u,
  );
  assert.throws(() => runtime.validateLineKeys([]), /1 個以上/u);
  assert.throws(() => runtime.validateLineKeys([{ t: 0, progress: 2 }]), /progress は 0〜1/u);
  assert.throws(() => runtime.validateLineKeys([{ t: 0, progress: 0, easing: "linear" }]), /未対応キー/u);
  assert.throws(() => runtime.validateLineKeys([{ t: 0, progress: 0, ease: "out" }]), /linear または easeInOut/u);
});

test("lines: points / color / width / progress の正例と負例", () => {
  const valid = runtime.validateLines([{
    points: [[0, 1, 2], [3, 4, 5]], color: "#12AbEf", width: 4, progress: 0,
  }])[0];
  assert.deepEqual(valid.points.map(point => [...point]), [[0, 1, 2], [3, 4, 5]]);
  assert.equal(valid.color, "#12AbEf");
  assert.equal(valid.width, 4);
  assert.equal(valid.keys, null);
  assert.throws(() => runtime.validateLines({}), /配列/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0]] }]), /2 点以上/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0], [1, 1]] }]), /\[x, y, z\]/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], color: "red" }]), /hex/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], width: 0 }]), /width/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], width: 65 }]), /width/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], progress: 1.5 }]), /progress/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], label: "a" }]), /未対応キー/u);
  // drape は真偽値、lift は 0 以上の数値（task 2026-10-21-terrain-line-drape）。
  const draped = runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], drape: true }])[0];
  assert.equal(draped.drape, true);
  assert.equal(draped.lift, 0.01);
  assert.equal(runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], drape: true, lift: 0 }])[0].lift, 0);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], drape: 1 }]), /drape は真偽値/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], drape: true, lift: -1 }]), /lift は 0 以上/u);
  assert.throws(() => runtime.validateLines([{ points: [[0, 0, 0], [1, 1, 1]], drape: true, lift: "1" }]), /lift は 0 以上/u);
});

test("lines: 折れ線の累積距離", () => {
  assert.deepEqual([...runtime.lineCumulativeLengths([[0, 0, 0], [3, 0, 0], [3, 4, 0]])], [0, 3, 7]);
});

// --- lines[].drape（task 2026-10-21-terrain-line-drape）---
// 2x2 の既知の高さ: (x=-1,z=-1)=0、(x=+1,z=-1)=2、(x=-1,z=+1)=0、(x=+1,z=+1)=0。
// 格子 1・size 2・exaggeration 2 なので、heights = [0, 2, 0, 0]。
function drapeSurface() {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  const set = (index, value) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  };
  set(0, 0);
  set(1, 255);
  set(2, 0);
  set(3, 0);
  return runtime.buildTerrainGeometryData({
    imageData: { width: 2, height: 2, data },
    segments: 1,
    size: [2, 2],
    exaggeration: 2,
    encoding: "grayscale",
  });
}

test("drape: 高さは地形メッシュと同じ三角形（a-c-b / b-c-d）で補間する", () => {
  const surface = drapeSurface();
  assert.deepEqual([...surface.heights].map(value => Math.round(value * 1e9) / 1e9), [0, 2, 0, 0]);
  const close = (actual, expected) => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  };
  // セル中央は対角線上。三角形 a-c-b の平面では a + s(b-a) + t(c-a)。
  close(runtime.terrainHeightAt(surface, 0, 0), 1);
  // 三角形 b-c-d の中（s=1, t=0.5）は d + (1-s)(c-d) + (1-t)(b-d) = 1。
  close(runtime.terrainHeightAt(surface, 1, 0), 1);
  close(runtime.terrainHeightAt(surface, 1, 1), 0);
  close(runtime.terrainHeightAt(surface, -1, -1), 0);
  // 地形の外は端へ丸める（NaN にしない）。
  close(runtime.terrainHeightAt(surface, -99, -99), 0);
  close(runtime.terrainHeightAt(surface, 99, 99), 0);
});

test("drape: 格子の細かさで分割し、途中の点も地表 + lift になる", () => {
  const surface = drapeSurface();
  const line = runtime.validateLines([{
    points: [[-1, 5, -1], [1, 5, 1]], drape: true, lift: 0.25,
  }])[0];
  const draped = runtime.drapeLineForScene(line, 0, surface);
  assert.equal(draped.warning, null);
  // 1 格子ぶんの対角線を格子の細かさ（1 セル 4 分割）で刻むので、中央 (0, 0) も点として入る。
  const points = JSON.parse(JSON.stringify(draped.line.points));
  assert.equal(points.length, 5);
  assert.deepEqual(points[2], [0, 1.25, 0]);
  // progress は分割後の全長に対する割合のまま（中央 = 半分）。
  const cumulative = runtime.lineCumulativeLengths(draped.line.points);
  const total = cumulative[cumulative.length - 1];
  assert.ok(Math.abs(cumulative[2] - total / 2) < 1e-9);
  // keys / progress は drape で変わらない。
  assert.equal(draped.line.progress, line.progress);
  assert.equal(draped.line.keys, line.keys);
  // drape でない線は同一の宣言をそのまま使う（既存の挙動を変えない）。
  const plain = runtime.validateLines([{ points: [[-1, 5, -1], [1, 5, 1]] }])[0];
  assert.equal(runtime.drapeLineForScene(plain, 0, surface).line, plain);
});

test("drape: terrain が無いシーンでは警告を 1 つ返し、宣言の y で描く", () => {
  const line = runtime.validateLines([{
    points: [[-1, 5, -1], [1, 6, 1]], drape: true,
  }])[0];
  const draped = runtime.drapeLineForScene(line, 0, null);
  assert.match(draped.warning, /lines\[0\]\.drape は true.*terrain が無い/u);
  assert.deepEqual(draped.line.points.map(point => [...point]), [[-1, 5, -1], [1, 6, 1]]);
});

test("drape: exaggeration / meters / baseline を変えても同じジオメトリの表面に載る", () => {
  const variants = [
    { exaggeration: 1, background: 0 },
    { exaggeration: 2, background: 0 },
    { exaggeration: 1, baseline: "sea" },
    { exaggeration: 2, baseline: "sea" },
  ];
  for (const variant of variants) {
    const surface = runtime.buildTerrainGeometryData({
      imageData: GSI_FIXTURE,
      segments: 1,
      size: [2, 2],
      encoding: "gsi-dem",
      meters: [200, 200],
      ...variant,
    });
    // 対角線上のセル中央は 0.5 * heights[b] + 0.5 * heights[c]（三角形 a-c-b の辺）。
    const expected = 0.5 * surface.heights[1] + 0.5 * surface.heights[2];
    assert.ok(Math.abs(runtime.terrainHeightAt(surface, 0, 0) - expected) < 1e-9, JSON.stringify(variant));
    const line = runtime.validateLines([{
      points: [[-1, 999, -1], [1, 999, 1]], drape: true, lift: 0.1,
    }])[0];
    for (const point of runtime.drapeLineForScene(line, 0, surface).line.points) {
      const surfaceHeight = runtime.terrainHeightAt(surface, point[0], point[2]);
      assert.ok(Math.abs(point[1] - (surfaceHeight + 0.1)) < 1e-9, JSON.stringify(variant));
    }
  }
});

// --- [akari-three] 警告の回収（task 2026-10-21-terrain-line-drape）---
test("warnings: [akari-three] の console.warn を溜め、drainWarnings で取り出せる", () => {
  const logged = [];
  const sinkContext = { window: {}, console: { warn: (...values) => logged.push(values.join(" ")) } };
  runInNewContext(SOURCE, sinkContext, { filename: "three-runtime.js" });
  const sinkRuntime = sinkContext.window.akari.threeRuntime;
  sinkRuntime.drainWarnings();
  sinkContext.console.warn("[akari-three] terrain がカメラの視野外です");
  sinkContext.console.warn("[akari-three] terrain がカメラの視野外です");
  sinkContext.console.warn("[akari-gpu] 3D 以外の警告");
  assert.deepEqual(Array.from(sinkRuntime.drainWarnings()), [
    "[akari-three] terrain がカメラの視野外です",
    "[akari-three] terrain がカメラの視野外です",
  ]);
  // 取り出した分は消える（同じ警告を二重に数えない）。
  assert.equal(sinkRuntime.drainWarnings().length, 0);
  // 元の console.warn の出力は変えない。
  assert.deepEqual(logged, [
    "[akari-three] terrain がカメラの視野外です",
    "[akari-three] terrain がカメラの視野外です",
    "[akari-gpu] 3D 以外の警告",
  ]);
});
