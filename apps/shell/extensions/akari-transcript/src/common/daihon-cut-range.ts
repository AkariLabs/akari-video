export const CUT_RANGE_PAD_SEC = 0.4;
export const CUT_RANGE_NEIGHBOR_PAD_SEC = 0.5;
export const CUT_RANGE_WINDOW_MIN_SEC = 4;
export const CUT_RANGE_ZOOM_MIN_SEC = 2;
export const CUT_RANGE_ZOOM_MAX_SEC = 12;
export const CUT_RANGE_ZOOM_FACTOR = 1.25;
export const CUT_RANGE_TICK_SEC = 0.5;
export const CUT_RANGE_PREVIEW_PAD_SEC = 0.8;
export const CUT_RANGE_MIN_SEC = 0.05;
export const CUT_RANGE_MAGNET_TOL_SEC = 0.08;

export interface DaihonCutRangeTarget {
    kind: 'silence' | 'word';
    /** 対象そのもの（無音区間 / 語の発話区間）のソース秒 */
    start: number;
    end: number;
    /** 外側の限界（word は行の start / end。silence は start / end と同値でよい） */
    limitStart: number;
    limitEnd: number;
}

export interface DaihonCutRangeBounds { lo: number; hi: number }
export interface DaihonCutRangeSelection { from: number; to: number }
export interface DaihonCutRangeWindow { start: number; end: number }
export interface DaihonCutRangeSpan { from: number; to: number }
export interface DaihonCutRangeWord { text: string; start: number; end: number }
export interface DaihonCutRangeMagnet { seconds: number; kind: 'silence' | 'word' }
export interface DaihonCutRangeTick { seconds: number; ratio: number; major: boolean; label: string }
export interface DaihonCutRangeBand {
    text: string;
    start: number;
    end: number;
    ratio: number;
    widthRatio: number;
    role: 'target' | 'context';
}
export interface DaihonCutRangeZoomOptions { zoom?: number }

function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}

export function cutRangeBounds(target: DaihonCutRangeTarget): DaihonCutRangeBounds {
    return {
        lo: Math.max(target.limitStart, target.start - CUT_RANGE_PAD_SEC),
        hi: Math.min(target.limitEnd, target.end + CUT_RANGE_PAD_SEC)
    };
}

export function cutRangeWindowBounds(window: DaihonCutRangeWindow): DaihonCutRangeBounds {
    return { lo: window.start, hi: Math.max(window.end, window.start + CUT_RANGE_MIN_SEC) };
}

export function cutRangeMagnets(
    silences: readonly { start: number; end: number }[], words: readonly DaihonCutRangeWord[]
): DaihonCutRangeMagnet[] {
    const candidates: DaihonCutRangeMagnet[] = [
        ...silences.flatMap(silence => [
            { seconds: silence.start, kind: 'silence' as const },
            { seconds: silence.end, kind: 'silence' as const }
        ]),
        ...words.flatMap(word => [
            { seconds: word.start, kind: 'word' as const },
            { seconds: word.end, kind: 'word' as const }
        ])
    ].filter(magnet => Number.isFinite(magnet.seconds));
    candidates.sort((left, right) => left.seconds - right.seconds
        || (left.kind === right.kind ? 0 : left.kind === 'silence' ? -1 : 1));
    return candidates.filter((magnet, index) => index === 0 || magnet.seconds !== candidates[index - 1].seconds);
}

export function snapToMagnet(
    seconds: number,
    magnets: readonly DaihonCutRangeMagnet[],
    tol = CUT_RANGE_MAGNET_TOL_SEC,
    shift = false
): { seconds: number; magnet: DaihonCutRangeMagnet | null } {
    if (shift || !Number.isFinite(seconds) || !Number.isFinite(tol) || tol <= 0 || !magnets.length) {
        return { seconds, magnet: null };
    }
    const candidate = magnets.filter(magnet => Number.isFinite(magnet.seconds) && Math.abs(magnet.seconds - seconds) <= tol)
        .sort((left, right) => Math.abs(left.seconds - seconds) - Math.abs(right.seconds - seconds)
            || (left.kind === right.kind ? 0 : left.kind === 'silence' ? -1 : 1)
            || left.seconds - right.seconds)[0];
    return candidate ? { seconds: candidate.seconds, magnet: candidate } : { seconds, magnet: null };
}

