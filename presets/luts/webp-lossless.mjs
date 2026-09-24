// Small deterministic VP8L writer for opaque, indexed preview art.
// Format: https://developers.google.com/speed/webp/docs/webp_lossless_bitstream_specification

class Bits {
  bytes = [];
  value = 0;
  count = 0;

  put(value, count) {
    for (let bit = 0; bit < count; bit += 1) {
      this.value |= ((value >>> bit) & 1) << this.count;
      if (++this.count === 8) {
        this.bytes.push(this.value);
        this.value = 0;
        this.count = 0;
      }
    }
  }

  finish() {
    if (this.count) this.bytes.push(this.value);
    return Buffer.from(this.bytes);
  }
}

function reverse(value, length) {
  let reversed = 0;
  for (let bit = 0; bit < length; bit += 1) reversed = (reversed << 1) | ((value >>> bit) & 1);
  return reversed;
}

function codes(lengths) {
  if (lengths.filter(Boolean).length === 1)
    return lengths.map(length => length ? [0, 0] : null);
  const counts = Array(16).fill(0);
  for (const length of lengths) if (length) counts[length] += 1;
  const next = Array(16).fill(0);
  let code = 0;
  for (let length = 1; length < 16; length += 1) {
    code = (code + counts[length - 1]) << 1;
    next[length] = code;
  }
  return lengths.map(length => length ? [reverse(next[length]++, length), length] : null);
}

function balancedLengths(values, alphabetSize) {
  const frequency = Array(alphabetSize).fill(0);
  for (const value of values) frequency[value] += 1;
  const used = frequency.map((count, symbol) => ({ count, symbol }))
    .filter(entry => entry.count).sort((a, b) => b.count - a.count || a.symbol - b.symbol);
  if (!used.length) throw new Error('empty image channel');
  const lengths = Array(alphabetSize).fill(0);
  if (used.length === 1) lengths[used[0].symbol] = 1;
  else {
    const depth = Math.floor(Math.log2(used.length));
    const short = (2 ** (depth + 1)) - used.length;
    used.forEach((entry, index) => { lengths[entry.symbol] = index < short ? depth : depth + 1; });
  }
  return lengths;
}

const LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const LENGTH_TREE = Array.from({ length: 19 }, (_, symbol) => symbol <= 12 ? 4 : 5);
const LENGTH_CODES = codes(LENGTH_TREE);

function putTree(bits, lengths) {
  bits.put(0, 1); // normal prefix code
  bits.put(15, 4); // all 19 code-length-code lengths
  for (const symbol of LENGTH_ORDER) bits.put(LENGTH_TREE[symbol], 3);
  bits.put(1, 1); // explicit max_symbol
  bits.put(4, 3); // 10 bits for max_symbol - 2
  const last = lengths.findLastIndex(length => length !== 0);
  const count = Math.max(2, last + 1);
  bits.put(count - 2, 10);
  for (let symbol = 0; symbol < count; symbol += 1) {
    const [code, size] = LENGTH_CODES[lengths[symbol]];
    bits.put(code, size);
  }
  return codes(lengths);
}

function lengthCode(value) {
  if (value <= 4) return { symbol: value - 1, extra: 0, bits: 0 };
  for (let symbol = 4; symbol < 24; symbol += 1) {
    const bits = (symbol - 2) >> 1;
    const offset = (2 + (symbol & 1)) << bits;
    if (value >= offset + 1 && value <= offset + (1 << bits))
      return { symbol, extra: value - offset - 1, bits };
  }
  throw new RangeError('backward reference exceeds VP8L limit');
}

function tokenize(rgba, rowWidth) {
  const green = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < green.length; p += 1) green[p] = rgba[p * 4 + 1];
  const tokens = [];
  for (let p = 0; p < green.length;) {
    let bestLength = 0;
    let bestDistance = 0;
    for (const distance of [1, rowWidth]) {
      if (distance > p || (distance === rowWidth && rowWidth === 1)) continue;
      let length = 0;
      const limit = Math.min(256, green.length - p);
      while (length < limit && green[p + length] === green[p + length - distance]) length += 1;
      if (length > bestLength) { bestLength = length; bestDistance = distance; }
    }
    if (bestLength >= 4) {
      tokens.push({ copy: true, length: lengthCode(bestLength), distance: bestDistance === 1 ? 1 : 0 });
      p += bestLength;
    } else {
      tokens.push({ copy: false, pixel: p, green: green[p] });
      p += 1;
    }
  }
  return tokens;
}

