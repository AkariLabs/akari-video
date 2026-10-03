import type { AdjustBasicV0, AdjustV1 } from '@akari-video/edit-store';

import type { ParsedCubeLut } from '../look/cube.js';
import { prepareItemAdjust, isAdjustBasicIdentity, isAdjustWheelsIdentity, isAdjustCurvesIdentity, isAdjustHueIdentity } from './kernel.js';
import type { AdjustRgbOutput } from './kernel.js';

export const ADJUST_LUT_SIZE = 33;

const MAX_BAKED_LUTS = 32;
const bakedLuts = new Map<string, ParsedCubeLut>();
const lutIdMap = new WeakMap<ParsedCubeLut, number>();
let nextLutId = 1;

function lutMemoId(lut: ParsedCubeLut | undefined): number {
  if (!lut) return 0;
  let id = lutIdMap.get(lut);
  if (id === undefined) {
    id = nextLutId;
    nextLutId += 1;
    lutIdMap.set(lut, id);
  }
  return id;
}

function cubeComponent(value: number): number {
  if (value === 0) return 0; // toFixed turns -0 into +0.
  if (!(value >= 0 && value <= 1)) return Number(value.toFixed(6));
  const scaled = value * 1_000_000;
  const fraction = scaled - Math.floor(scaled);
  // Multiplication can move an exact decimal half by a few binary ulps.
  if (Math.abs(fraction - 0.5) < 1e-7) return Number(value.toFixed(6));
  return Math.round(scaled) / 1_000_000;
}

function lutValue(lut: ParsedCubeLut, r: number, g: number, b: number, channel: number): number {
  return lut.data[((b * lut.size * lut.size + g * lut.size + r) * 3) + channel]!;
}

function sampleLutChannel(lut: ParsedCubeLut, r0: number, r1: number, g0: number, g1: number, b0: number, b1: number, fr: number, fg: number, fb: number, channel: number): number {
  const c000 = lutValue(lut, r0, g0, b0, channel), c100 = lutValue(lut, r1, g0, b0, channel);
  const c010 = lutValue(lut, r0, g1, b0, channel), c110 = lutValue(lut, r1, g1, b0, channel);
  const c001 = lutValue(lut, r0, g0, b1, channel), c101 = lutValue(lut, r1, g0, b1, channel);
  const c011 = lutValue(lut, r0, g1, b1, channel), c111 = lutValue(lut, r1, g1, b1, channel);
  const x00 = c000 + (c100 - c000) * fr;
  const x10 = c010 + (c110 - c010) * fr;
  const x01 = c001 + (c101 - c001) * fr;
  const x11 = c011 + (c111 - c011) * fr;
  const y0 = x00 + (x10 - x00) * fg;
  const y1 = x01 + (x11 - x01) * fg;
  return y0 + (y1 - y0) * fb;
}

/** Scalar form of sampleLutTrilinear, with the same interpolation order. */
function lutPosition(lut: ParsedCubeLut, value: number, channel: number): number {
  const numeric = Number(value);
  const finite = Number.isFinite(numeric) ? numeric : 0;
  const unit = (finite - lut.domainMin[channel]!) / (lut.domainMax[channel]! - lut.domainMin[channel]!);
  return Math.min(1, Math.max(0, unit)) * (lut.size - 1);
}

function sampleLutInto(lut: ParsedCubeLut, r: number, g: number, b: number, out: AdjustRgbOutput): void {
  if (!lut || !Number.isInteger(lut.size) || !(lut.data instanceof Float32Array)) {
    throw new TypeError('a parsed 3D LUT is required');
  }
  const pr = lutPosition(lut, r, 0), pg = lutPosition(lut, g, 1), pb = lutPosition(lut, b, 2);
  const r0 = Math.floor(pr), g0 = Math.floor(pg), b0 = Math.floor(pb);
  const r1 = Math.min(lut.size - 1, r0 + 1), g1 = Math.min(lut.size - 1, g0 + 1), b1 = Math.min(lut.size - 1, b0 + 1);
  const fr = pr - r0, fg = pg - g0, fb = pb - b0;
  out.r = sampleLutChannel(lut, r0, r1, g0, g1, b0, b1, fr, fg, fb, 0);
  out.g = sampleLutChannel(lut, r0, r1, g0, g1, b0, b1, fr, fg, fb, 1);
  out.b = sampleLutChannel(lut, r0, r1, g0, g1, b0, b1, fr, fg, fb, 2);
}

export function bakeAdjustLut(
  basic: AdjustBasicV0 | null | undefined,
  userLut?: ParsedCubeLut,
  intensity = 1,
  size = ADJUST_LUT_SIZE,
): ParsedCubeLut {
  return bakeItemAdjustLut({ basic: basic ?? undefined, lut: userLut ? { lut: '', intensity } : undefined }, userLut, size);
}

/** Effective identity respects section bypass without deleting stored values. */
export function isItemAdjustIdentity(adjust: AdjustV1 | null | undefined): boolean {
  return (adjust?.sections?.basic === false || isAdjustBasicIdentity(adjust?.basic))
    && (adjust?.sections?.lut === false || !adjust?.lut || adjust.lut.intensity === 0)
    && (adjust?.sections?.wheels === false || isAdjustWheelsIdentity(adjust?.wheels))
    && (adjust?.sections?.curves === false || isAdjustCurvesIdentity(adjust?.curves))
    && (adjust?.sections?.hue === false || isAdjustHueIdentity(adjust?.hue));
}

export function bakeItemAdjustLut(
  adjust: AdjustV1 | null | undefined,
  userLut?: ParsedCubeLut,
  size = ADJUST_LUT_SIZE,
): ParsedCubeLut {
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new RangeError('size must be an integer between 2 and 256');
  }
  const sampler = userLut ? (r: number, g: number, b: number, out: AdjustRgbOutput) => sampleLutInto(userLut, r, g, b, out) : undefined;
  const prepared = prepareItemAdjust(adjust, sampler);
  const normalized = prepared.normalized;
  const key = `${JSON.stringify(normalized)}|${size}|${lutMemoId(userLut)}`;
  const cached = bakedLuts.get(key);
  if (cached) {
    bakedLuts.delete(key);
    bakedLuts.set(key, cached);
    return cached;
  }

  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  const adjusted: AdjustRgbOutput = { r: 0, g: 0, b: 0 };
  const separableGrid = prepared.prepareSeparableGrid(size);
  for (let bz = 0; bz < size; bz += 1) {
    for (let gy = 0; gy < size; gy += 1) {
      for (let rx = 0; rx < size; rx += 1) {
        if (separableGrid) prepared.applyHueInto(separableGrid.red[rx]!, separableGrid.green[gy]!, separableGrid.blue[bz]!, adjusted);
        else prepared.applyInto(rx / last, gy / last, bz / last, adjusted);
        const index = ((bz * size + gy) * size + rx) * 3;
        data[index] = cubeComponent(adjusted.r);
        data[index + 1] = cubeComponent(adjusted.g);
        data[index + 2] = cubeComponent(adjusted.b);
      }
    }
  }

  const result = Object.freeze({
    size,
    domainMin: Object.freeze([0, 0, 0]) as readonly [number, number, number],
    domainMax: Object.freeze([1, 1, 1]) as readonly [number, number, number],
    data,
  });
  bakedLuts.set(key, result);
  if (bakedLuts.size > MAX_BAKED_LUTS) bakedLuts.delete(bakedLuts.keys().next().value!);
  return result;
}
