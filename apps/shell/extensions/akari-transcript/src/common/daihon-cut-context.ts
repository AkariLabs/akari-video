import type { DaihonCutCandidate } from './daihon-cut-candidates';
import type { DaihonRow } from './daihon-row-model';

export type DaihonCutContext = [before: string, marked: string, after: string];

function edge(text: string, side: 'start' | 'end'): string {
    const characters = [...text];
    if (characters.length <= 18) return text;
    return side === 'start' ? `${characters.slice(0, 18).join('')}…` : `…${characters.slice(-18).join('')}`;
}

export function cutCandidateContext(rows: readonly DaihonRow[], candidate: DaihonCutCandidate): DaihonCutContext {
    const index = rows.findIndex(row => row.id === candidate.rowId);
    const row = rows[index];
    if (!row) return ['', candidate.text, ''];
    if (candidate.kind === 'silence') return [edge(row.text, 'end'), `（${candidate.text}）`,
        edge(rows[index + 1]?.text ?? '', 'start')];

    const words = row.words ?? [];
    const first = words.findIndex(word => word.start < candidate.end && candidate.start < word.end);
    if (first >= 0) {
        let last = first;
        while (last + 1 < words.length && words[last + 1].start < candidate.end && candidate.start < words[last + 1].end) last++;
        const marked = words.slice(first, last + 1).map(word => word.text).join('');
        const beforeWords = words.slice(0, first).map(word => word.text).join('');
        const afterWords = words.slice(last + 1).map(word => word.text).join('');
        const offset = row.text.indexOf(marked, beforeWords.length);
        return offset < 0 ? [beforeWords, marked, afterWords]
            : [row.text.slice(0, offset), marked, row.text.slice(offset + marked.length)];
    }

    const text = candidate.kind === 'unrecognized' ? '??' : candidate.text;
    const offset = row.text.indexOf(text);
    if (offset >= 0) return [row.text.slice(0, offset), text, row.text.slice(offset + text.length)];
    return [words.filter(word => word.end <= candidate.start).map(word => word.text).join(''), text,
        words.filter(word => word.start >= candidate.end).map(word => word.text).join('')];
}
