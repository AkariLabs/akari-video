export function computeKeywordHits(text, transcript = []) {
    const tokens = [...new Set(String(text ?? '').match(/[A-Za-z0-9]{2,}|[ァ-ヴー]{3,}|[一-龠々]{2,}/g) ?? [])];
    return tokens
        .map(tok => ({ tok, segs: transcript.filter(row => String(row.text ?? '').toLowerCase().includes(tok.toLowerCase())).map(row => row.id) }))
        .filter(hit => hit.segs.length > 0);
}
