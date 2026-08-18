import URI from '@theia/core/lib/common/uri';
import { readInternalSources } from './edit-store';

/**
 * raw preview の実ファイル URI と、edit.json が宣言する素材表を同じ絶対 URI 空間で照合する。
 * 版の違いは読み込み層（readInternalSources）が吸収済み。単一素材宣言（id を持たない）は
 * 照合対象にしない — 返すべき src id がそもそも無いから。
 */
export function resolveRawSourceId(edit: unknown, projectRootUri: string, mediaUri: string): string | undefined {
    let normalizedMediaUri: string;
    let root: URI;
    try {
        normalizedMediaUri = new URI(mediaUri).normalizePath().toString();
        root = new URI(projectRootUri).normalizePath();
    } catch {
        return undefined;
    }
    for (const source of readInternalSources(edit)) {
        if (source.isDefault || !source.id.trim()
            || typeof source.declaredPath !== 'string' || !source.declaredPath.trim()) {
            continue;
        }
        try {
            if (root.resolve(source.declaredPath).normalizePath().toString() === normalizedMediaUri) {
                return source.id;
            }
        } catch {
            // 壊れた 1 エントリは一致候補から外し、残りの素材表は引き続き調べる。
        }
    }
    return undefined;
}
