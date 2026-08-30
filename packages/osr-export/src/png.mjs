import { deflateSync } from "node:zlib";

export function encodeRgbaPng(rgba, width, height) {
  validatePixels(rgba, width, height);
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }
  return encodeRgbPng(rgb, width, height);
}

export function encodeBgraPng(bgra, width, height) {
  validatePixels(bgra, width, height);
  const rgb = Buffer.allocUnsafe(width * height * 3);
  for (let source = 0, target = 0; source < bgra.length; source += 4, target += 3) {
    rgb[target] = bgra[source + 2];
    rgb[target + 1] = bgra[source + 1];
    rgb[target + 2] = bgra[source];
  }
  return encodeRgbPng(rgb, width, height);
}

function validatePixels(pixels, width, height) {
  if (!Buffer.isBuffer(pixels) && !(pixels instanceof Uint8Array)) {
    throw new TypeError("PNG pixels must be a Buffer or Uint8Array");
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("PNG dimensions must be positive integers");
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError(`PNG pixels have ${pixels.length} bytes; expected ${width * height * 4}`);
  }
}

function encodeRgbPng(rgb, width, height) {
  const stride = width * 3;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    rgb.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
