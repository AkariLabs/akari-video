export interface EmphasisWordRecord {
    id: string; src?: string; t_start: number; t_end: number; word: string; emotion: string;
    style_preset?: string; style_hint?: string; [key: string]: unknown;
}
export interface EmphasisWordUpsert {
    src?: string; t_start: number; t_end: number; word: string; emotion: string;
    style_preset?: string; style_hint?: string;
}

export function readEmphasisWords(captionsSource: string): EmphasisWordRecord[] {
    try {
        const root = JSON.parse(captionsSource) as unknown;
        if (!root || Array.isArray(root) || typeof root !== 'object') return [];
        const words = (root as { emphasis_words?: unknown }).emphasis_words;
        return Array.isArray(words) ? words.filter(value => value && typeof value === 'object') as EmphasisWordRecord[] : [];
    } catch { return []; }
}

export function planEmphasisUpserts(
    ranges: readonly { src?: string; t_start: number; t_end: number; word: string }[], stylePreset: string
): EmphasisWordUpsert[] {
    return ranges.map(range => ({ ...range, emotion: 'neutral', style_preset: stylePreset }));
}

export function emphasisIdsCovering(existing: readonly EmphasisWordRecord[],
    spans: readonly { src?: string; t_start: number; t_end: number }[]): string[] {
    return [...new Set(existing.filter(record => spans.some(span =>
        record.src === span.src && record.t_start < span.t_end && span.t_start < record.t_end
    )).map(record => record.id))];
}
