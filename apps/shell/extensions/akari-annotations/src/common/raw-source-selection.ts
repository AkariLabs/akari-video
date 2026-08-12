import URI from '@theia/core/lib/common/uri';

interface EditSourceCandidate {
    id?: unknown;
    path?: unknown;
}

/** raw preview の実ファイル URI と edit.json v1 sources[].path を同じ絶対 URI 空間で照合する。 */
export function resolveRawSourceId(edit: unknown, projectRootUri: string, mediaUri: string): string | undefined {
    const sources = Array.isArray((edit as { sources?: unknown } | undefined)?.sources)
        ? (edit as { sources: EditSourceCandidate[] }).sources
        : [];
    let normalizedMediaUri: string;
    let root: URI;
    try {
        normalizedMediaUri = new URI(mediaUri).normalizePath().toString();
        root = new URI(projectRootUri).normalizePath();
    } catch {
        return undefined;
    }
    for (const source of sources) {
        if (typeof source?.id !== 'string' || !source.id.trim()
            || typeof source.path !== 'string' || !source.path.trim()) {
            continue;
        }
        try {
            if (root.resolve(source.path).normalizePath().toString() === normalizedMediaUri) {
                return source.id;
            }
        } catch {
            // 壊れた 1 エントリは一致候補から外し、残りの sources[] は引き続き調べる。
        }
    }
    return undefined;
}
