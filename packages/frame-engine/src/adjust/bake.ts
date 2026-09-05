import type { AdjustBasicV0 } from '@akari-video/edit-store';

import type { ParsedCubeLut } from '../look/cube.js';
import { sampleLutTrilinear } from '../look/cube.js';
import { applyAdjustBasic, normalizeAdjustBasic } from './kernel.js';

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
  if (!Number.isInteger(size) || size < 2 || size > 256) {
    throw new RangeError('size must be an integer between 2 and 256');
  }
  const normalizedBasic = normalizeAdjustBasic(basic);
  const mixAmount = normalizedIntensity(intensity);
  const key = `${JSON.stringify(normalizedBasic)}|${size}|${lutMemoId(userLut)}|${mixAmount}`;
  if (key === lastBakeKey && lastBakeResult) return lastBakeResult;

  const data = new Float32Array(size * size * size * 3);
  const last = size - 1;
  for (let bz = 0; bz < size; bz += 1) {
    for (let gy = 0; gy < size; gy += 1) {
      for (let rx = 0; rx < size; rx += 1) {
        const adjusted = applyAdjustBasic(rx / last, gy / last, bz / last, normalizedBasic);
        const lutted = userLut ? sampleLutTrilinear(userLut, adjusted) : adjusted;
        const index = ((bz * size + gy) * size + rx) * 3;
        data[index] = cubeComponent(adjusted[0] + (lutted[0] - adjusted[0]) * mixAmount);
        data[index + 1] = cubeComponent(adjusted[1] + (lutted[1] - adjusted[1]) * mixAmount);
        data[index + 2] = cubeComponent(adjusted[2] + (lutted[2] - adjusted[2]) * mixAmount);
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
