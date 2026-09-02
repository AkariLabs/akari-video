export interface DaihonUnrecognizedSpan {
    start: number;
    end: number;
}

export interface DaihonTimedWord {
    start: number;
    end: number;
}

export interface PlacedUnrecognized {
    beforeWordIndex: number | null;
    span: DaihonUnrecognizedSpan;
}

export function placeUnrecognized(
    words: readonly DaihonTimedWord[] | null | undefined,
    spans: readonly DaihonUnrecognizedSpan[]
): PlacedUnrecognized[] {
    const sorted = spans.map(span => ({ ...span }))
        .sort((left, right) => left.start - right.start || left.end - right.end);
    if (!words?.length) {
        return sorted.map(span => ({ beforeWordIndex: null, span }));
    }
    return sorted.map(span => {
        let previousWordIndex = -1;
        for (let index = 0; index < words.length; index++) {
            if (span.start >= words[index].end) previousWordIndex = index;
        }
        return {
            beforeWordIndex: previousWordIndex + 1 < words.length ? previousWordIndex + 1 : null,
            span
        };
    });
}

// Source: packages/render-cut/bin/fill-caption-words.mjs clipSpansToRange.
// Keep both implementations in sync whenever this clipping rule changes.
export function clipUnrecognizedToRange(
    spans: readonly DaihonUnrecognizedSpan[] | null | undefined,
    start: number,
    end: number
): DaihonUnrecognizedSpan[] {
    const rangeStart = roundMs(Number(start));
    const rangeEnd = roundMs(Number(end));
    if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return [];
    const clipped = (Array.isArray(spans) ? spans : []).flatMap(span => {
        const clippedStart = roundMs(Math.max(rangeStart, Number(span?.start)));
        const clippedEnd = roundMs(Math.min(rangeEnd, Number(span?.end)));
        return Number.isFinite(clippedStart) && Number.isFinite(clippedEnd) && clippedEnd > clippedStart
            ? [{ start: clippedStart, end: clippedEnd }]
            : [];
    }).sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: DaihonUnrecognizedSpan[] = [];
    for (const span of clipped) {
        const previous = merged[merged.length - 1];
        if (previous && span.start <= previous.end) {
            previous.end = roundMs(Math.max(previous.end, span.end));
        } else {
            merged.push({ ...span });
        }
    }
    return merged;
}

function roundMs(value: number): number {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value;
}
