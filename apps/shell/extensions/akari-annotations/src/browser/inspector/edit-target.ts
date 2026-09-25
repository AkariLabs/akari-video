/** A source id is not a file path; callers resolve it from sources before this check. */
export function isInspectorStillImage(path: unknown): path is string {
    return typeof path === 'string' && /\.(png|jpe?g|webp)$/i.test(path);
}
