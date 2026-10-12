export interface CaptionClientRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** Ignore the zero-width layout placeholders produced during a caption DOM rebuild. */
export function captionInkClientRect(rects: readonly CaptionClientRect[]): CaptionClientRect | null {
    const visible = rects.filter(rect => [rect.left, rect.right, rect.top, rect.bottom]
        .every(Number.isFinite) && rect.right - rect.left >= 1 && rect.bottom - rect.top >= 1);
    if (!visible.length) return null;
    return {
        left: Math.min(...visible.map(rect => rect.left)),
        right: Math.max(...visible.map(rect => rect.right)),
        top: Math.min(...visible.map(rect => rect.top)),
        bottom: Math.max(...visible.map(rect => rect.bottom))
    };
}
