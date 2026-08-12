import URI from '@theia/core/lib/common/uri';

interface EditSourceCandidate {
    path?: unknown;
}

function pathBase(value: string): string {
    return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
}

/**
 * raw media が候補 edit.json の source かを判定する。
 * v0 は既存の basename 判定を維持し、v1 は sources[].path を edit.json の親から解決して
 * raw preview の実 URI と同じ絶対 URI 空間で照合する。
 */
export function editReferencesRawMedia(edit: unknown, editUri: string, mediaUri: string): boolean {
    const candidate = edit as {
        source?: EditSourceCandidate;
        sources?: unknown;
    } | undefined;
    let normalizedMediaUri: string;
    let mediaBase: string;
    let projectRoot: URI;
    try {
        const media = new URI(mediaUri).normalizePath();
        normalizedMediaUri = media.toString();
        mediaBase = media.path.base;
        projectRoot = new URI(editUri).normalizePath().parent;
    } catch {
        return false;
    }

    // v0 後方互換: 従来どおり source.path の basename で照合する。
    if (typeof candidate?.source?.path === 'string'
        && pathBase(candidate.source.path) === mediaBase) {
        return true;
    }

    const sources = Array.isArray(candidate?.sources)
        ? candidate.sources as EditSourceCandidate[]
        : [];
    for (const source of sources) {
        if (typeof source?.path !== 'string' || !source.path.trim()) {
            continue;
        }
        try {
            if (projectRoot.resolve(source.path).normalizePath().toString() === normalizedMediaUri) {
                return true;
            }
        } catch {
            // 壊れた 1 エントリは一致候補から外し、残りの sources[] を引き続き調べる。
        }
    }
    return false;
}
