import { updateCaptionRunsInSource, type CaptionRun } from '@akari-video/edit-store';

function cueIn(source: string, id: string): { text: string; display_text?: string; runs?: CaptionRun[] } | undefined {
    const root = JSON.parse(source) as unknown;
    const cues = Array.isArray(root) ? root
        : root && typeof root === 'object' ? (root as { captions?: unknown }).captions : undefined;
    return Array.isArray(cues) ? cues.find(cue => cue?.id === id) : undefined;
}

type Segmenter = new (locale: string | undefined, options: { granularity: 'grapheme' }) =>
    { segment(value: string): Iterable<{ segment: string }> };

const graphemes = (text: string): string[] => {
    const Ctor = (Intl as typeof Intl & { Segmenter: Segmenter }).Segmenter;
    return Array.from(new Ctor(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
};

/** Preserve only the unchanged prefix and suffix of each styled range. */
export function rebaseRunsOutsideReplacement(oldText: string, newText: string,
    runs: readonly CaptionRun[]): { runs: CaptionRun[]; removed: CaptionRun[] } {
    const oldChars = graphemes(oldText);
    const newChars = graphemes(newText);
    let prefix = 0;
    while (prefix < oldChars.length && prefix < newChars.length
        && oldChars[prefix] === newChars[prefix]) prefix++;
    let suffix = 0;
    while (suffix < oldChars.length - prefix && suffix < newChars.length - prefix
        && oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]) suffix++;
    const oldEnd = oldChars.length - suffix;
    const shift = newChars.length - oldChars.length;
    const kept: CaptionRun[] = [];
    const removed: CaptionRun[] = [];
    for (const run of runs) {
        const beforeEnd = Math.min(run.to, prefix);
        const afterStart = Math.max(run.from, oldEnd);
        if (run.from < beforeEnd) kept.push({ ...run, to: beforeEnd });
        if (afterStart < run.to) kept.push({ ...run,
            from: afterStart + shift, to: run.to + shift });
        if (run.from >= beforeEnd && afterStart >= run.to) removed.push(run);
    }
    return { runs: kept, removed };
}

/** Replace the shared editor's stretched ranges while retaining other JSON bytes. */
export function preserveRunsOutsideTextReplacement(before: string, after: string, id: string):
    { source: string; removedRuns: CaptionRun[] } {
    const oldCue = cueIn(before, id);
    const newCue = cueIn(after, id);
    if (!oldCue || !newCue || oldCue.text === newCue.text || !oldCue.runs?.length) {
        return { source: after, removedRuns: [] };
    }
    const result = rebaseRunsOutsideReplacement(oldCue.display_text ?? oldCue.text,
        newCue.display_text ?? newCue.text, oldCue.runs);
    let source = after;
    for (let index = (newCue.runs?.length ?? 0) - 1; index >= 0; index--) {
        source = updateCaptionRunsInSource(source, id, { kind: 'remove', index });
    }
    for (const [index, run] of result.runs.entries()) {
        source = updateCaptionRunsInSource(source, id, { kind: 'insert', index, run });
    }
    return { source, removedRuns: result.removed };
}
