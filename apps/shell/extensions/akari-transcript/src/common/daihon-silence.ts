import type { DaihonRow } from './daihon-row-model';

export const DAIHON_SILENCE_DEFAULTS = Object.freeze({ minGapSec: 0.45, keepSec: 0.15 });
export const DAIHON_SILENCE_DETECT_DEFAULTS = Object.freeze({ noiseDb: -35, minSec: 0.3 });

export interface DaihonSilenceSpan { start: number; end: number }

export interface DaihonRowGap {
    prevId: string;
    nextId: string;
    start: number;
    end: number;
    span: number;
    source?: 'silence' | 'gap';
}

export function findRowGaps(rows: readonly Pick<DaihonRow, 'id' | 'start' | 'end' | 'outStart'>[]): DaihonRowGap[] {
    const kept = rows.filter(row => row.outStart !== null);
    const gaps: DaihonRowGap[] = [];
    for (let index = 0; index + 1 < kept.length; index++) {
        const previous = kept[index];
        const next = kept[index + 1];
        const span = next.start - previous.end;
        if (!(span > 0)) continue;
        gaps.push({ prevId: previous.id, nextId: next.id, start: previous.end, end: next.start, span });
    }
    return gaps;
}

export function parseSilenceSpans(value: unknown): DaihonSilenceSpan[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
        const start = Array.isArray(item) ? item[0]
            : item && typeof item === 'object' ? (item as { start?: unknown }).start : undefined;
        const end = Array.isArray(item) ? item[1]
            : item && typeof item === 'object' ? (item as { end?: unknown }).end : undefined;
        return typeof start === 'number' && Number.isFinite(start)
            && typeof end === 'number' && Number.isFinite(end) && end > start
            ? [{ start, end }] : [];
    }).sort((left, right) => left.start - right.start || left.end - right.end);
}

export function silencesInWindow(
    silences: readonly DaihonSilenceSpan[], window: { start: number; end: number }
): DaihonSilenceSpan[] {
    return silences.filter(silence => silence.start < window.end && silence.end > window.start)
        .map(silence => ({ ...silence }));
}

export function findRowSilenceGaps(
    rows: readonly Pick<DaihonRow, 'id' | 'start' | 'end' | 'outStart'>[],
    silences: readonly DaihonSilenceSpan[]
): DaihonRowGap[] {
    const kept = rows.filter(row => row.outStart !== null);
    const gaps: DaihonRowGap[] = [];
    for (let index = 0; index + 1 < kept.length; index++) {
        const previous = kept[index];
        const next = kept[index + 1];
        const candidate = silences
            .filter(silence => silence.start < next.start && silence.end > previous.end)
            .map(silence => ({ silence, overlap: Math.min(silence.end, next.start) - Math.max(silence.start, previous.end) }))
            .sort((left, right) => right.overlap - left.overlap || left.silence.start - right.silence.start)[0];
        if (!candidate) continue;
        gaps.push({ prevId: previous.id, nextId: next.id, ...candidate.silence,
            span: Math.round((candidate.silence.end - candidate.silence.start) * 1e6) / 1e6, source: 'silence' });
    }
    return gaps;
}

export function rowGapsWithSilences(
    rows: readonly Pick<DaihonRow, 'id' | 'start' | 'end' | 'outStart'>[],
    silences: readonly DaihonSilenceSpan[]
): DaihonRowGap[] {
    const fallback = findRowGaps(rows).map(gap => ({ ...gap, source: 'gap' as const }));
    if (!silences.length) return fallback;
    const detected = findRowSilenceGaps(rows, silences);
    const detectedByPair = new Map(detected.map(gap => [`${gap.prevId}\0${gap.nextId}`, gap]));
    const fallbackByPair = new Map(fallback.map(gap => [`${gap.prevId}\0${gap.nextId}`, gap]));
    const kept = rows.filter(row => row.outStart !== null);
    return kept.slice(0, -1).flatMap((previous, index) => {
        const key = `${previous.id}\0${kept[index + 1].id}`;
        const gap = detectedByPair.get(key) ?? fallbackByPair.get(key);
        return gap ? [gap] : [];
    });
}