export function defaultCutRange(target: DaihonCutRangeTarget, keepSec: number): DaihonCutRangeSelection {
    const bounds = cutRangeBounds(target);
    if (target.kind === 'word') return clampCutRange({ from: target.start, to: target.end }, bounds);
    const silenceBounds = {
        lo: Math.max(bounds.lo, target.start),
        hi: Math.min(bounds.hi, target.end)
    };
    const kept = Number.isFinite(keepSec) ? Math.max(0, keepSec) : 0;
    const from = Math.max(silenceBounds.lo, Math.min(target.start + kept, silenceBounds.hi - CUT_RANGE_MIN_SEC));
    return clampCutRange({ from, to: target.end }, silenceBounds);
}

export function clampCutRange(
    selection: DaihonCutRangeSelection,
    bounds: DaihonCutRangeBounds
): DaihonCutRangeSelection {
    if (bounds.hi - bounds.lo < CUT_RANGE_MIN_SEC) return { from: bounds.lo, to: bounds.hi };
    const rawFrom = Number.isFinite(selection.from) ? selection.from : bounds.lo;
    const rawTo = Number.isFinite(selection.to) ? selection.to : bounds.hi;
    let from = clamp(rawFrom, bounds.lo, bounds.hi - CUT_RANGE_MIN_SEC);
    let to = clamp(rawTo, from + CUT_RANGE_MIN_SEC, bounds.hi);
    if (to - from < CUT_RANGE_MIN_SEC) {
        from = Math.max(bounds.lo, to - CUT_RANGE_MIN_SEC);
        to = Math.min(bounds.hi, from + CUT_RANGE_MIN_SEC);
    }
    return { from, to };
}

export function moveCutRangeEdge(
    selection: DaihonCutRangeSelection,
    edge: 'from' | 'to',
    seconds: number,
    bounds: DaihonCutRangeBounds
): DaihonCutRangeSelection {
    if (!Number.isFinite(seconds)) return selection;
    const current = clampCutRange(selection, bounds);
    if (bounds.hi - bounds.lo < CUT_RANGE_MIN_SEC) return current;
    return edge === 'from'
        ? { from: clamp(seconds, bounds.lo, current.to - CUT_RANGE_MIN_SEC), to: current.to }
        : { from: current.from, to: clamp(seconds, current.from + CUT_RANGE_MIN_SEC, bounds.hi) };
}

export function cutRangeNeighborWords(
    target: DaihonCutRangeTarget,
    words: readonly DaihonCutRangeWord[]
): { previous?: DaihonCutRangeWord; next?: DaihonCutRangeWord } {
    const sorted = [...words].sort((left, right) => left.start - right.start || left.end - right.end);
    const previousWords = sorted.filter(word => word.end <= target.start + 1e-6);
    const previous = previousWords[previousWords.length - 1];
    const next = sorted.find(word => word.start >= target.end - 1e-6);
    return {
        ...(previous ? { previous } : {}),
        ...(next ? { next } : {})
    };
}

