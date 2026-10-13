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
    const starts = map.flatMap((source, index) => source === sourceStart ? [index] : []);
    const ends = map.flatMap((source, index) => source === sourceEnd ? [index] : []);
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) return { reason: reasons.display };
    const chars = captionGraphemes(display);
    let from = starts[0];
    let to = ends[0];
    while (from < to && /^\s+$/u.test(chars[from])) from++;
    while (to > from && /^\s+$/u.test(chars[to - 1])) to--;
    const text = chars.slice(from, to).join('');
    if (!text.trim()) return { reason: reasons.display };
    return { range: { from, to }, text };
}
