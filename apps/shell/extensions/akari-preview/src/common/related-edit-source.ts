import URI from '@theia/core/lib/common/uri';
import { readInternalSources } from '@akari-video/edit-store';

function pathBase(value: string): string {
    return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
}

/**
 * raw media が候補 edit.json の素材かを判定する。版の違いは読み込み層が吸収済みで、
 * ここが見るのは素材表の性質だけ: **単一素材宣言（id を持たない宣言）は basename 照合**
 * （後方互換）、**表として宣言された素材は edit.json の親からパスを解決して絶対 URI 照合**。
 */
export function editReferencesRawMedia(edit: unknown, editUri: string, mediaUri: string): boolean {
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

    for (const source of readInternalSources(edit)) {
        if (typeof source.declaredPath !== 'string' || !source.declaredPath.trim()) {
            continue;
        }
        if (source.isDefault) {
            if (pathBase(source.declaredPath) === mediaBase) {
                return true;
            }
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
