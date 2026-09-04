import type { AdjustBasicV0 } from '@akari-video/edit-store';

/** Basic-adjustment numeric SSOT, including every tone-zone smoothstep edge. */
export const ADJUST_CONSTANTS = Object.freeze({
  REC709_R: 0.2126,
  REC709_G: 0.7152,
  REC709_B: 0.0722,
  TEMP_COEF: 0.18,
  TINT_COEF: 0.12,
  CONTRAST_PIVOT: 0.5,
  HIGHLIGHTS_LOW: 0.5,
  HIGHLIGHTS_HIGH: 0.9,
  SHADOWS_LOW: 0.1,
  SHADOWS_HIGH: 0.5,
  WHITES_LOW: 0.7,
  WHITES_HIGH: 1,
  BLACKS_LOW: 0,
  BLACKS_HIGH: 0.3,
  TONE_ADD_COEF: 0.3,
  VIBRANCE_EPSILON: 1e-6,
  IDENTITY_EPSILON: 1e-6,
  EXPOSURE_MIN: -3,
  EXPOSURE_MAX: 3,
  BASIC_MIN: -1,
  BASIC_MAX: 1,
} as const);

export interface NormalizedAdjustBasic {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  blacks: number;
  whites: number;
  temperature: number;
  tint: number;
  vibrance: number;
  saturation: number;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(low, Math.min(high, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function luma(r: number, g: number, b: number): number {
  return r * ADJUST_CONSTANTS.REC709_R
    + g * ADJUST_CONSTANTS.REC709_G
    + b * ADJUST_CONSTANTS.REC709_B;
}

export function normalizeAdjustBasic(basic: AdjustBasicV0 | null | undefined): NormalizedAdjustBasic {
  const source = basic ?? {};
  return {
    exposure: clamp(source.exposure ?? 0, ADJUST_CONSTANTS.EXPOSURE_MIN, ADJUST_CONSTANTS.EXPOSURE_MAX),
    contrast: clamp(source.contrast ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    highlights: clamp(source.highlights ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    shadows: clamp(source.shadows ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    blacks: clamp(source.blacks ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    whites: clamp(source.whites ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    temperature: clamp(source.temperature ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    tint: clamp(source.tint ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    vibrance: clamp(source.vibrance ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
    saturation: clamp(source.saturation ?? 0, ADJUST_CONSTANTS.BASIC_MIN, ADJUST_CONSTANTS.BASIC_MAX),
  };
}

export function isAdjustBasicIdentity(basic: AdjustBasicV0 | null | undefined): boolean {
  const normalized = normalizeAdjustBasic(basic);
  return Object.values(normalized).every(value => Math.abs(value) <= ADJUST_CONSTANTS.IDENTITY_EPSILON);
}

/** Apply the clip-adjust v0 basic correction in gamma-encoded video space. */
export function applyAdjustBasic(
  r: number,
  g: number,
  b: number,
  basic: AdjustBasicV0 | null | undefined,
): [number, number, number] {
  const p = normalizeAdjustBasic(basic);
  let cr = r;
  let cg = g;
  let cb = b;

  if (p.exposure !== 0) {
    const gain = Math.pow(2, p.exposure);
    cr *= gain;
    cg *= gain;
    cb *= gain;
  }

  cr = clamp01(cr * (1 + p.temperature * ADJUST_CONSTANTS.TEMP_COEF));
  cg = clamp01(cg * (1 - p.tint * ADJUST_CONSTANTS.TINT_COEF));
  cb = clamp01(cb * (1 - p.temperature * ADJUST_CONSTANTS.TEMP_COEF));

  if (p.highlights !== 0) {
    const mask = smoothstep(
      ADJUST_CONSTANTS.HIGHLIGHTS_LOW,
      ADJUST_CONSTANTS.HIGHLIGHTS_HIGH,
      luma(cr, cg, cb),
    );
    const gain = 1 + p.highlights * mask;
    cr = clamp01(cr * gain);
    cg = clamp01(cg * gain);
    cb = clamp01(cb * gain);
  }

  if (p.shadows !== 0) {
    const mask = 1 - smoothstep(
      ADJUST_CONSTANTS.SHADOWS_LOW,
      ADJUST_CONSTANTS.SHADOWS_HIGH,
      luma(cr, cg, cb),
    );
    const gain = 1 + p.shadows * mask;
    cr = clamp01(cr * gain);
    cg = clamp01(cg * gain);
    cb = clamp01(cb * gain);
  }

  if (p.whites !== 0) {
    const mask = smoothstep(
      ADJUST_CONSTANTS.WHITES_LOW,
      ADJUST_CONSTANTS.WHITES_HIGH,
      luma(cr, cg, cb),
    );
    const add = p.whites * mask * ADJUST_CONSTANTS.TONE_ADD_COEF;
    cr = clamp01(cr + add);
    cg = clamp01(cg + add);
    cb = clamp01(cb + add);
  }

  if (p.blacks !== 0) {
    const mask = 1 - smoothstep(
      ADJUST_CONSTANTS.BLACKS_LOW,
      ADJUST_CONSTANTS.BLACKS_HIGH,
      luma(cr, cg, cb),
    );
    const add = p.blacks * mask * ADJUST_CONSTANTS.TONE_ADD_COEF;
    cr = clamp01(cr + add);
    cg = clamp01(cg + add);
    cb = clamp01(cb + add);
  }

  if (p.contrast !== 0) {
    const gain = 1 + p.contrast;
    cr = clamp01((cr - ADJUST_CONSTANTS.CONTRAST_PIVOT) * gain + ADJUST_CONSTANTS.CONTRAST_PIVOT);
    cg = clamp01((cg - ADJUST_CONSTANTS.CONTRAST_PIVOT) * gain + ADJUST_CONSTANTS.CONTRAST_PIVOT);
    cb = clamp01((cb - ADJUST_CONSTANTS.CONTRAST_PIVOT) * gain + ADJUST_CONSTANTS.CONTRAST_PIVOT);
  }

  if (p.saturation !== 0) {
    const currentLuma = luma(cr, cg, cb);
    const gain = 1 + p.saturation;
    cr = clamp01(currentLuma + (cr - currentLuma) * gain);
    cg = clamp01(currentLuma + (cg - currentLuma) * gain);
    cb = clamp01(currentLuma + (cb - currentLuma) * gain);
  }

  if (p.vibrance !== 0) {
    const currentLuma = luma(cr, cg, cb);
    const maximum = Math.max(cr, cg, cb);
    const minimum = Math.min(cr, cg, cb);
    const hsvSaturation = maximum > ADJUST_CONSTANTS.VIBRANCE_EPSILON
      ? (maximum - minimum) / maximum
      : 0;
    const amount = p.vibrance * (1 - hsvSaturation);
    cr = clamp01(currentLuma + (cr - currentLuma) * (1 + amount));
    cg = clamp01(currentLuma + (cg - currentLuma) * (1 + amount));
    cb = clamp01(currentLuma + (cb - currentLuma) * (1 + amount));
  }

  return [cr, cg, cb];
}
