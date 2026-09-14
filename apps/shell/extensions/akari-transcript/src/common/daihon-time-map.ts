import {
    outputToSource as mapOutputToSource,
    sourceToOutput as mapSourceToOutput,
    type TimelineSegment
} from '@akari-video/edit-store';
import type { DaihonRow } from './daihon-row-model';

export interface DaihonHighlight {
    rowId: string | null;
    wordIndex: number | null;
}

/** Source seconds to output seconds, with removed ranges snapping to the next kept range. */
export function sourceToOutput(
    segments: readonly TimelineSegment[], sourceT: number
): number | null {
    return mapSourceToOutput(segments, sourceT);
}

/** Keep the edit-store output-to-source contract as the sole inverse implementation. */
export function outputToSource(
    segments: readonly TimelineSegment[], outputT: number
): ReturnType<typeof mapOutputToSource> {
    return mapOutputToSource(segments, outputT);
}

export function resolveCurrent(rows: readonly DaihonRow[], outputT: number): DaihonHighlight {
    const row = rows.find(candidate => candidate.outStart !== null && candidate.outEnd !== null
        && candidate.outStart <= outputT && outputT < candidate.outEnd);
    if (!row) {
        return { rowId: null, wordIndex: null };
    }
    if (!row.words?.length) {
        return { rowId: row.id, wordIndex: null };
    }

    let wordT = outputT;
    if (row.timeDomain === 'source') {
        const outputDuration = row.outEnd! - row.outStart!;
        const sourceDuration = row.end - row.start;
        wordT = outputDuration > 0
            ? row.start + (outputT - row.outStart!) * sourceDuration / outputDuration
            : row.start;
    }

    // Search from the end so the next word wins during its 0.1-second lead-in.
    for (let index = row.words.length - 1; index >= 0; index--) {
        const word = row.words[index];
        if (word.start - 0.1 <= wordT && wordT < word.end) {
            return { rowId: row.id, wordIndex: index };
        }
    }
    let previous: number | null = null;
    for (let index = 0; index < row.words.length; index++) {
        if (row.words[index].end <= wordT) {
            previous = index;
        } else {
            break;
        }
    }
    return { rowId: row.id, wordIndex: previous };
}

/**
 * 素材 id で区間を絞る。`src` が無いとき、または列が素材 id を一切持たない
 * （レガシーの 1 素材 cuts）ときは列をそのまま返す。
 */
export function segmentsForSource(
    segments: readonly TimelineSegment[], src: string | null | undefined
): readonly TimelineSegment[] {
    if (!src) return segments;
    if (!segments.some(segment => typeof segment.src === 'string' && segment.src.length > 0)) return segments;
    return segments.filter(segment => segment.src === src);
}

/**
 * ソース秒 → 出力秒を「その行の素材」の区間だけで写す。
 * output オフセットは列全体の累積（= segment.outStart）をそのまま使う。
 * `src` が null / undefined なら従来の sourceToOutput と同じ。
 */
export function sourceToOutputForSource(
    segments: readonly TimelineSegment[], src: string | null | undefined, sourceT: number
): number | null {
    return mapSourceToOutput(segmentsForSource(segments, src), sourceT);
}
