import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const vocabularyPath = fileURLToPath(new URL('../../packages/edit-store/src/transition-vocabulary.ts', import.meta.url));

export function transitionVocabulary() {
  const source = readFileSync(vocabularyPath, 'utf8');
  const entries = [...source.matchAll(/\{ id: '([^']+)', xfadeName: '[^']+', labelJa: '([^']+)', category: '([^']+)', previewKind: '([^']+)'/gu)]
    .map(([, id, name, category, previewKind]) => ({ id, name, category, previewKind }));
  if (entries.length !== 29) throw new Error(`expected 29 transitions, got ${entries.length}`);
  return entries;
}

// Numeric copy of the timeline preview formulas. Pixel sampling below realizes
// the same opacity, position, clipping, mask and plate rules with pixel arrays.
export function transitionVisual(kind, rawProgress) {
  const p = Math.max(0, Math.min(1, Number.isFinite(rawProgress) ? rawProgress : 0));
  const mid = 1 - Math.abs(2 * p - 1);
  const visual = { p, outOpacity: 1, inOpacity: 1, outX: 0, outY: 0, inX: 0, inY: 0,
    plate: 0, plateColor: null, gray: 0, blur: 0, pixel: 0, dissolve: false,
    clip: null, circle: null, radial: false, zoom: 1, squeezeX: 1, squeezeY: 1, zSwap: false };
  const cross = () => { visual.outOpacity = 1 - p; visual.inOpacity = p; };
  if (kind === 'blur') { cross(); visual.blur = mid * .075; }
  else if (kind === 'pixelize') { cross(); visual.pixel = mid / 22; }
  else if (kind === 'dissolve') visual.dissolve = true;
  else if (kind === 'fade') cross();
  else if (kind === 'fade-black' || kind === 'fade-white') {
    cross(); visual.plate = Math.max(0, Math.min(1, Math.min(p / .18, (1 - p) / .7)));
    visual.plateColor = kind === 'fade-white' ? [255, 255, 255] : [0, 0, 0];
  } else if (kind === 'fade-grays') { cross(); visual.gray = mid; }
  const hidden = 1 - p;
  if (kind.startsWith('wipe-')) visual.clip = [kind.slice(5), hidden];
  if (kind.startsWith('slide-')) {
    const direction = kind.slice(6);
    const axis = direction === 'left' || direction === 'right' ? 'X' : 'Y';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    visual[`out${axis}`] = sign * p;
    visual[`in${axis}`] = -sign * hidden;
  }
  if (kind.startsWith('cover-')) {
    const direction = kind.slice(6);
    const axis = direction === 'left' || direction === 'right' ? 'X' : 'Y';
    visual[`in${axis}`] = (direction === 'left' || direction === 'up' ? 1 : -1) * hidden;
  }
  if (kind.startsWith('reveal-')) {
    const direction = kind.slice(7);
    const axis = direction === 'left' || direction === 'right' ? 'X' : 'Y';
    visual[`out${axis}`] = (direction === 'left' || direction === 'up' ? -1 : 1) * p;
    visual.zSwap = true;
  }
  if (kind === 'circle-open') visual.circle = { incoming: true, c: p * 170 - 35 };
  if (kind === 'circle-close') { visual.circle = { incoming: false, c: (1 - p) * 170 - 35 }; visual.zSwap = true; }
  if (kind === 'radial') visual.radial = true;
  if (kind === 'zoom-in') {
    visual.outOpacity = p < .6 ? 1 : 1 - (p - .6) / .4;
    visual.zoom = 1 + 1.5 * p;
    visual.blur = 6 * p / 96;
    visual.zSwap = true;
  }
  if (kind === 'squeeze-h') { visual.squeezeY = 1 - p; visual.zSwap = true; }
  if (kind === 'squeeze-v') { visual.squeezeX = 1 - p; visual.zSwap = true; }
  return visual;
}

export const CELL_WIDTH = 96;
export const CELL_HEIGHT = 54;
const A = [27, 93, 143];
const A_MARK = [145, 219, 237];
const B = [225, 104, 65];
const B_MARK = [252, 212, 103];
const mix = (a, b, p) => a.map((value, i) => Math.round(value * (1 - p) + b[i] * p));
const PALETTE = [A, A_MARK, B, B_MARK,
  mix(A, B, .25), mix(A, B, .5), mix(A, B, .75),
  mix(A_MARK, B_MARK, .25), mix(A_MARK, B_MARK, .5), mix(A_MARK, B_MARK, .75),
  [0, 0, 0], [255, 255, 255], [93, 97, 103], [177, 181, 184],
  mix(A, B_MARK, .5), mix(A_MARK, B, .5)];

