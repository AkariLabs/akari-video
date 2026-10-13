"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captionEmphasisMatches = captionEmphasisMatches;
/** Visible substring matching used by the preview and untimed exports. */
function captionEmphasisMatches(text, start, end, words, src) {
    const matches = [];
    for (const emphasis of words) {
        if (emphasis.t_end <= start || emphasis.t_start >= end
            || src && emphasis.src && emphasis.src !== src)
            continue;
        let from = 0;
        while ((from = text.indexOf(emphasis.word, from)) >= 0) {
            matches.push({ from, to: from + emphasis.word.length, emphasis });
            from += emphasis.word.length;
        }
    }
    matches.sort((a, b) => a.from - b.from || b.to - a.to);
    let occupied = 0;
    return matches.filter(match => {
        if (match.from < occupied)
            return false;
        occupied = match.to;
        return true;
    });
}
