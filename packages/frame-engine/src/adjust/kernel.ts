import type { AdjustBasicV0, AdjustV1, AdjustWheelsV1, AdjustCurvesV1, AdjustCurvePointV1, AdjustHueCurvesV1, AdjustHuePointV1 } from '@akari-video/edit-store';

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
  HUE_EPSILON: 1e-4,
  CURVES_IDENTITY_EPSILON: 1e-5,
  CURVE_SPAN_EPSILON: 1e-9,
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

const RGB_CHANNELS = ['r', 'g', 'b'] as const;
const CURVE_CHANNELS = ['master', 'r', 'g', 'b'] as const;
const HUE_CHANNELS = ['hue', 'sat', 'luma'] as const;
const WHEEL_RANGES = { lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 } as const;

export function normalizeAdjustWheels(wheels: AdjustWheelsV1 | null | undefined): Required<{ [K in keyof AdjustWheelsV1]: Required<NonNullable<AdjustWheelsV1[K]>> }> {
  const result = {} as ReturnType<typeof normalizeAdjustWheels>;
  for (const wheel of Object.keys(WHEEL_RANGES) as (keyof AdjustWheelsV1)[]) {
    result[wheel] = { r: 0, g: 0, b: 0 };
    for (const channel of RGB_CHANNELS) result[wheel][channel] = clamp(wheels?.[wheel]?.[channel] ?? 0, -WHEEL_RANGES[wheel], WHEEL_RANGES[wheel]);
  }
  return result;
}

export function normalizeAdjustCurves(curves: AdjustCurvesV1 | null | undefined): Required<AdjustCurvesV1> {
  const result = {} as Required<AdjustCurvesV1>;
  for (const channel of CURVE_CHANNELS) result[channel] = (curves?.[channel] ?? [{ in: 0, out: 0 }, { in: 1, out: 1 }])
    .map(point => ({ in: clamp01(point.in), out: clamp01(point.out) })).sort((a, b) => a.in - b.in);
  return result;
}

export function normalizeAdjustHue(hue: AdjustHueCurvesV1 | null | undefined): Required<AdjustHueCurvesV1> {
  const result = {} as Required<AdjustHueCurvesV1>;
  for (const channel of HUE_CHANNELS) result[channel] = (hue?.[channel] ?? [])
    .map(point => ({ hue: clamp01(point.hue), value: Number.isFinite(point.value) ? clamp01(point.value) : 0.5 })).sort((a, b) => a.hue - b.hue);
  return result;
}

export function isAdjustWheelsIdentity(wheels: AdjustWheelsV1 | null | undefined): boolean {
  return Object.values(normalizeAdjustWheels(wheels)).every(wheel => Object.values(wheel).every(value => value === 0));
}

export function isAdjustCurvesIdentity(curves: AdjustCurvesV1 | null | undefined): boolean {
  return Object.values(normalizeAdjustCurves(curves)).every(points => points.length === 2
    && Math.abs(points[0]!.in) < ADJUST_CONSTANTS.CURVES_IDENTITY_EPSILON
    && Math.abs(points[0]!.out) < ADJUST_CONSTANTS.CURVES_IDENTITY_EPSILON
    && Math.abs(points[1]!.in - 1) < ADJUST_CONSTANTS.CURVES_IDENTITY_EPSILON
    && Math.abs(points[1]!.out - 1) < ADJUST_CONSTANTS.CURVES_IDENTITY_EPSILON);
}

export function isAdjustHueIdentity(hue: AdjustHueCurvesV1 | null | undefined): boolean {
  return Object.values(normalizeAdjustHue(hue)).every(points => points.every(point => Math.abs(point.value - 0.5) <= ADJUST_CONSTANTS.HUE_EPSILON));
}

/** CDL order and clamp positions match legacy color-grade.ts:487-503. */
export function applyAdjustWheels(r: number, g: number, b: number, wheels: AdjustWheelsV1 | null | undefined): [number, number, number] {
  const p = normalizeAdjustWheels(wheels);
  return RGB_CHANNELS.map((channel, index) => {
    let c = [r, g, b][index]! * (1 - p.lift[channel]) + p.lift[channel];
    c = Math.pow(Math.max(0, c), 1 / (1 + p.gamma[channel]));
    c *= 1 + p.gain[channel];
    return clamp01(c + p.offset[channel]);
  }) as [number, number, number];
}

