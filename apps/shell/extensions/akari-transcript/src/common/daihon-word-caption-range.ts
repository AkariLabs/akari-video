import { captionGraphemes, inferCaptionDisplayToSource } from '@akari-video/edit-store';
import type { DaihonWordUnit } from './daihon-word-units';
import type { DaihonWordRange } from './daihon-word-selection';

export type DaihonCaptionRange = { from: number; to: number };
export type DaihonRangeResult = { range: DaihonCaptionRange; text: string } | { reason: string };

export function expandCaptionRangeToAdjacentWhitespace(display: string, range: DaihonCaptionRange): DaihonCaptionRange {
    const chars = captionGraphemes(display);
    let { from, to } = range;
    while (from > 0 && /^\s+$/u.test(chars[from - 1])) from--;
    while (to < chars.length && /^\s+$/u.test(chars[to])) to++;
    return { from, to };
}

export function wordSelectionToCaptionRange(
    caption: { text: string; display_text?: string; words?: readonly { text: string }[] },
    units: readonly DaihonWordUnit[], selection: Pick<DaihonWordRange, 'a' | 'b'>,
    reasons: { words: string; display: string; empty: string }
): DaihonRangeResult {
    const words = caption.words;
    if (!words?.length || words.map(word => word.text).join('') !== caption.text
        || !units[selection.a] || !units[selection.b] || selection.a > selection.b) return { reason: reasons.words };
    const fromToken = units[selection.a].tokenFrom;
    const toToken = units[selection.b].tokenTo;
    if (fromToken < 0 || toToken >= words.length || fromToken > toToken) return { reason: reasons.words };
    let sourceFrom = 0;
    for (let index = 0; index < fromToken; index++) sourceFrom += words[index].text.length;
    let sourceTo = sourceFrom;
    for (let index = fromToken; index <= toToken; index++) sourceTo += words[index].text.length;
    const selected = caption.text.slice(sourceFrom, sourceTo);
    const leading = selected.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = selected.match(/\s*$/u)?.[0].length ?? 0;
    sourceFrom += leading;
    sourceTo -= trailing;
    if (sourceFrom >= sourceTo) return { reason: reasons.empty };
    const sourceStart = captionGraphemes(caption.text.slice(0, sourceFrom)).length;
    const sourceEnd = captionGraphemes(caption.text.slice(0, sourceTo)).length;
    if (captionGraphemes(caption.text).slice(sourceStart, sourceEnd).join('') !== caption.text.slice(sourceFrom, sourceTo))
        return { reason: reasons.words };
    const display = caption.display_text ?? caption.text;
    if (display === caption.text) return { range: { from: sourceStart, to: sourceEnd },
        text: captionGraphemes(display).slice(sourceStart, sourceEnd).join('') };
    const map = inferCaptionDisplayToSource(display, caption.text);
    const chars = captionGraphemes(display);
    const sourceChars = captionGraphemes(caption.text);
    const matched = new Map<number, number>();
    for (let index = 0; index < chars.length; index++) {
        const source = map[index];
        if (source !== undefined && chars[index] === sourceChars[source])
            matched.set(source, index);
    }
    const first = matched.get(sourceStart);
    if (first !== undefined && sourceChars.slice(sourceStart, sourceEnd).every((_, offset) =>
        matched.get(sourceStart + offset) === first + offset)) {
        const text = chars.slice(first, first + sourceEnd - sourceStart).join('');
        if (text === caption.text.slice(sourceFrom, sourceTo))
            return { range: { from: first, to: first + sourceEnd - sourceStart }, text };
    }
    const selectedText = caption.text.slice(sourceFrom, sourceTo);
    const width = sourceEnd - sourceStart;
    const starts: number[] = [];
    const ends: number[] = [];
    for (let index = 0; index < map.length; index++) {
        if (map[index] === sourceStart) starts.push(index);
        if (map[index] === sourceEnd) ends.push(index);
    }
    const boundary = starts.length === 1 && ends.length === 1 && starts[0] < ends[0]
        ? { from: starts[0], to: ends[0] } : undefined;
    const before = matched.get(sourceStart - 1);
    const after = matched.get(sourceEnd);
    const windowFrom = before === undefined ? 0 : before + 1;
    const windowTo = after === undefined ? chars.length : after;
    const exact: number[] = [];
    for (let index = windowFrom; index + width <= windowTo; index++) {
        if (chars.slice(index, index + width).join('') === selectedText) exact.push(index);
    }
    if (exact.length) {
        const overlapping = boundary
            ? exact.filter(index => index < boundary.to && index + width > boundary.from) : [];
        const candidates = overlapping.length ? overlapping : exact;
        if (candidates.length === 1) {
            const from = candidates[0];
            return { range: { from, to: from + width }, text: selectedText };
        }
    }
    if (boundary) {
        const overlapping: number[] = [];
        for (let index = 0; index + width <= chars.length; index++) {
            if (index < boundary.to && index + width > boundary.from
                && chars.slice(index, index + width).join('') === selectedText) overlapping.push(index);
        }
        if (overlapping.length === 1) {
            const from = overlapping[0];
            return { range: { from, to: from + width }, text: selectedText };
        }
    }
    if (!boundary) return { reason: reasons.display };
    let { from, to } = boundary;
    while (from < to && /^\s+$/u.test(chars[from])) from++;
    while (to > from && /^\s+$/u.test(chars[to - 1])) to--;
    const text = chars.slice(from, to).join('');
    if (!text.trim()) return { reason: reasons.display };
    return { range: { from, to }, text };
}
