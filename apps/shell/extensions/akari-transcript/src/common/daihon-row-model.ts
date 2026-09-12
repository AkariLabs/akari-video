import type { TimelineSegment } from '@akari-video/edit-store';
import { sourceToOutput } from './daihon-time-map';

export interface DaihonCaptionWord {
    text: string;
    start: number;
    end: number;
}

export interface DaihonCaptionLike {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker?: string | null;
    /** 字幕テンプレ id。style の演出 enum とは別物。 */
    stylePreset?: string;
    style: string | null;
    words?: readonly DaihonCaptionWord[];
    unrecognized?: readonly { start: number; end: number }[];
    displayFragments?: readonly string[];
    display_fragments?: readonly string[];
    edited?: boolean;
    timeDomain?: 'source' | 'output';
    time_domain?: 'source' | 'output';
}

export interface DaihonRow {
    id: string;
    start: number;
    end: number;
    outStart: number | null;
    outEnd: number | null;
    text: string;
    speaker: string | null;
    /** 字幕テンプレ id。style の演出 enum とは別物。 */
    stylePreset: string | null;
    style: string | null;
    words: DaihonCaptionWord[] | null;
    unrecognized: { start: number; end: number }[];
    fragmentBreakWordIndices: number[];
    fragmentBreakCharacterOffsets: number[];
    /** @deprecated N 境界対応前の互換フィールド。新規描画は配列フィールドを使う。 */
    fragmentBreakWordIndex: number | null;
    edited: boolean;
    timeDomain: 'source' | 'output';
}

function fragmentBreaks(caption: DaihonCaptionLike, words: readonly DaihonCaptionWord[] | null): {
    wordIndices: number[];
    characterOffsets: number[];
} {
    const fragments = caption.displayFragments ?? caption.display_fragments;
    if (!fragments || fragments.length < 2 || fragments.join('') !== caption.text) {
        return { wordIndices: [], characterOffsets: [] };
    }
    const offsets = fragments.slice(0, -1).map((_fragment, index) =>
        fragments.slice(0, index + 1).reduce((length, item) => length + item.length, 0));
    if (!words || words.map(word => word.text).join('') !== caption.text) {
        return { wordIndices: [], characterOffsets: offsets };
    }
    const wordIndices: number[] = [];
    let length = 0;
    for (let index = 0; index < words.length; index++) {
        length += words[index].text.length;
        if (offsets.includes(length) && index + 1 < words.length) wordIndices.push(index + 1);
    }
    return wordIndices.length === offsets.length
        ? { wordIndices, characterOffsets: [] }
        : { wordIndices: [], characterOffsets: offsets };
}

function overlapsKeptSource(
    segments: readonly TimelineSegment[], start: number, end: number
): boolean {
    return segments.some(segment => segment.kind === 'src'
        && typeof segment.in === 'number'
        && typeof segment.out === 'number'
        && segment.in! < end && start < segment.out!);
}

export function buildDaihonRows(
    captions: readonly DaihonCaptionLike[], segments: readonly TimelineSegment[] | null
): DaihonRow[] {
    return captions.map(caption => {
        const words = caption.words?.length ? caption.words.map(word => ({ ...word })) : null;
        const unrecognized = caption.unrecognized?.map(span => ({ ...span })) ?? [];
        const timeDomain = caption.timeDomain ?? caption.time_domain ?? 'source';
        let outStart: number | null;
        let outEnd: number | null;
        if (timeDomain === 'output') {
            outStart = caption.start;
            outEnd = caption.end;
        } else if (!segments) {
            outStart = caption.start;
            outEnd = caption.end;
        } else if (!overlapsKeptSource(segments, caption.start, caption.end)) {
            outStart = null;
            outEnd = null;
        } else {
            outStart = sourceToOutput(segments, caption.start);
            outEnd = sourceToOutput(segments, caption.end);
            if (outStart === null || outEnd === null || outEnd <= outStart) {
                outStart = null;
                outEnd = null;
            }
        }
        const breaks = fragmentBreaks(caption, words);
        return {
            id: caption.id,
            start: caption.start,
            end: caption.end,
            outStart,
            outEnd,
            text: caption.text,
            speaker: caption.speaker ?? null,
            stylePreset: caption.stylePreset ?? null,
            style: caption.style ?? null,
            words,
            unrecognized,
            fragmentBreakWordIndices: breaks.wordIndices,
            fragmentBreakCharacterOffsets: breaks.characterOffsets,
            fragmentBreakWordIndex: breaks.wordIndices[0] ?? breaks.characterOffsets[0] ?? null,
            edited: caption.edited === true,
            timeDomain
        };
    });
}
