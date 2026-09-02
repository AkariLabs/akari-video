import type { EasingV2 } from './edit-v2';
import type { DuckInterval } from './ducking';

export interface EnvelopePoint {
    /** クリップ先頭を 0 とする秒。 */
    t: number;
    /** クリップの基準ゲインへ加算する dB。 */
    gainDb: number;
    easing?: EasingV2;
}

export interface EnvelopeGainEvent {
    offsetSec: number;
    value: number;
    method: 'set' | 'linear' | 'exponential';
}

export const DEFAULT_DUCK_DB = -12;
export const DEFAULT_DUCK_ATTACK_SEC = 0.3;
export const DEFAULT_DUCK_RELEASE_SEC = 0.8;
export const DEFAULT_DUCK_KEYS = ['narration', 'speech'] as const;

const SAMPLE_STEP_SEC = 0.02;
const MIN_LINEAR_GAIN = 1e-4;
const CUBIC_BEZIER_PATTERN = /^cubic-bezier\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\)$/iu;

/** overlay-runtime の keyframe easing と数値同一の係数関数。 */
export function easingProgress(easing: EasingV2 | undefined, progress: number): number {
    const value = clamp(progress);
    switch (easing ?? 'linear') {
        case 'hold': return 0;
        case 'ease-in-out':
        case 'in-out-cubic': return value < 0.5
            ? 4 * value * value * value
            : 1 - ((-2 * value + 2) ** 3) / 2;
        case 'in-quad': return value * value;
        case 'out-quad': return 1 - (1 - value) ** 2;
        case 'in-out-quad': return value < 0.5
            ? 2 * value * value
            : 1 - ((-2 * value + 2) ** 2) / 2;
        case 'in-cubic': return value ** 3;
        case 'out-cubic': return 1 - (1 - value) ** 3;
        case 'in-quart': return value ** 4;
        case 'out-quart': return 1 - (1 - value) ** 4;
        case 'in-out-quart': return value < 0.5
            ? 8 * value ** 4
            : 1 - ((-2 * value + 2) ** 4) / 2;
        case 'in-expo': return value === 0 ? 0 : 2 ** (10 * value - 10);
        case 'out-expo': return value === 1 ? 1 : 1 - 2 ** (-10 * value);
        case 'in-out-expo':
            if (value === 0 || value === 1) return value;
            return value < 0.5
                ? 2 ** (20 * value - 10) / 2
                : (2 - 2 ** (-20 * value + 10)) / 2;
        case 'in-back': {
            const c1 = 1.70158;
            return (c1 + 1) * value ** 3 - c1 * value ** 2;
        }
        case 'out-back': {
            const c1 = 1.70158;
            return 1 + (c1 + 1) * (value - 1) ** 3 + c1 * (value - 1) ** 2;
        }
        case 'in-out-back': {
            const c2 = 1.70158 * 1.525;
            return value < 0.5
                ? ((2 * value) ** 2 * ((c2 + 1) * 2 * value - c2)) / 2
                : (((2 * value - 2) ** 2 * ((c2 + 1) * (value * 2 - 2) + c2)) + 2) / 2;
        }
        case 'out-bounce': {
            const n1 = 7.5625;
            const d1 = 2.75;
            if (value < 1 / d1) return n1 * value * value;
            if (value < 2 / d1) {
                const shifted = value - 1.5 / d1;
                return n1 * shifted * shifted + 0.75;
            }
            if (value < 2.5 / d1) {
                const shifted = value - 2.25 / d1;
                return n1 * shifted * shifted + 0.9375;
            }
            const shifted = value - 2.625 / d1;
            return n1 * shifted * shifted + 0.984375;
        }
        case 'out-elastic':
            if (value === 0 || value === 1) return value;
            return 2 ** (-10 * value) * Math.sin((value * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
        case 'linear': return value;
        default: {
            const match = typeof easing === 'string' ? easing.match(CUBIC_BEZIER_PATTERN) : null;
            if (!match) return value;
            return cubicBezierAt(value, ...match.slice(1).map(Number) as [number, number, number, number]);
        }
    }
}

export function evaluateEnvelopeDb(points: readonly EnvelopePoint[], t: number): number {
    const usable = normalizedPoints(points);
    if (usable.length === 0) return 0;
    if (t <= usable[0].t) return usable[0].gainDb;
    const last = usable[usable.length - 1];
    if (t >= last.t) return last.gainDb;
    for (let index = 1; index < usable.length; index += 1) {
        const end = usable[index];
        if (t >= end.t) continue;
        const start = usable[index - 1];
        const span = end.t - start.t;
        if (!(span > 0)) return end.gainDb;
        const coefficient = easingProgress(end.easing, (t - start.t) / span);
        return start.gainDb + (end.gainDb - start.gainDb) * coefficient;
    }
    return last.gainDb;
}

export function composeEnvelopesDb(
    a: readonly EnvelopePoint[],
    b: readonly EnvelopePoint[]
): EnvelopePoint[] {
    const left = normalizedPoints(a);
    const right = normalizedPoints(b);
    if (left.length === 0) return right;
    if (right.length === 0) return left;
    const boundaries = [...new Set([...left, ...right].map(point => point.t))].sort((x, y) => x - y);
    const times = new Set(boundaries);
    for (let index = 1; index < boundaries.length; index += 1) {
        const start = boundaries[index - 1];
        const end = boundaries[index];
        if (!isNonLinearAt(left, (start + end) / 2) && !isNonLinearAt(right, (start + end) / 2)) continue;
        for (let at = start + SAMPLE_STEP_SEC; at < end - 1e-9; at += SAMPLE_STEP_SEC) {
            times.add(Number(at.toFixed(9)));
        }
    }
    return [...times].sort((x, y) => x - y).map(t => ({
        t,
        gainDb: evaluateEnvelopeDb(left, t) + evaluateEnvelopeDb(right, t)
    }));
}

export function envelopeToGainEvents(points: readonly EnvelopePoint[]): EnvelopeGainEvent[] {
    const usable = normalizedPoints(points);
    if (usable.length === 0) return [];
    const events: EnvelopeGainEvent[] = [{
        offsetSec: usable[0].t,
        value: dbToLinear(usable[0].gainDb),
        method: 'set'
    }];
    for (let index = 1; index < usable.length; index += 1) {
        const start = usable[index - 1];
        const end = usable[index];
        const easing = end.easing ?? 'linear';
        if (easing === 'hold') {
            events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: 'set' });
            continue;
        }
        if (easing === 'linear') {
            events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: 'exponential' });
            continue;
        }
        for (let at = start.t + SAMPLE_STEP_SEC; at < end.t - 1e-9; at += SAMPLE_STEP_SEC) {
            events.push({
                offsetSec: Number(at.toFixed(9)),
                value: dbToLinear(evaluateEnvelopeDb(usable, at)),
                method: 'exponential'
            });
        }
        events.push({ offsetSec: end.t, value: dbToLinear(end.gainDb), method: 'exponential' });
    }
    return events;
}

