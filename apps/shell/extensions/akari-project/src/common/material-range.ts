export interface MaterialRange { in: number; out: number }

const centiseconds = (value: number): number => Math.round(value * 100) / 100;

/** The label uses floored endpoints so its displayed length always adds up. */
export function materialRangeLabel(range: MaterialRange, compact = false): string {
    const start = Math.floor(range.in);
    const end = Math.floor(range.out);
    const stamp = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return compact ? stamp(end - start) : `${stamp(start)} → ${stamp(end)} · ${stamp(end - start)}`;
}

/** Percentage geometry for the indicator beneath an unselected strip. */
export function materialRangeLinePosition(range: MaterialRange, durationSeconds: number): { left: number; width: number } {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { left: 0, width: 0 };
    const start = Number.isFinite(range.in) ? Math.max(0, Math.min(durationSeconds, range.in)) : 0;
    const end = Number.isFinite(range.out) ? Math.max(start, Math.min(durationSeconds, range.out)) : start;
    return { left: 100 * start / durationSeconds, width: 100 * (end - start) / durationSeconds };
}

/** Keep the stationary handle fixed, including when the pointer leaves the strip. */
export function clampMaterialRange(
    range: MaterialRange, durationSeconds: number, stripWidthPx: number, moving: 'in' | 'out'
): MaterialRange {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const minimum = Math.min(duration, Math.max(1, stripWidthPx > 0 ? duration * 24 / stripWidthPx : 1));
    const bound = (value: number): number => Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
    if (moving === 'in') {
        const out = bound(range.out);
        return { in: centiseconds(Math.min(bound(range.in), Math.max(0, out - minimum))), out: centiseconds(out) };
    }
    const inside = bound(range.in);
    return { in: centiseconds(inside), out: centiseconds(Math.max(bound(range.out), Math.min(duration, inside + minimum))) };
}