export function sourcePixel(which, x, y) {
  if (which === 'a') {
    const stripe = ((Math.floor(x / 9) + Math.floor(y / 9)) % 5) === 0;
    const ring = Math.abs(Math.hypot(x - 48, y - 27) - 14) < 3;
    return stripe || ring ? A_MARK : A;
  }
  const dots = ((x - 10) % 19 - 9) ** 2 + ((y - 7) % 17 - 8) ** 2 < 15;
  const square = x > 30 && x < 66 && (Math.abs(y - 15) < 3 || Math.abs(y - 39) < 3);
  return dots || square ? B_MARK : B;
}

function imageAt(which, x, y, v, kind) {
  if (which === 'a' && (v.squeezeX === 0 || v.squeezeY === 0)) return null;
  const dx = which === 'a' ? v.outX : v.inX;
  const dy = which === 'a' ? v.outY : v.inY;
  let sx = x - dx * CELL_WIDTH;
  let sy = y - dy * CELL_HEIGHT;
  if (which === 'a') {
    sx = (sx - 48) / (v.zoom * v.squeezeX) + 48;
    sy = (sy - 27) / (v.zoom * v.squeezeY) + 27;
  }
  if (sx < 0 || sx >= CELL_WIDTH || sy < 0 || sy >= CELL_HEIGHT) return null;
  if (which === 'b' && v.clip) {
    const [direction, hidden] = v.clip;
    if (direction === 'left' && x < CELL_WIDTH * hidden) return null;
    if (direction === 'right' && x >= CELL_WIDTH * (1 - hidden)) return null;
    if (direction === 'up' && y < CELL_HEIGHT * hidden) return null;
    if (direction === 'down' && y >= CELL_HEIGHT * (1 - hidden)) return null;
  }
  if (v.circle && (which === 'b') === v.circle.incoming) {
    const radius = Math.hypot((x - 48) / 48, (y - 27) / 27) / Math.SQRT2 * 100;
    if (radius > v.circle.c) return null;
  }
  if (v.radial && which === 'b') {
    const angle = ((Math.atan2(x - 48, 27 - y) * 180 / Math.PI) + 360) % 360;
    const c = v.p * 424 - 32;
    if (angle > c) return null;
  }
  if (v.dissolve && which === 'b') {
    let hash = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
    const noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
    if (noise > v.p) return null;
  }
  if (kind === 'pixelize' && v.pixel) {
    const block = Math.max(1, Math.round(v.pixel * CELL_WIDTH));
    sx = Math.floor(sx / block) * block;
    sy = Math.floor(sy / block) * block;
  }
  if (kind === 'blur' || (kind === 'zoom-in' && which === 'a')) {
    const radius = Math.round(v.blur * CELL_WIDTH / 2);
    if (radius) {
      const c1 = sourcePixel(which, Math.max(0, sx - radius), sy);
      const c2 = sourcePixel(which, Math.min(CELL_WIDTH - 1, sx + radius), sy);
      return mix(c1, c2, .5);
    }
  }
  return sourcePixel(which, sx, sy);
}

function nearest(color) {
  let best = 0; let distance = Infinity;
  PALETTE.forEach((candidate, index) => {
    const d = candidate.reduce((sum, value, channel) => sum + (value - color[channel]) ** 2, 0);
    if (d < distance) { distance = d; best = index; }
  });
  return best;
}

export function transitionPixel(kind, progress, x, y) {
  if (progress <= 0) return sourcePixel('a', x, y);
  if (progress >= 1) return sourcePixel('b', x, y);
  const v = transitionVisual(kind, progress);
  let color = imageAt(v.zSwap ? 'b' : 'a', x, y, v, kind) ?? (v.zSwap ? B : A);
  const top = v.zSwap ? 'a' : 'b';
  const overlay = imageAt(top, x, y, v, kind);
  const opacity = top === 'a' ? v.outOpacity : v.inOpacity;
  if (overlay) color = mix(color, overlay, opacity);
  if (v.gray) {
    const luminance = Math.round(color[0] * .2126 + color[1] * .7152 + color[2] * .0722);
    color = mix(color, [luminance, luminance, luminance], v.gray);
  }
  if (v.plate) color = mix(color, v.plateColor, v.plate);
  return color;
}

export function renderTransition(kind, frames) {
  const width = CELL_WIDTH * frames.length;
  const indices = new Uint8Array(width * CELL_HEIGHT);
  for (let frame = 0; frame < frames.length; frame += 1)
    for (let y = 0; y < CELL_HEIGHT; y += 1)
      for (let x = 0; x < CELL_WIDTH; x += 1)
        indices[y * width + frame * CELL_WIDTH + x] = nearest(transitionPixel(kind, frames[frame], x, y));
  return { width, height: CELL_HEIGHT, palette: PALETTE, indices };
}
