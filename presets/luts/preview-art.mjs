import { readFileSync } from 'node:fs';

// Matches the 3D LUT layout and interpolation used by the frame engine.
export function parseCube(text) {
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];
  for (const raw of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const line = raw.replace(/#.*$/u, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/u);
    const key = parts[0].toUpperCase();
    if (key === 'TITLE') continue;
    if (key === 'LUT_1D_SIZE') throw new TypeError('1D LUT is not supported');
    if (key === 'LUT_3D_SIZE') { size = Number(parts[1]); continue; }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const value = parts.slice(1, 4).map(Number);
      if (value.length !== 3 || value.some(v => !Number.isFinite(v))) throw new TypeError(`invalid ${key}`);
      if (key === 'DOMAIN_MIN') domainMin = value; else domainMax = value;
      continue;
    }
    const row = parts.slice(0, 3).map(Number);
    if (row.length !== 3 || row.some(v => !Number.isFinite(v))) throw new TypeError('invalid LUT row');
    values.push(...row);
  }
  if (!Number.isInteger(size) || size < 2 || size > 256 || values.length !== size ** 3 * 3)
    throw new RangeError('invalid LUT size or row count');
  if (domainMax.some((v, i) => !(v > domainMin[i]))) throw new RangeError('invalid LUT domain');
  return { size, domainMin, domainMax, data: new Float32Array(values) };
}

export function sampleLutTrilinear(lut, rgb) {
  const p = rgb.map((value, channel) => Math.min(1, Math.max(0,
    (value - lut.domainMin[channel]) / (lut.domainMax[channel] - lut.domainMin[channel]))) * (lut.size - 1));
  const lo = p.map(Math.floor);
  const hi = lo.map(v => Math.min(lut.size - 1, v + 1));
  const f = p.map((v, i) => v - lo[i]);
  const at = (r, g, b, channel) => lut.data[((b * lut.size * lut.size + g * lut.size + r) * 3) + channel];
  return [0, 1, 2].map(channel => {
    const x00 = at(lo[0], lo[1], lo[2], channel) * (1 - f[0]) + at(hi[0], lo[1], lo[2], channel) * f[0];
    const x10 = at(lo[0], hi[1], lo[2], channel) * (1 - f[0]) + at(hi[0], hi[1], lo[2], channel) * f[0];
    const x01 = at(lo[0], lo[1], hi[2], channel) * (1 - f[0]) + at(hi[0], lo[1], hi[2], channel) * f[0];
    const x11 = at(lo[0], hi[1], hi[2], channel) * (1 - f[0]) + at(hi[0], hi[1], hi[2], channel) * f[0];
    return (x00 * (1 - f[1]) + x10 * f[1]) * (1 - f[2])
      + (x01 * (1 - f[1]) + x11 * f[1]) * f[2];
  });
}

export const FRAME_WIDTH = 320;
export const FRAME_HEIGHT = 180;
export const REFERENCE_WIDTH = FRAME_WIDTH / 2;
export const BASE_COLORS = [
  [43, 98, 158],   // deep sky
  [155, 207, 229], // bright sky
  [26, 32, 40],    // near black
  [128, 128, 126], // middle gray
  [240, 239, 233], // near white
  [153, 88, 67],   // skin shadow
  [238, 181, 139], // skin light
  [57, 111, 70],   // foliage
];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function ramp(lower, upper, fraction, x, y) {
  const threshold = (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16;
  return fraction >= threshold ? upper : lower;
}

function sceneIndex(x, y) {
  const w = REFERENCE_WIDTH;
  let color = y < 76 ? ramp(0, 1, y / 76, x, y) : 7;
  if (((x - 125) ** 2 + (y - 31) ** 2) < 17 ** 2) color = 4;
  if (y >= 76 && y < 135 && (x < 30 + (y - 76) * .25 || x > 136 - (y - 76) * .14)) color = 2;
  if (y >= 118 && ((x + y * .42) % 25) < 5) color = 3;
  const head = ((x - 76) / 24) ** 2 + ((y - 82) / 29) ** 2;
  if (head < 1) color = ramp(5, 6, (x - 52) / 48, x, y);
  if (y > 108 && ((x - 76) / (29 + (y - 108) * .55)) ** 2 + ((y - 156) / 44) ** 2 < 1) color = 2;
  if (y > 156 && x > 104 && x < w) color = 2;
  if (y >= 164) {
    const position = (x / (w - 1)) * 2;
    color = position < 1 ? ramp(2, 3, position, x, y) : ramp(3, 4, position - 1, x, y);
  }
  return color;
}

export function renderReferenceFrame() {
  const indices = new Uint8Array(REFERENCE_WIDTH * FRAME_HEIGHT);
  for (let y = 0; y < FRAME_HEIGHT; y += 1)
    for (let x = 0; x < REFERENCE_WIDTH; x += 1)
      indices[y * REFERENCE_WIDTH + x] = sceneIndex(x, y);
  return { width: REFERENCE_WIDTH, height: FRAME_HEIGHT, palette: BASE_COLORS, indices };
}

export function renderLutPreview(lut) {
  const before = BASE_COLORS;
  const after = before.map(color => sampleLutTrilinear(lut, color.map(value => value / 255))
    .map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)));
  const palette = [...before, ...after];
  const reference = renderReferenceFrame();
  const indices = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) for (let x = 0; x < FRAME_WIDTH; x += 1) {
    const localX = x % REFERENCE_WIDTH;
    indices[y * FRAME_WIDTH + x] = reference.indices[y * REFERENCE_WIDTH + localX]
      + (x >= REFERENCE_WIDTH ? before.length : 0);
  }
  return { width: FRAME_WIDTH, height: FRAME_HEIGHT, palette, indices };
}

export function readLut(path) { return parseCube(readFileSync(path, 'utf8')); }
