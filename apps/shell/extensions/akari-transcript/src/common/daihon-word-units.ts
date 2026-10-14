export interface DaihonWordUnit {
    text: string;
    start: number;
    end: number;
    tokenFrom: number;
    tokenTo: number;
}

interface DaihonWordToken {
    text: string;
    start: number;
    end: number;
}

interface WordSegment {
    segment: string;
    index: number;
}

interface WordSegmenter {
    segment(input: string): Iterable<WordSegment>;
}

type WordSegmenterConstructor = new (
    locale: string,
    options: { granularity: 'word' }
) => WordSegmenter;

function tokenUnits(words: readonly DaihonWordToken[]): DaihonWordUnit[] {
    return words.map((word, index) => ({ ...word, tokenFrom: index, tokenTo: index }));
}

export function groupTokensIntoWords(
    text: string,
    words: readonly DaihonWordToken[] | null | undefined,
    locale = 'ja'
): DaihonWordUnit[] {
    if (!words?.length) return [];
    if (words.map(word => word.text).join('') !== text) return tokenUnits(words);

    let segments: Iterable<WordSegment>;
    try {
        const Segmenter = (globalThis.Intl as typeof Intl & { Segmenter?: WordSegmenterConstructor }).Segmenter;
        if (!Segmenter) return tokenUnits(words);
        segments = new Segmenter(locale, { granularity: 'word' }).segment(text);
    } catch {
        return tokenUnits(words);
    }

    const segmentBoundaries = new Set<number>([0, text.length]);
    try {
        for (const segment of segments) {
            segmentBoundaries.add(segment.index);
            segmentBoundaries.add(segment.index + segment.segment.length);
        }
    } catch {
        return tokenUnits(words);
    }

    const result: DaihonWordUnit[] = [];
    let tokenFrom = 0;
    let characterEnd = 0;
    for (let tokenTo = 0; tokenTo < words.length; tokenTo++) {
        characterEnd += words[tokenTo].text.length;
        if (!segmentBoundaries.has(characterEnd)) continue;
        const tokens = words.slice(tokenFrom, tokenTo + 1);
        result.push({
            text: tokens.map(token => token.text).join(''),
            start: tokens[0].start,
            end: tokens[tokens.length - 1].end,
            tokenFrom,
            tokenTo
        });
        tokenFrom = tokenTo + 1;
    }
    return tokenFrom === words.length ? result : tokenUnits(words);
}

export function selectableCaptionWords(text: string, start: number, end: number,
    words: readonly DaihonWordToken[] | null | undefined, locale = 'ja'): DaihonWordToken[] {
    if (words?.length && words.map(word => word.text).join('') === text) return [...words];
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    let parts: string[];
    try {
        const Segmenter = (globalThis.Intl as typeof Intl & { Segmenter?: WordSegmenterConstructor }).Segmenter;
        parts = Segmenter ? [...new Segmenter(locale, { granularity: 'word' }).segment(text)].map(part => part.segment)
            : Array.from(text);
    } catch { parts = Array.from(text); }
    if (parts.join('') !== text || parts.length < 2) parts = Array.from(text);
    let offset = 0;
    return parts.map(part => {
        const from = offset;
        offset += part.length;
        return { text: part, start: start + (end - start) * from / text.length,
            end: start + (end - start) * offset / text.length };
    });
}
