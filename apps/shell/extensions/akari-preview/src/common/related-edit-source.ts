import URI from '@theia/core/lib/common/uri';
import { readInternalSources } from '@akari-video/edit-store';

/**
 * raw media が候補 edit.json の v2 素材表に含まれるかを、edit.json の親から解決した
 * 絶対 URI で照合する。
 */
export function editReferencesRawMedia(edit: unknown, editUri: string, mediaUri: string): boolean {
    let normalizedMediaUri: string;
    let projectRoot: URI;
    try {
        const media = new URI(mediaUri).normalizePath();
        normalizedMediaUri = media.toString();
        projectRoot = new URI(editUri).normalizePath().parent;
    } catch {
        return false;
    }

    for (const source of readInternalSources(edit)) {
        if (typeof source.declaredPath !== 'string' || !source.declaredPath.trim()) {
            continue;
        }
        try {
            if (projectRoot.resolve(source.declaredPath).normalizePath().toString() === normalizedMediaUri) {
                return true;
            }
        } catch {
            // 壊れた 1 エントリは一致候補から外し、残りの素材表を引き続き調べる。
        }
    }
    return false;
}