function roundedSeconds(seconds: number): number {
    const rounded = Math.round(seconds * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
}

export function cutRangeWindow(
    target: DaihonCutRangeTarget,
    words: readonly DaihonCutRangeWord[],
    options?: DaihonCutRangeZoomOptions
): DaihonCutRangeWindow {
    const bounds = cutRangeBounds(target);
    const zoom = options?.zoom;
    let start: number;
    let end: number;
    if (Number.isFinite(zoom)) {
        const width = clamp(zoom!, CUT_RANGE_ZOOM_MIN_SEC, CUT_RANGE_ZOOM_MAX_SEC);
        const center = (target.start + target.end) / 2;
        start = center - width / 2;
        end = center + width / 2;
    } else {
        const { previous, next } = cutRangeNeighborWords(target, words);
        start = (previous?.start ?? target.start) - CUT_RANGE_NEIGHBOR_PAD_SEC;
        end = (next?.end ?? target.end) + CUT_RANGE_NEIGHBOR_PAD_SEC;
        if (end - start < CUT_RANGE_WINDOW_MIN_SEC) {
            const center = (start + end) / 2;
            start = center - CUT_RANGE_WINDOW_MIN_SEC / 2;
            end = center + CUT_RANGE_WINDOW_MIN_SEC / 2;
        }
    }
    start = Math.min(start, bounds.lo);
    end = Math.max(end, bounds.hi);
    if (start < 0) {
        end -= start;
        start = 0;
    }
    return { start: roundedSeconds(start), end: roundedSeconds(end) };
}

export function cutRangeWaveWindow(
    target: DaihonCutRangeTarget,
    words: readonly DaihonCutRangeWord[]
): DaihonCutRangeWindow {
    const natural = cutRangeWindow(target, words);
    const widest = cutRangeWindow(target, words, { zoom: CUT_RANGE_ZOOM_MAX_SEC });
    return { start: Math.min(natural.start, widest.start), end: Math.max(natural.end, widest.end) };
}

export function cutRangeZoomSpan(span: number, direction: 'in' | 'out'): number {
    if (!Number.isFinite(span)) return CUT_RANGE_WINDOW_MIN_SEC;
    const next = direction === 'in' ? span / CUT_RANGE_ZOOM_FACTOR : span * CUT_RANGE_ZOOM_FACTOR;
    return Math.round(clamp(next, CUT_RANGE_ZOOM_MIN_SEC, CUT_RANGE_ZOOM_MAX_SEC) * 100) / 100;
}

export function cutRangeTicks(
    window: DaihonCutRangeWindow,
    step = CUT_RANGE_TICK_SEC
): DaihonCutRangeTick[] {
    const width = window.end - window.start;
    if (!Number.isFinite(step) || step <= 0 || width === 0) return [];
    const ticks: DaihonCutRangeTick[] = [];
    const first = Math.ceil((window.start - 1e-6) / step) * step;
    for (let seconds = first; seconds <= window.end + 1e-6; seconds += step) {
        const rounded = roundedSeconds(seconds);
        const major = Math.abs(rounded - Math.round(rounded)) <= 1e-6;
        ticks.push({
            seconds: rounded,
            ratio: cutRangeRatio(rounded, window),
            major,
            label: major ? rounded.toFixed(1) : ''
        });
    }
    return ticks;
}

export function cutRangeWordBands(
    target: DaihonCutRangeTarget,
    words: readonly DaihonCutRangeWord[],
    window: DaihonCutRangeWindow
): DaihonCutRangeBand[] {
    const width = window.end - window.start;
    if (width <= 0) return [];
    return words.flatMap(word => {
        const start = Math.max(word.start, window.start);
        const end = Math.min(word.end, window.end);
        if (end <= start) return [];
        return [{
            text: word.text,
            start: word.start,
            end: word.end,
            ratio: (start - window.start) / width,
            widthRatio: (end - start) / width,
            role: word.start < target.end && target.start < word.end ? 'target' as const : 'context' as const
        }];
    });
}

export function cutRangeIsSpeech(seconds: number, words: readonly DaihonCutRangeWord[]): boolean {
    return words.some(word => word.start <= seconds && seconds <= word.end);
}

export function resampleCutRangePeaks(
    peaks: readonly number[],
    source: DaihonCutRangeWindow,
    view: DaihonCutRangeWindow,
    count: number
): number[] {
    const sourceWidth = source.end - source.start;
    const viewWidth = view.end - view.start;
    const outputCount = Math.floor(count);
    if (!peaks.length || outputCount <= 0 || sourceWidth === 0 || viewWidth <= 0) return [];
    const bucketWidth = sourceWidth / peaks.length;
    return Array.from({ length: outputCount }, (_, index) => {
        const intervalStart = view.start + index / outputCount * viewWidth;
        const intervalEnd = view.start + (index + 1) / outputCount * viewWidth;
        const first = Math.max(0, Math.floor((intervalStart - source.start) / bucketWidth));
        const last = Math.min(peaks.length - 1, Math.ceil((intervalEnd - source.start) / bucketWidth) - 1);
        let maximum = 0;
        for (let bucket = first; bucket <= last; bucket++) {
            const bucketStart = source.start + bucket * bucketWidth;
            const bucketEnd = bucketStart + bucketWidth;
            if (bucketStart < intervalEnd && intervalStart < bucketEnd) maximum = Math.max(maximum, peaks[bucket]);
        }
        return maximum;
    });
}

export function cutRangeRatio(seconds: number, window: DaihonCutRangeWindow): number {
    const width = window.end - window.start;
    return width === 0 ? 0 : clamp((seconds - window.start) / width, 0, 1);
}

export function cutRangeTime(ratio: number, window: DaihonCutRangeWindow): number {
    return window.start + clamp(ratio, 0, 1) * (window.end - window.start);
}

export function cutRangeReadout(
    target: DaihonCutRangeTarget,
    selection: DaihonCutRangeSelection,
    words?: readonly DaihonCutRangeWord[],
    silences?: readonly { start: number; end: number }[]
): string {
    const cut = (selection.to - selection.from).toFixed(2);
    const times = `${selection.from.toFixed(2)}–${selection.to.toFixed(2)}`;
    let readout: string;
    if (target.kind === 'silence') {
        const keep = selection.from - target.start;
        readout = keep < 0
            ? `切る ${cut} 秒 · 食い込み ${Math.abs(keep).toFixed(2)} 秒 · ${times}`
            : `切る ${cut} 秒 · 残す ${keep.toFixed(2)} 秒 · ${times}`;
    } else {
        readout = `切る ${cut} 秒 · ${times}`;
    }
    const intrusion = words ? cutRangeWordIntrusion(selection, words, silences) : 0;
    return intrusion > 0.001 ? `${readout} · 語に食い込み ${intrusion.toFixed(2)} 秒` : readout;
}

export function cutRangeWordIntrusion(
    selection: DaihonCutRangeSelection,
    words: readonly DaihonCutRangeWord[],
    silences?: readonly { start: number; end: number }[]
): number {
    const excluded = silences ? silences
        .filter(silence => Number.isFinite(silence.start) && Number.isFinite(silence.end) && silence.end > silence.start)
        .map(silence => ({ start: silence.start, end: silence.end }))
        .sort((left, right) => left.start - right.start || left.end - right.end) : [];
    const seconds = words.reduce((sum, word) => {
        const start = Math.max(selection.from, word.start);
        const end = Math.min(selection.to, word.end);
        if (!(end > start)) return sum;
        let covered = 0;
        let cursor = start;
        for (const silence of excluded) {
            if (silence.end <= cursor) continue;
            if (silence.start >= end) break;
            const silenceStart = Math.max(cursor, silence.start);
            const silenceEnd = Math.min(end, silence.end);
            if (silenceEnd > silenceStart) {
                covered += silenceEnd - silenceStart;
                cursor = silenceEnd;
            }
        }
        return sum + Math.max(0, end - start - covered);
    }, 0);
    return roundedSeconds(seconds);
}

export function cutRangePreviewSpans(
    selection: DaihonCutRangeSelection,
    window: DaihonCutRangeWindow,
    mode: 'intact' | 'tightened',
    pad = CUT_RANGE_PREVIEW_PAD_SEC
): DaihonCutRangeSpan[] {
    if (mode === 'intact') {
        return [{
            from: Math.max(window.start, selection.from - pad),
            to: Math.min(window.end, selection.to + pad)
        }];
    }
    return [
        { from: Math.max(window.start, selection.from - pad), to: selection.from },
        { from: selection.to, to: Math.min(window.end, selection.to + pad) }
    ].filter(span => span.to > span.from);
}
