type JsonObject = Record<string, unknown>;
export { captionEmphasisMatches } from '@akari-video/edit-store';

const isObjectRoot = (value: unknown): value is JsonObject =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** captions.json の object ルートに席が在る場合だけ、その値を返す。 */
export function readCaptionsEmphasisWords(root: unknown): unknown {
    return isObjectRoot(root) && Object.prototype.hasOwnProperty.call(root, 'emphasis_words')
        ? root.emphasis_words
        : undefined;
}

/** v0/v1 edit.json の旧席だけを後方互換入力として返す。 */
export function readLegacyEditEmphasisWords(root: unknown): unknown {
    return isObjectRoot(root) && (root.version === 0 || root.version === 1)
        && Object.prototype.hasOwnProperty.call(root, 'emphasis_words')
        ? root.emphasis_words
        : undefined;
}

/** captions.json の席が在れば無条件で優先し、旧 edit.json 席とはマージしない。 */
export function resolvePreviewEmphasisWords(
    captionsEmphasisWords: unknown,
    legacyEditEmphasisWords: unknown
): unknown {
    return captionsEmphasisWords !== undefined ? captionsEmphasisWords : legacyEditEmphasisWords;
}

export interface PreviewEmphasisWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_hint?: string;
    style_preset?: string;
    inherit_caption_size?: boolean;
}

/** An emphasis preset is sufficient; older cues need no explicit emotion. */
export function normalizePreviewEmphasisWords(value: unknown): PreviewEmphasisWord[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap(item => {
        if (!isObjectRoot(item) || typeof item.id !== 'string' || !/^e-\d{4}$/u.test(item.id)
            || seen.has(item.id) || typeof item.t_start !== 'number' || !Number.isFinite(item.t_start)
            || item.t_start < 0 || typeof item.t_end !== 'number' || !Number.isFinite(item.t_end)
            || item.t_end <= item.t_start || typeof item.word !== 'string' || !item.word.trim()
            || item.emotion !== undefined && (typeof item.emotion !== 'string' || !item.emotion.trim())
            || item.src !== undefined && (typeof item.src !== 'string' || !item.src.trim())
            || item.style_hint !== undefined && typeof item.style_hint !== 'string'
            || item.style_preset !== undefined && typeof item.style_preset !== 'string') return [];
        seen.add(item.id);
        return [{ id: item.id, t_start: item.t_start, t_end: item.t_end, word: item.word,
            emotion: typeof item.emotion === 'string' ? item.emotion : 'emphasis',
            ...(typeof item.src === 'string' ? { src: item.src } : {}),
            ...(typeof item.style_hint === 'string' ? { style_hint: item.style_hint } : {}),
            ...(typeof item.style_preset === 'string' ? { style_preset: item.style_preset } : {}),
            ...(item.inherit_caption_size === true ? { inherit_caption_size: true } : {}) }];
    });
}

/** Find the exact visible substring even when a resolved cue has no timed words. */