function evalCurve(points: AdjustCurvePointV1[], x: number): number {
  if (!points.length) return x;
  if (x <= points[0]!.in) return clamp01(points[0]!.out);
  const last = points[points.length - 1]!;
  if (x >= last.in) return clamp01(last.out);
  for (let i = 1; i < points.length; i += 1) {
    const p0 = points[i - 1]!, p1 = points[i]!;
    if (x >= p0.in && x <= p1.in) {
      const span = p1.in - p0.in;
      if (span < ADJUST_CONSTANTS.CURVE_SPAN_EPSILON) return clamp01(p0.out);
      const t = (x - p0.in) / span;
      return clamp01(p0.out + (p1.out - p0.out) * t);
    }
  }
  return clamp01(last.out);
}

export function applyAdjustCurves(r: number, g: number, b: number, curves: AdjustCurvesV1 | null | undefined): [number, number, number] {
  if (isAdjustCurvesIdentity(curves)) return [r, g, b];
  const p = normalizeAdjustCurves(curves);
  return [evalCurve(p.r, evalCurve(p.master, r)), evalCurve(p.g, evalCurve(p.master, g)), evalCurve(p.b, evalCurve(p.master, b))];
}

function sampleHue(points: AdjustHuePointV1[], x: number): number {
  if (!points.length) return 0.5;
  if (points.length === 1 || x <= points[0]!.hue) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (x >= last.hue) return last.value;
  for (let i = 1; i < points.length; i += 1) {
    const p0 = points[i - 1]!, p1 = points[i]!;
    if (x >= p0.hue && x <= p1.hue) {
      const span = p1.hue - p0.hue;
      if (span < ADJUST_CONSTANTS.CURVE_SPAN_EPSILON) return p0.value;
      const t = (x - p0.hue) / span;
      return p0.value + (p1.value - p0.value) * t;
    }
  }
  return last.value;
}

export function applyAdjustHue(r: number, g: number, b: number, hue: AdjustHueCurvesV1 | null | undefined): [number, number, number] {
  if (isAdjustHueIdentity(hue)) return [r, g, b];
  const p = normalizeAdjustHue(hue);
  const cmax = Math.max(r, g, b), cmin = Math.min(r, g, b), d = cmax - cmin;
  let h = 0;
  if (d > ADJUST_CONSTANTS.HUE_EPSILON) {
    if (cmax === r) h = ((g - b) / d + 6) % 6;
    else if (cmax === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = cmax > ADJUST_CONSTANTS.HUE_EPSILON ? d / cmax : 0;
  const shift = (sampleHue(p.hue, h) - 0.5) * 2;
  const newH = (h + shift + 1) % 1;
  const satGain = sampleHue(p.sat, h) * 2;
  const newS = clamp01(s * satGain);
  const lumaGain = sampleHue(p.luma, h) * 2;
  const newV = clamp01(cmax * lumaGain);
  const c = newS * newV, hh = newH * 6;
  const x = c * (1 - Math.abs((hh % 2) - 1)), m = newV - c;
  let cr = 0, cg = 0, cb = 0;
  const sector = Math.floor(hh);
  if (sector === 0) { cr = c; cg = x; }
  else if (sector === 1) { cr = x; cg = c; }
  else if (sector === 2) { cg = c; cb = x; }
  else if (sector === 3) { cg = x; cb = c; }
  else if (sector === 4) { cr = x; cb = c; }
  else { cr = c; cb = x; }
  return [clamp01(cr + m), clamp01(cg + m), clamp01(cb + m)];
}

export type AdjustLutSampler = (r: number, g: number, b: number) => [number, number, number];

/** Fixed per-item order; only explicit false disables a section. */
export function applyItemAdjust(r: number, g: number, b: number, adjust: AdjustV1 | null | undefined, lutSampler?: AdjustLutSampler): [number, number, number] {
  let rgb: [number, number, number] = [r, g, b];
  if (adjust?.sections?.basic !== false) rgb = applyAdjustBasic(...rgb, adjust?.basic);
  if (adjust?.sections?.lut !== false && adjust?.lut && lutSampler) {
    const sampled = lutSampler(...rgb);
    const raw = adjust.lut.intensity ?? 1;
    const intensity = Number.isFinite(raw) ? clamp01(raw) : 1;
    rgb = rgb.map((value, index) => value + (sampled[index]! - value) * intensity) as [number, number, number];
  }
  if (adjust?.sections?.wheels !== false) rgb = applyAdjustWheels(...rgb, adjust?.wheels);
  if (adjust?.sections?.curves !== false) rgb = applyAdjustCurves(...rgb, adjust?.curves);
  if (adjust?.sections?.hue !== false) rgb = applyAdjustHue(...rgb, adjust?.hue);
  return rgb;
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
