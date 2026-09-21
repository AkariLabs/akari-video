import { view } from '../v2/model.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { splitItem } from '../v2/mutations.mjs';
export const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wordBoundary = '(直前|前(?:で)?|直後|後ろ(?:で)?|後(?:で)?|言い終わ(?:った|る|り)?)';
export const wordLink = '(?:の|って(?:いう|言う)?|と(?:いう|言う)?|を)?';
export function boundaryMentions(text, tokens) {
    return tokens.flatMap(token => {
        const re = new RegExp(`${escape(token)}[」』”"]?${wordLink}${wordBoundary}`, 'g');
        return [...normalize(text).matchAll(re)].map(m => ({ token, end: m.index + m[0].length,
            side: /^(?:直前|前)/.test(m[1]) ? 'before' : 'after' }));
    }).sort((a, b) => b.end - a.end || b.token.length - a.token.length);
}
export function wordSegments(context = {}) {
    const sidecar = context.layout?.['w06-word-timestamps']?.transcript ?? [];
    return (context.transcript ?? []).map(seg => {
        if (Array.isArray(seg.words)) return seg;
        const timing = sidecar.find(row => row.id === seg.id && row.text === seg.text);
        return timing ? { ...seg, words: timing.words, src: timing.src, timeDomain: timing.timeDomain } : seg;
    });
}
export function findWordMatches(text, context) {
    const utterance = normalize(text);
    const segments = wordSegments(context);
    const tokens = [...new Set(segments.flatMap(seg => (seg.words ?? []).map(w => normalize(w.text))))].filter(Boolean);
    // Prefer an explicitly quoted word or a word immediately preceding the
    // boundary expression; words merely identifying the sentence are not targets.
    const quoted = [...utterance.matchAll(/[「『“"]([^」』”"]+)[」』”"]/g)].map(m => m[1]);
    let targets = tokens.filter(token => quoted.includes(token));
    if (!targets.length) {
        const hits = boundaryMentions(utterance, tokens);
        // Last explicit target wins on self-correction. Longest at the same end
        // prevents a suffix word being mistaken for the full quoted token.
        hits.sort((a, b) => b.end - a.end || b.token.length - a.token.length);
        targets = hits.length ? [hits[0].token] : [];
    }
    return segments.flatMap(seg => {
        const matches = (seg.words ?? []).filter(word => targets.includes(normalize(word.text)));
        return matches.length ? [{ segment: seg, matches }] : [];
    });
}
