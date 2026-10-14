export interface CaptionEmphasisMatchWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
}

/** Visible substring matching used by the preview and untimed exports. */
export function captionEmphasisMatches<T extends CaptionEmphasisMatchWord>(text: string, start: number, end: number,
    words: readonly T[], src?: string): Array<{ from: number; to: number; emphasis: T }> {
    const matches: Array<{ from: number; to: number; emphasis: T }> = [];
    for (const emphasis of words) {
        if (emphasis.t_end <= start || emphasis.t_start >= end
            || src && emphasis.src && emphasis.src !== src) continue;
        let from = 0;
        while ((from = text.indexOf(emphasis.word, from)) >= 0) {
            matches.push({ from, to: from + emphasis.word.length, emphasis });
            from += emphasis.word.length;
        }
    }
    matches.sort((a, b) => a.from - b.from || b.to - a.to);
    let occupied = 0;
    return matches.filter(match => {
        if (match.from < occupied) return false;
        occupied = match.to;
        return true;
    });
}
