export const CUT_RANGE_WORD_PAD_SEC = 0.4;
export const CUT_RANGE_WINDOW_PAD_SEC = 0.9;
export const CUT_RANGE_PREVIEW_PAD_SEC = 0.8;
export const CUT_RANGE_MIN_SEC = 0.05;

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

function clamp(value: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, value));
}

export function cutRangeBounds(target: DaihonCutRangeTarget): DaihonCutRangeBounds {
    if (target.kind === 'silence') return { lo: target.start, hi: target.end };
    return {
        lo: Math.max(target.limitStart, target.start - CUT_RANGE_WORD_PAD_SEC),
        hi: Math.min(target.limitEnd, target.end + CUT_RANGE_WORD_PAD_SEC)
    };
}

export function defaultCutRange(target: DaihonCutRangeTarget, keepSec: number): DaihonCutRangeSelection {
    const bounds = cutRangeBounds(target);
    if (target.kind === 'word') return clampCutRange({ from: target.start, to: target.end }, bounds);
    const kept = Number.isFinite(keepSec) ? Math.max(0, keepSec) : 0;
    const from = Math.max(bounds.lo, Math.min(target.start + kept, bounds.hi - CUT_RANGE_MIN_SEC));
    return clampCutRange({ from, to: target.end }, bounds);
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

export function cutRangeWindow(
    bounds: DaihonCutRangeBounds,
    pad = CUT_RANGE_WINDOW_PAD_SEC
): DaihonCutRangeWindow {
    return { start: Math.max(0, bounds.lo - pad), end: bounds.hi + pad };
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
    selection: DaihonCutRangeSelection
): string {
    const cut = (selection.to - selection.from).toFixed(2);
    const times = `${selection.from.toFixed(2)}–${selection.to.toFixed(2)}`;
    return target.kind === 'silence'
        ? `切る ${cut} 秒 · 残す ${(selection.from - target.start).toFixed(2)} 秒 · ${times}`
        : `切る ${cut} 秒 · ${times}`;
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
