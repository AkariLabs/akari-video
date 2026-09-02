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
    style: string | null;
    words: DaihonCaptionWord[] | null;
    unrecognized: { start: number; end: number }[];
    fragmentBreakWordIndex: number | null;
    edited: boolean;
    timeDomain: 'source' | 'output';
}

function fragmentBreak(caption: DaihonCaptionLike, words: readonly DaihonCaptionWord[] | null): number | null {
    const fragments = caption.displayFragments ?? caption.display_fragments;
    if (fragments?.length !== 2) {
        return null;
    }
    const firstLength = fragments[0].length;
    if (!words) {
        return firstLength;
    }
    let length = 0;
    for (let index = 0; index < words.length; index++) {
        length += words[index].text.length;
        if (length >= firstLength) {
            return index + 1;
        }
    }
    return words.length;
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
        return {
            id: caption.id,
            start: caption.start,
            end: caption.end,
            outStart,
            outEnd,
            text: caption.text,
            style: caption.style ?? null,
            words,
            unrecognized,
            fragmentBreakWordIndex: fragmentBreak(caption, words),
            edited: caption.edited === true,
            timeDomain
        };
    });
}