export function sampleEnvelopeLinear(
    points: readonly EnvelopePoint[],
    options: { sampleRate: number; durationSec: number }
): Float32Array {
    const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
        ? options.sampleRate : 48_000;
    const durationSec = Number.isFinite(options.durationSec) && options.durationSec > 0
        ? options.durationSec : 0;
    const samples = new Float32Array(Math.ceil(sampleRate * durationSec));
    for (let index = 0; index < samples.length; index += 1) {
        samples[index] = dbToLinear(evaluateEnvelopeDb(points, index / sampleRate));
    }
    return samples;
}

export function computeDuckEnvelope(
    intervals: readonly DuckInterval[],
    options: {
        duckDb?: number;
        attackSec?: number;
        releaseSec?: number;
        clipStartSec: number;
        clipDurationSec: number;
    }
): EnvelopePoint[] {
    const duckDb = finiteInRange(options.duckDb, -40, 0, DEFAULT_DUCK_DB);
    const attackSec = finiteInRange(options.attackSec, 0, 2, DEFAULT_DUCK_ATTACK_SEC);
    const releaseSec = finiteInRange(options.releaseSec, 0, 5, DEFAULT_DUCK_RELEASE_SEC);
    const clipStartSec = Number.isFinite(options.clipStartSec) ? Math.max(0, options.clipStartSec) : 0;
    const clipDurationSec = Number.isFinite(options.clipDurationSec) ? Math.max(0, options.clipDurationSec) : 0;
    if (!(clipDurationSec > 0)) return [];
    const merged = mergeIntervals(intervals, attackSec + releaseSec);
    if (merged.length === 0) return [];
    const absolute: EnvelopePoint[] = [];
    for (const interval of merged) {
        const rampStart = Math.max(0, interval.startSec - attackSec);
        if (rampStart < interval.startSec) absolute.push({ t: rampStart, gainDb: 0 });
        absolute.push({ t: interval.startSec, gainDb: duckDb, easing: rampStart < interval.startSec ? 'linear' : 'hold' });
        if (releaseSec > 0) {
            absolute.push({ t: interval.endSec, gainDb: duckDb, easing: 'hold' });
            absolute.push({ t: interval.endSec + releaseSec, gainDb: 0, easing: 'linear' });
        } else {
            absolute.push({ t: interval.endSec, gainDb: 0, easing: 'hold' });
        }
    }
    const normalized = normalizedPoints(absolute);
    const clipEndSec = clipStartSec + clipDurationSec;
    const active = merged.some(interval => interval.startSec < clipEndSec + releaseSec
        && interval.endSec > Math.max(0, clipStartSec - attackSec));
    if (!active) return [];
    const clippedTimes = [clipStartSec,
        ...normalized.filter(point => point.t > clipStartSec && point.t < clipEndSec).map(point => point.t),
        clipEndSec];
    return [...new Set(clippedTimes)].sort((a, b) => a - b).map(t => ({
        t: t - clipStartSec,
        gainDb: evaluateEnvelopeDb(normalized, t),
        ...easingAtExactPoint(normalized, t)
    }));
}

