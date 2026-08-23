type JsonObject = Record<string, unknown>;

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
