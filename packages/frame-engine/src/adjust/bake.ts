import type { AdjustBasicV0, AdjustV1 } from '@akari-video/edit-store';

import type { ParsedCubeLut } from '../look/cube.js';
import { sampleLutTrilinear } from '../look/cube.js';
import { applyItemAdjust, normalizeAdjustBasic, normalizeAdjustWheels, normalizeAdjustCurves, normalizeAdjustHue, isAdjustBasicIdentity, isAdjustWheelsIdentity, isAdjustCurvesIdentity, isAdjustHueIdentity } from './kernel.js';

export const ADJUST_LUT_SIZE = 33;

let lastBakeKey = '';
let lastBakeResult: ParsedCubeLut | undefined;
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

function normalizedIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function cubeComponent(value: number): number {
  return Number(value.toFixed(6));
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
  const normalized: AdjustV1 = {
    basic: normalizeAdjustBasic(adjust?.basic),
    lut: adjust?.lut ? { ...adjust.lut, intensity: normalizedIntensity(adjust.lut.intensity ?? 1) } : null,
    wheels: normalizeAdjustWheels(adjust?.wheels),
    curves: normalizeAdjustCurves(adjust?.curves),
    hue: normalizeAdjustHue(adjust?.hue),
    sections: adjust?.sections,
  };
  const key = `${JSON.stringify(normalized)}|${size}|${lutMemoId(userLut)}`;
  if (key === lastBakeKey && lastBakeResult) return lastBakeResult;

  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  const sampler = userLut ? (r: number, g: number, b: number) => sampleLutTrilinear(userLut, [r, g, b]) : undefined;
  for (let bz = 0; bz < size; bz += 1) {
    for (let gy = 0; gy < size; gy += 1) {
      for (let rx = 0; rx < size; rx += 1) {
        const adjusted = applyItemAdjust(rx / last, gy / last, bz / last, normalized, sampler);
        const index = ((bz * size + gy) * size + rx) * 3;
        data[index] = cubeComponent(adjusted[0]);
        data[index + 1] = cubeComponent(adjusted[1]);
        data[index + 2] = cubeComponent(adjusted[2]);
      }
    }
  }

  const result = Object.freeze({
    size,
    domainMin: Object.freeze([0, 0, 0]) as readonly [number, number, number],
    domainMax: Object.freeze([1, 1, 1]) as readonly [number, number, number],
    data,
  });
  lastBakeKey = key;
  lastBakeResult = result;
  return result;
}
