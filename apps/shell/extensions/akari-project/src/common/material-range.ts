export interface MaterialRange { in: number; out: number }

/** Keep the stationary handle fixed, including when the pointer leaves the strip. */
export function clampMaterialRange(
    range: MaterialRange, durationSeconds: number, stripWidthPx: number, moving: 'in' | 'out'
): MaterialRange {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const minimum = Math.min(duration, Math.max(1, stripWidthPx > 0 ? duration * 24 / stripWidthPx : 1));
    const bound = (value: number): number => Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
    if (moving === 'in') {
        const out = bound(range.out);
        return { in: Math.min(bound(range.in), Math.max(0, out - minimum)), out };
    }
    const inside = bound(range.in);
    return { in: inside, out: Math.max(bound(range.out), Math.min(duration, inside + minimum)) };
}
