export const candidateText = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export function candidateTerms(text) {
    const generic = new Set(['素材', '追加', '検索', '候補', 'ライブラリ', 'タイムライン']);
    return [...new Set(candidateText(text).match(/[a-z0-9_-]{2,}|[ァ-ヴー]{3,}|[一-龠々]{2,}/g) ?? [])].filter(w => !generic.has(w));
}
export function catalogCandidates(rows, { text = '', words = candidateTerms(text),
    search = row => [row.id, row.name, row.title, row.description, row.when_to_use, ...(row.tags ?? [])].join(' '),
    category, categoryOf = row => row.category, fallback = true, score, limit = Infinity } = {}) {
    if (!(limit === Infinity || Number.isInteger(limit) && limit >= 0)) throw new RangeError('Invalid catalog candidate limit');
    const ranked = rows.map((row, index) => ({ row, index, score: score ? score(row) : words.reduce((n, word) => n + Number(candidateText(search(row)).includes(candidateText(word))), 0) }));
    const hits = ranked.filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const categorized = category == null ? [] : rows.filter(row => categoryOf(row) === category);
    return (hits.length ? hits.map(x => x.row) : categorized.length ? categorized : fallback ? rows : []).slice(0, limit);
}
export function candidateContext(kind, rows, { key = row => row.id, label = row => row.title ?? row.name ?? key(row) } = {}) {
    return { kind, items: rows.map(row => ({ key: key(row), label: label(row) })) };
}
export function previousCandidates(ctx, kind) {
    return ctx?.lastCandidates?.kind === kind && Array.isArray(ctx.lastCandidates.items) ? ctx.lastCandidates.items : [];
}
