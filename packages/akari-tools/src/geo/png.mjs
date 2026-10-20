// 地理院タイルの PNG 読み書き。外部パッケージは使わず Node 標準の zlib だけで扱う。
// 標高タイル（dem_png）は 8bit RGB、写真タイルは JPEG なので、ここでは PNG だけを担う。
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = new Map([
  [0, 1], // grayscale
  [2, 3], // RGB
  [3, 1], // palette
  [4, 2], // grayscale + alpha
  [6, 4], // RGBA
]);

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

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return out;
}

/** RGB のバイト列（幅 * 高さ * 3）を PNG にする。 */
export function encodeRgbPng(rgb, width, height) {
  if (!Buffer.isBuffer(rgb)) throw new TypeError("PNG の画素は Buffer で渡してください");
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("PNG の幅・高さは正の整数で指定してください");
  }
  if (rgb.length !== width * height * 3) {
    throw new RangeError(`PNG の画素数が足りません: ${rgb.length} バイト（期待 ${width * height * 3}）`);
  }
  const stride = width * 3;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    rgb.copy(scanlines, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: RGB
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function readChunks(bytes) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("PNG の署名がありません");
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error(`PNG の ${type} チャンクが途中で切れています`);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function paeth(left, up, upperLeft) {
  const p = left + up - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upperLeft;
}

/** 8bit PNG を読み、RGB のバイト列（幅 * 高さ * 3）にする。 */
export function decodeRgbPng(bytes) {
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  const chunks = readChunks(bytes);
  const ihdr = chunks.find((entry) => entry.type === "IHDR")?.data;
  if (!ihdr || ihdr.length < 13) throw new Error("PNG の IHDR がありません");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];
  if (compression !== 0 || filter !== 0) throw new Error("PNG の圧縮・フィルタ方式が未対応です");
  if (interlace !== 0) throw new Error("インターレース PNG は未対応です");
  if (bitDepth !== 8) throw new Error(`PNG のビット深度 ${bitDepth} は未対応です（8bit のみ）`);
  const channels = CHANNELS.get(colorType);
  if (!channels) throw new Error(`PNG の色種別 ${colorType} は未対応です`);
  const palette = chunks.find((entry) => entry.type === "PLTE")?.data;
  if (colorType === 3 && !palette) throw new Error("パレット PNG に PLTE がありません");

  const idat = Buffer.concat(chunks.filter((entry) => entry.type === "IDAT").map((entry) => entry.data));
  if (!idat.length) throw new Error("PNG の IDAT がありません");
  const raw = inflateSync(idat);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG の画素データが足りません");

  const scanlines = Buffer.alloc(stride * height);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filterType = raw[source];
    source += 1;
    const target = row * stride;
    const previous = target - stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[source + column];
      const left = column >= channels ? scanlines[target + column - channels] : 0;
      const up = row > 0 ? scanlines[previous + column] : 0;
      const upperLeft = row > 0 && column >= channels ? scanlines[previous + column - channels] : 0;
      let restored;
      if (filterType === 0) restored = value;
      else if (filterType === 1) restored = value + left;
      else if (filterType === 2) restored = value + up;
      else if (filterType === 3) restored = value + Math.floor((left + up) / 2);
      else if (filterType === 4) restored = value + paeth(left, up, upperLeft);
      else throw new Error(`PNG のフィルタ種別 ${filterType} は未対応です`);
      scanlines[target + column] = restored & 0xff;
    }
    source += stride;
  }

  const rgb = Buffer.alloc(width * height * 3);
  for (let index = 0, target = 0; index < width * height; index += 1, target += 3) {
    const base = index * channels;
    if (colorType === 2) {
      rgb[target] = scanlines[base];
      rgb[target + 1] = scanlines[base + 1];
      rgb[target + 2] = scanlines[base + 2];
    } else if (colorType === 6) {
      rgb[target] = scanlines[base];
      rgb[target + 1] = scanlines[base + 1];
      rgb[target + 2] = scanlines[base + 2];
    } else if (colorType === 0 || colorType === 4) {
      rgb[target] = scanlines[base];
      rgb[target + 1] = scanlines[base];
      rgb[target + 2] = scanlines[base];
    } else {
      const paletteIndex = scanlines[base] * 3;
      rgb[target] = palette[paletteIndex];
      rgb[target + 1] = palette[paletteIndex + 1];
      rgb[target + 2] = palette[paletteIndex + 2];
    }
  }
  return { width, height, rgb };
}
