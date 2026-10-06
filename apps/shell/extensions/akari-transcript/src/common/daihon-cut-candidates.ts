import type { TimelineSegment } from '@akari-video/edit-store';
import type { TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';
import type { DaihonRow } from './daihon-row-model';
import { isFillerWord } from './daihon-filler';
import { DAIHON_SILENCE_DEFAULTS, rowGapsWithSilences, type DaihonRowSilenceResolver, type DaihonSilenceSpan } from './daihon-silence';

export type DaihonCutKind = 'silence' | 'filler' | 'redo' | 'unrecognized';
export interface DaihonCutCandidate {
    id: string;
    kind: DaihonCutKind;
    start: number;
    end: number;
    text: string;
    rowId: string;
    sourceId: string | null;
}
export interface DaihonCutSource { sourceId: string; cuts: TranscribeCuts | null }
export function handEditedLines(cuts: TranscribeCuts | null): number[] {
    return [...new Set((cuts?.hand_edited ?? []).map(item => item.line).filter(line => Number.isInteger(line) && line > 0))];
}
export interface DaihonCutOptions {
    minGapSec?: number;
    keepSec?: number;
    silences?: readonly DaihonSilenceSpan[] | DaihonRowSilenceResolver;
    sources?: readonly DaihonCutSource[];
    segments?: readonly TimelineSegment[];
}

/** 台本の印と一括確認に同じ候補を渡す。cuts.json の on は採否に使わない。 */
export function collectDaihonCutCandidates(rows: readonly DaihonRow[], options: DaihonCutOptions = {}): DaihonCutCandidate[] {
    const min = options.minGapSec ?? DAIHON_SILENCE_DEFAULTS.minGapSec;
    const keep = options.keepSec ?? DAIHON_SILENCE_DEFAULTS.keepSec;
    const segments = options.segments;
    const sourceOf = (row: DaihonRow): string | null => row.src ?? (options.sources?.length === 1 ? options.sources[0].sourceId : null);
    const sameSource = (segment: TimelineSegment, row: DaihonRow): boolean =>
        sourceOf(row) === null || segment.src === sourceOf(row) ||
        (!segment.src && options.sources?.length === 1);
    const retained = (row: DaihonRow, start: number, end: number): boolean => {
        if (row.outStart === null || !(end > start)) return false;
        if (!segments?.length) return true;
        return segments.some(segment => segment.kind === 'src' && sameSource(segment, row)
            && typeof segment.in === 'number' && typeof segment.out === 'number'
            && segment.in <= start && end <= segment.out);
    };
    const candidates: DaihonCutCandidate[] = [];
    for (const row of rows) {
        if (row.outStart === null) continue;
        row.words?.forEach((word, index) => {
            if (isFillerWord(word.text) && retained(row, word.start, word.end))
                candidates.push({ id: `filler:${row.id}:${index}`, kind: 'filler', start: word.start, end: word.end,
                    text: word.text, rowId: row.id, sourceId: sourceOf(row) });
        });
        row.unrecognized.forEach((span, index) => {
            if (retained(row, span.start, span.end))
                candidates.push({ id: `unrecognized:${row.id}:${index}`, kind: 'unrecognized', start: span.start,
                    end: span.end, text: '??', rowId: row.id, sourceId: sourceOf(row) });
        });
    }
    const gaps = rowGapsWithSilences(rows, options.silences ?? []);
    for (const gap of gaps) {
        const row = rows.find(item => item.id === gap.prevId);
        const next = rows.find(item => item.id === gap.nextId);
        if (!row || !next || sourceOf(row) !== sourceOf(next) || gap.span < min || gap.span <= keep) continue;
        const start = gap.start + keep / 2;
        const end = gap.end - keep / 2;
        // Gaps have no caption of their own; inspect the retained source segments directly.
        if (segments?.length && !segments.some(segment => segment.kind === 'src' && sameSource(segment, row) &&
            typeof segment.in === 'number' && typeof segment.out === 'number' &&
            segment.in <= start && end <= segment.out)) continue;
        candidates.push({ id: `silence:${row.id}:${next.id}`, kind: 'silence', start, end,
            text: `無音 ${gap.span.toFixed(2)} 秒`, rowId: row.id, sourceId: sourceOf(row) });
    }
    for (const source of options.sources ?? []) {
        for (const cut of source.cuts?.candidates ?? []) {
            if (cut.kind !== 'redo' || !Number.isFinite(cut.start) || !Number.isFinite(cut.end)) continue;
            const row = rows.find(item => sourceOf(item) === source.sourceId && item.start < cut.end && cut.start < item.end
                && retained(item, cut.start, cut.end));
            if (row) candidates.push({ id: `redo:${source.sourceId}:${cut.id}`, kind: 'redo', start: cut.start,
                end: cut.end, text: cut.text ?? row.text, rowId: row.id, sourceId: source.sourceId });
        }
    }
    return candidates.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
}
