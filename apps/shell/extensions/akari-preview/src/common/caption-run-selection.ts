/** DOM selection text -> displayed grapheme offsets (end exclusive). Self-contained for webview injection. */
export function captionRunSelectionRange(prefix: string, selected: string): { from: number; to: number } | undefined {
    if (!selected) return undefined;
    const Segmenter = (Intl as typeof Intl & { Segmenter: new (locale: string | undefined,
        options: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    const count = (text: string) => Array.from(segmenter.segment(text)).length;
    const from = count(prefix);
    const to = from + count(selected);
    return to > from ? { from, to } : undefined;
}

/** Keep the expanded mini panel within the preview frame in client coordinates. */
export function captionRunToolbarPlacement(frame: { left: number; right: number; top: number; bottom: number },
    anchor: { left: number; right: number; top: number; bottom: number },
    tool: { width: number; height: number }, gap = 6): { centerX: number; top: number } {
    const half = tool.width / 2;
    const middle = (anchor.left + anchor.right) / 2;
    const centerX = Math.max(frame.left + half + gap,
        Math.min(frame.right - half - gap, middle));
    const above = anchor.top - tool.height - gap;
    const below = anchor.bottom + gap;
    const top = above >= frame.top + gap ? above
        : below + tool.height <= frame.bottom - gap ? below
            : Math.max(frame.top + gap, Math.min(frame.bottom - tool.height - gap, above));
    return { centerX, top };
}
