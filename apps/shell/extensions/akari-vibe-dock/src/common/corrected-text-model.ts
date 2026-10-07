export interface CorrectedApplied {
    from: string;
    to: string;
    layer: 'builtin' | 'user';
    id: string;
    range?: [number, number];
}
export interface CorrectedSegment { text: string; applied?: CorrectedApplied }

export function buildCorrectedSegments(text: string, applied: CorrectedApplied[]): CorrectedSegment[] {
    if (!Array.isArray(applied) || !applied.length) return [{ text }];
    const sorted = [...applied].sort((a, b) => (a.range?.[0] ?? -1) - (b.range?.[0] ?? -1));
    let cursor = 0;
    const segments: CorrectedSegment[] = [];
    for (const item of sorted) {
        const [start, end] = item.range ?? [-1, -1];
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end <= start || end > text.length || text.slice(start, end) !== item.to) {
            return [{ text }];
        }
        if (start > cursor) segments.push({ text: text.slice(cursor, start) });
        segments.push({ text: text.slice(start, end), applied: item });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments.length ? segments : [{ text }];
}
