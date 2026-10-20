import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import { decodeRgbPng, encodeRgbPng } from "../src/geo/png.mjs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upperLeft;
}

/** 各行を指定フィルタで符号化した RGB PNG を作る（デコーダのフィルタ検査用）。 */
function pngWithFilter(rgb, width, height, filterType) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = filterType;
    for (let column = 0; column < stride; column += 1) {
      const value = rgb[row * stride + column];
      const left = column >= 3 ? rgb[row * stride + column - 3] : 0;
      const up = row > 0 ? rgb[(row - 1) * stride + column] : 0;
      const upperLeft = row > 0 && column >= 3 ? rgb[(row - 1) * stride + column - 3] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paeth(left, up, upperLeft);
      raw[row * (stride + 1) + 1 + column] = (value - predictor) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("geo png: RGB を書いて同じ画素で読める", () => {
  const width = 3;
  const height = 2;
  const rgb = Buffer.from([
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    250, 251, 252, 128, 0, 0, 0, 255, 0,
  ]);
  const png = encodeRgbPng(rgb, width, height);
  const decoded = decodeRgbPng(png);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual(decoded.rgb, rgb);
});

test("geo png: フィルタ種別 0〜4 を復元できる", () => {
  const width = 4;
  const height = 3;
  const rgb = Buffer.alloc(width * height * 3);
  for (let index = 0; index < rgb.length; index += 1) rgb[index] = (index * 37 + 11) & 0xff;
  for (let filterType = 0; filterType <= 4; filterType += 1) {
    const decoded = decodeRgbPng(pngWithFilter(rgb, width, height, filterType));
    assert.deepEqual(decoded.rgb, rgb, `filter ${filterType}`);
  }
});

test("geo png: 壊れた入力は理由付きで拒否する", () => {
  assert.throws(() => decodeRgbPng(Buffer.from("not png")), /署名/);
  assert.throws(() => encodeRgbPng(Buffer.alloc(5), 2, 2), /画素数/);
  assert.throws(() => encodeRgbPng(Buffer.alloc(12), 0, 2), /正の整数/);
});
