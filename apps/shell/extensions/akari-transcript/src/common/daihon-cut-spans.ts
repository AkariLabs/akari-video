import type { TimelineSegment } from '@akari-video/edit-store';
import type { CutRange } from '@akari-video/edit-store';
import type { DaihonRow } from './daihon-row-model';
import type { DaihonRowGap } from './daihon-silence';
import { segmentsForSource } from './daihon-time-map';
import { normalizeFillerWord } from './daihon-filler';

export interface DaihonCutSpan {
    rowId: string;
    kind: 'row' | 'word' | 'unrecognized' | 'silence';
    index?: number;
    in: number;
    out: number;
    sourceId: string | null;
    restoreRange?: CutRange;
    removedSeconds: number;
}

const CUT_EPSILON = 1e-6;

export function sameCutSpanIdentity(left: DaihonCutSpan, right: DaihonCutSpan): boolean {
    return left.rowId === right.rowId && left.kind === right.kind && left.index === right.index
        && left.sourceId === right.sourceId
        && Math.abs(left.in - right.in) <= CUT_EPSILON
        && Math.abs(left.out - right.out) <= CUT_EPSILON;
}

export function restoreImpact(spans: readonly DaihonCutSpan[], selected: DaihonCutSpan, fps: number): {
    wider: boolean; otherCount: number;
} {
    const range = selected.restoreRange;
    if (!range) return { wider: false, otherCount: 0 };
    const tolerance = 1 / fps + CUT_EPSILON;
    const otherCount = spans.filter(span => !sameCutSpanIdentity(span, selected)
        && span.sourceId === selected.sourceId
        && span.restoreRange && Math.abs(span.restoreRange.in - range.in) <= CUT_EPSILON
        && Math.abs(span.restoreRange.out - range.out) <= CUT_EPSILON).length;
    return { wider: otherCount > 0 || range.in < selected.in - tolerance
        || range.out > selected.out + tolerance, otherCount };
}

function keptIntervals(segments: readonly TimelineSegment[]): Array<{ in: number; out: number }> {
    const sorted = segments.flatMap(segment => segment.kind === 'src'
        && typeof segment.in === 'number' && typeof segment.out === 'number'
        ? [{ in: segment.in, out: segment.out }] : [])
        .sort((a, b) => a.in - b.in || a.out - b.out);
    const merged: Array<{ in: number; out: number }> = [];
    for (const interval of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && interval.in <= previous.out) previous.out = Math.max(previous.out, interval.out);
        else merged.push({ ...interval });
    }
    return merged;
}

function missingRange(kept: readonly { in: number; out: number }[], start: number, end: number): { in: number; out: number } | undefined {
    const gaps: Array<{ in: number; out: number }> = [];
    if (kept.length === 0) return { in: start, out: end };
    if (start < kept[0].in) gaps.push({ in: start, out: kept[0].in });
    for (let index = 0; index + 1 < kept.length; index++) {
        if (kept[index].out < kept[index + 1].in) gaps.push({ in: kept[index].out, out: kept[index + 1].in });
    }
    if (end > kept[kept.length - 1].out) gaps.push({ in: kept[kept.length - 1].out, out: end });
    return gaps.filter(gap => gap.in < end && start < gap.out)
        .sort((a, b) => Math.min(end, b.out) - Math.max(start, b.in)
            - (Math.min(end, a.out) - Math.max(start, a.in)))[0];
}

/** Recomputed from source-time captions and the edit's kept intervals on every reload. */
export function deriveDaihonCutSpans(
    rows: readonly DaihonRow[], gaps: readonly DaihonRowGap[],
    segments: readonly TimelineSegment[], fps = 30,
    sourceIdForRow: (row: DaihonRow) => string | null | undefined = row => row.src
): DaihonCutSpan[] {
    const spans: DaihonCutSpan[] = [];
    const tolerance = 1 / fps + CUT_EPSILON;
    const rowById = new Map(rows.map(row => [row.id, row]));
    for (const row of rows) {
        const sourceId = sourceIdForRow(row) ?? null;
        const sourceSegments = segmentsForSource(segments, sourceId);
        const kept = keptIntervals(sourceSegments);
        const push = (kind: DaihonCutSpan['kind'], start: number, end: number, index?: number): void => {
            if (!(end > start)) return;
            const keptSeconds = kept.reduce((sum, interval) => sum
                + Math.max(0, Math.min(end, interval.out) - Math.max(start, interval.in)), 0);
            const removedSeconds = Math.max(0, end - start - keptSeconds);
            if (kind === 'silence' ? removedSeconds < 0.02
                : removedSeconds <= CUT_EPSILON || keptSeconds > tolerance) return;
            const missing = missingRange(kept, start, end);
            const restoreKind: CutRange['kind'] = kind === 'word' ? 'filler' : kind;
            const label = kind === 'row' ? '行' : kind === 'silence' ? '無音'
                : kind === 'unrecognized' ? '??' : normalizeFillerWord(row.words?.[index ?? -1]?.text ?? '');
            spans.push({ rowId: row.id, kind, index, in: start, out: end, sourceId,
                restoreRange: missing ? { ...missing, kind: restoreKind, captionId: sourceId ?? undefined,
                    ...(label ? { label } : {}) } : undefined,
                removedSeconds });
        };
        if (row.outStart === null) {
            push('row', row.start, row.end);
        } else {
            row.words?.forEach((word, index) => push('word', word.start, word.end, index));
            row.unrecognized.forEach((unknown, index) => push('unrecognized', unknown.start, unknown.end, index));
        }
        for (const gap of gaps.filter(item => item.prevId === row.id)) {
            const next = rowById.get(gap.nextId);
            if (!next || (sourceIdForRow(next) ?? null) !== sourceId) continue;
            push('silence', gap.start, gap.end);
        }
    }
    return spans;
}
