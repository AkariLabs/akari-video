export const FILLER_WORDS = new Set(['あの', 'えー', 'えっと', 'その', 'まあ', 'え', 'あー']);

export function normalizeFillerWord(text: string): string {
    return text.replace(/[、。，,．.\s]/gu, '');
}

export function isFillerWord(text: string): boolean {
    return FILLER_WORDS.has(normalizeFillerWord(text));
}