function normalizedPoints(points: readonly EnvelopePoint[]): EnvelopePoint[] {
    const sorted = points.filter(point => point && Number.isFinite(point.t) && point.t >= 0
        && Number.isFinite(point.gainDb)).map(point => ({ ...point })).sort((a, b) => a.t - b.t);
    const result: EnvelopePoint[] = [];
    for (const point of sorted) {
        if (result.length > 0 && Math.abs(result[result.length - 1].t - point.t) <= 1e-9) result[result.length - 1] = point;
        else result.push(point);
    }
    return result;
}

function isNonLinearAt(points: readonly EnvelopePoint[], t: number): boolean {
    for (let index = 1; index < points.length; index += 1) {
        if (t < points[index].t) {
            const easing = points[index].easing ?? 'linear';
            return easing !== 'linear' && easing !== 'hold';
        }
    }
    return false;
}

function mergeIntervals(intervals: readonly DuckInterval[], maximumGapSec: number): DuckInterval[] {
    const sorted = intervals.filter(interval => interval && Number.isFinite(interval.startSec)
        && Number.isFinite(interval.endSec) && interval.startSec >= 0 && interval.endSec > interval.startSec)
        .map(interval => ({ ...interval })).sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
    const merged: DuckInterval[] = [];
    for (const interval of sorted) {
        const last = merged[merged.length - 1];
        if (last && interval.startSec - last.endSec < maximumGapSec) last.endSec = Math.max(last.endSec, interval.endSec);
        else if (last && interval.startSec <= last.endSec) last.endSec = Math.max(last.endSec, interval.endSec);
        else merged.push(interval);
    }
    return merged;
}

function easingAtExactPoint(points: readonly EnvelopePoint[], t: number): { easing?: EasingV2 } {
    const point = points.find(candidate => Math.abs(candidate.t - t) <= 1e-9);
    return point?.easing ? { easing: point.easing } : {};
}

function dbToLinear(db: number): number {
    return Math.max(MIN_LINEAR_GAIN, 10 ** (db / 20));
}

function finiteInRange(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value : fallback;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function cubicCoordinateAt(parameter: number, first: number, second: number): number {
    const inverse = 1 - parameter;
    return 3 * inverse * inverse * parameter * first
        + 3 * inverse * parameter * parameter * second
        + parameter * parameter * parameter;
}

function cubicBezierAt(progress: number, x1: number, y1: number, x2: number, y2: number): number {
    if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return progress;
    if (x1 === y1 && x2 === y2) return progress;
    let lower = 0;
    let upper = 1;
    for (let index = 0; index < 32; index += 1) {
        const parameter = (lower + upper) / 2;
        if (cubicCoordinateAt(parameter, x1, x2) < progress) lower = parameter;
        else upper = parameter;
    }
    return cubicCoordinateAt((lower + upper) / 2, y1, y2);
}
