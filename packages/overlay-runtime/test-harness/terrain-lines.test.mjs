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

test("terrain: gsi-dem は RGB の符号化を標高へ復号し、no-data は 0 にする", () => {
  const encode = (elevation) => {
    const raw = Math.round((elevation + 10000) / 0.01);
    return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
  };
  const sea = encode(0);
  const mountain = encode(100);
  assert.ok(Math.abs(runtime.decodeGsiDem(...sea) - 0) < 1e-9);
  assert.ok(Math.abs(runtime.decodeGsiDem(...mountain) - 100) < 1e-9);
  assert.equal(runtime.decodeGsiDem(128, 0, 0), null);
  const data = new Uint8ClampedArray([
    ...sea, 255, ...mountain, 255,
    ...encode(-50), 255, 128, 0, 0, 255,
  ]);
  const built = runtime.buildTerrainGeometryData({
    imageData: { width: 2, height: 2, data },
    segments: 1,
    size: [2, 2],
    exaggeration: 1,
    encoding: "gsi-dem",
  });
  assert.deepEqual([...built.heights], [0, 100, -50, 0]);
  assert.ok(Math.abs(built.maxHeight - 100) < 1e-9);
  assert.ok(Math.abs(built.minHeight + 50) < 1e-9);
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
  const full = runtime.validateTerrain({
    heightmap: "h.png", texture: "photo.jpg", encoding: "gsi-dem",
    exaggeration: 3, size: [20, 30], segments: 256,
  });
  assert.equal(full.encoding, "gsi-dem");
  assert.equal(full.exaggeration, 3);
  assert.deepEqual([...full.size], [20, 30]);
  assert.equal(full.segments, 256);
});

test("terrain: 宣言の負例は理由つきで拒否", () => {
  assert.throws(() => runtime.validateTerrain(null), /object/u);
  assert.throws(() => runtime.validateTerrain({}), /heightmap/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", encoding: "dem" }), /gsi-dem/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", exaggeration: 0 }), /exaggeration/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", exaggeration: 101 }), /exaggeration/u);
  assert.throws(() => runtime.validateTerrain({ heightmap: "h.png", size: [0, 10] }), /size/u);
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
});

test("lines: 折れ線の累積距離", () => {
  assert.deepEqual([...runtime.lineCumulativeLengths([[0, 0, 0], [3, 0, 0], [3, 4, 0]])], [0, 3, 7]);
});
