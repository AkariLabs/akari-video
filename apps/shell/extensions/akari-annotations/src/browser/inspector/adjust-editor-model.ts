export interface AdjustCurvePointV1 { in: number; out: number }
export interface AdjustHuePointV1 { hue: number; value: number }
export type AdjustWheelKey = 'lift' | 'gamma' | 'gain' | 'offset';
export const INSPECTOR_CURVE_CHANNELS = [
    { key: 'master', label: 'M' }, { key: 'r', label: 'R' },
    { key: 'g', label: 'G' }, { key: 'b', label: 'B' }
] as const;
export const INSPECTOR_HUE_CHANNELS = [
    { key: 'hue', label: 'Hue' }, { key: 'sat', label: 'Sat' }, { key: 'luma', label: 'Luma' }
] as const;
export const INSPECTOR_ADJUST_WHEELS = [
    { key: 'lift', label: 'Lift' }, { key: 'gamma', label: 'Gamma' },
    { key: 'gain', label: 'Gain' }, { key: 'offset', label: 'Offset' }
] as const;
export const IDENTITY_CURVE_POINTS: readonly AdjustCurvePointV1[] = [{ in: 0, out: 0 }, { in: 1, out: 1 }];
export const DEFAULT_HUE_POINTS: readonly AdjustHuePointV1[] = Array.from({ length: 6 }, (_, i) => ({ hue: i / 6, value: 0.5 }));
const EPSILON = 1e-4;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const sortCurvePoints = (points: readonly AdjustCurvePointV1[]): AdjustCurvePointV1[] =>
    points.map(p => ({ ...p })).sort((a, b) => a.in - b.in);
export const clampCurvePoint = (p: AdjustCurvePointV1): AdjustCurvePointV1 => ({ in: clamp01(p.in), out: clamp01(p.out) });
export function addCurvePoint(points: AdjustCurvePointV1[], point: AdjustCurvePointV1, max = 16): AdjustCurvePointV1[] {
    const p = clampCurvePoint(point);
    if (points.length >= max || points.some(v => Math.abs(v.in - p.in) < EPSILON)) return points;
    return sortCurvePoints([...points, p]);
}
export function removeCurvePoint(points: AdjustCurvePointV1[], index: number, min = 2): AdjustCurvePointV1[] {
    return points.length <= min ? points : points.filter((_, i) => i !== index);
}
export function moveCurvePoint(points: AdjustCurvePointV1[], index: number, point: AdjustCurvePointV1): AdjustCurvePointV1[] {
    if (!points[index]) return points;
    const p = clampCurvePoint(point);
    // 読み込み済みの近接点でも順序を壊さないよう、移動余地がなければ横軸を維持する。
    const low = index > 0 ? points[index - 1].in + EPSILON : 0;
    const high = index + 1 < points.length ? points[index + 1].in - EPSILON : 1;
    p.in = low <= high ? Math.max(low, Math.min(high, p.in)) : points[index].in;
    return points.map((v, i) => i === index ? p : { ...v });
}
export const isCurveChannelIdentity = (p: readonly AdjustCurvePointV1[]): boolean => p.length === 2
    && Math.abs(p[0].in) < 1e-5 && Math.abs(p[0].out) < 1e-5
    && Math.abs(p[1].in - 1) < 1e-5 && Math.abs(p[1].out - 1) < 1e-5;
export const curvePathD = (points: readonly AdjustCurvePointV1[], width: number, height: number): string =>
    sortCurvePoints(points).map((p, i) => `${i ? 'L' : 'M'}${(p.in * width).toFixed(1)},${((1 - p.out) * height).toFixed(1)}`).join('');
export const sortHuePoints = (points: readonly AdjustHuePointV1[]): AdjustHuePointV1[] =>
    points.map(p => ({ ...p })).sort((a, b) => a.hue - b.hue);
export const clampHuePoint = (p: AdjustHuePointV1): AdjustHuePointV1 => ({ hue: clamp01(p.hue), value: clamp01(p.value) });
export function addHuePoint(points: AdjustHuePointV1[], point: AdjustHuePointV1, max = 16): AdjustHuePointV1[] {
    const p = clampHuePoint(point);
    if (points.length >= max || points.some(v => Math.abs(v.hue - p.hue) < EPSILON)) return points;
    return sortHuePoints([...points, p]);
}
export function removeHuePoint(points: AdjustHuePointV1[], index: number, min = 1): AdjustHuePointV1[] {
    return points.length <= min ? points : points.filter((_, i) => i !== index);
}
export function moveHuePoint(points: AdjustHuePointV1[], index: number, point: AdjustHuePointV1): AdjustHuePointV1[] {
    if (!points[index]) return points;
    return moveCurvePoint(points.map(p => ({ in: p.hue, out: p.value })), index, { in: point.hue, out: point.value })
        .map(p => ({ hue: p.in, value: p.out }));
}
export const isHueChannelIdentity = (points: readonly AdjustHuePointV1[]): boolean =>
    points.every(p => Math.abs(p.value - 0.5) <= 1e-4);
export const huePathD = (points: readonly AdjustHuePointV1[], width: number, height: number): string =>
    curvePathD(points.map(p => ({ in: p.hue, out: p.value })), width, height);
export const wheelRange = (wheel: AdjustWheelKey): number => ({ lift: 0.25, gamma: 0.5, gain: 0.5, offset: 0.1 })[wheel];
const ANGLES = [0, 2 * Math.PI / 3, 4 * Math.PI / 3];
export function wheelXyToRgb(dx: number, dy: number, range: number, luma: number): [number, number, number] {
    const m = Math.min(1, Math.hypot(dx, dy)) * range;
    const angle = Math.atan2(dy, dx);
    return ANGLES.map(a => Math.max(-range, Math.min(range, luma + m * Math.cos(angle - a)))) as [number, number, number];
}
export function rgbToWheelDisplay(r: number, g: number, b: number, range: number): { xPct: number; yPct: number; luma: number } {
    const luma = (r + g + b) / 3;
    const channels = [r, g, b];
    const x = channels.reduce((sum, v, i) => sum + (v - luma) * Math.cos(ANGLES[i]), 0);
    const y = channels.reduce((sum, v, i) => sum + (v - luma) * Math.sin(ANGLES[i]), 0);
    const norm = Math.min(1, Math.hypot(x, y) / 1.5 / range);
    const angle = Math.atan2(y, x);
    return { xPct: 50 + 42 * norm * Math.cos(angle), yPct: 50 - 42 * norm * Math.sin(angle), luma };
}
