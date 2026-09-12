// regenerateCaptions のローカル採番関数
// (apps/shell/extensions/akari-transcript/src/browser/caption-store.ts) の複製。
export function nextDaihonCaptionId(existingIds: readonly string[]): string {
    const existing = new Set(existingIds);
    let next = existingIds.reduce((maximum, id) => {
        const match = /^c-(\d{4,})$/.exec(id);
        return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;
    let candidate = `c-${String(next).padStart(4, '0')}`;
    while (existing.has(candidate)) {
        next++;
        candidate = `c-${String(next).padStart(4, '0')}`;
    }
    return candidate;
}