function putImage(bits, rgba, main, rowWidth = 0) {
  bits.put(0, 1); // no color cache
  if (main) bits.put(0, 1); // one meta prefix group
  const tokens = main ? tokenize(rgba, rowWidth) : Array.from({ length: rgba.length / 4 }, (_, pixel) => ({ copy: false, pixel }));
  const channels = [[], [], [], [], []]; // green/length, red, blue, alpha, distance
  for (const token of tokens) {
    if (token.copy) {
      channels[0].push(256 + token.length.symbol);
      channels[4].push(token.distance);
    } else {
      const p = token.pixel * 4;
      channels[0].push(rgba[p + 1]);
      channels[1].push(rgba[p]);
      channels[2].push(rgba[p + 2]);
      channels[3].push(rgba[p + 3]);
    }
  }
  if (!channels[4].length) channels[4].push(0);
  const trees = channels.map((values, index) => putTree(bits,
    balancedLengths(values, index === 0 ? 280 : index === 4 ? 40 : 256)));
  for (const token of tokens) {
    const greenSymbol = token.copy ? 256 + token.length.symbol : rgba[token.pixel * 4 + 1];
    const [greenCode, greenSize] = trees[0][greenSymbol];
    bits.put(greenCode, greenSize);
    if (token.copy) {
      bits.put(token.length.extra, token.length.bits);
      const [distanceCode, distanceSize] = trees[4][token.distance];
      bits.put(distanceCode, distanceSize);
    } else {
      const p = token.pixel * 4;
      for (const [channel, value] of [[1, rgba[p]], [2, rgba[p + 2]], [3, rgba[p + 3]]]) {
        const [code, size] = trees[channel][value];
        bits.put(code, size);
      }
    }
  }
}

export function encodeIndexedWebp(width, height, palette, indices) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384)
    throw new RangeError('invalid WebP dimensions');
  if (palette.length < 2 || palette.length > 16 || indices.length !== width * height)
    throw new RangeError('indexed WebP needs 2..16 colors and width * height indices');
  const bits = new Bits();
  bits.put(width - 1, 14);
  bits.put(height - 1, 14);
  bits.put(0, 1); // opaque
  bits.put(0, 3); // VP8L version
  bits.put(1, 1); // color indexing transform
  bits.put(3, 2);
  bits.put(palette.length - 1, 8);
  const deltas = new Uint8Array(palette.length * 4);
  let previous = [0, 0, 0, 0];
  palette.forEach((color, index) => {
    if (color.length !== 3 || color.some(value => !Number.isInteger(value) || value < 0 || value > 255))
      throw new RangeError('invalid palette color');
    const current = [...color, 255];
    current.forEach((value, channel) => { deltas[index * 4 + channel] = (value - previous[channel] + 256) & 255; });
    previous = current;
  });
  putImage(bits, deltas, false);
  bits.put(0, 1); // end of transforms
  const widthBits = palette.length <= 2 ? 3 : palette.length <= 4 ? 2 : 1;
  const perByte = 1 << widthBits;
  const packedWidth = Math.ceil(width / perByte);
  const packed = new Uint8Array(packedWidth * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = indices[y * width + x];
    if (index >= palette.length) throw new RangeError('palette index out of range');
    const p = (y * packedWidth + Math.floor(x / perByte)) * 4;
    packed[p + 1] |= index << ((x % perByte) * (8 / perByte));
  }
  for (let p = 3; p < packed.length; p += 4) packed[p] = 255;
  putImage(bits, packed, true, packedWidth);
  const body = Buffer.concat([Buffer.from([0x2f]), bits.finish()]);
  const padding = body.length & 1;
  const header = Buffer.alloc(20);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(12 + body.length + padding, 4);
  header.write('WEBPVP8L', 8, 'ascii');
  header.writeUInt32LE(body.length, 16);
  return Buffer.concat([header, body, padding ? Buffer.from([0]) : Buffer.alloc(0)]);
}
