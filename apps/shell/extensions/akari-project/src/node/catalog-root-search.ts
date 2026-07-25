import { dirname } from 'path';

/** task.md 指定: 上方探索は最大 8 階層（起点ディレクトリ自身を含め 9 ディレクトリを判定）。 */
export const CATALOG_ROOT_UPWARD_MAX_DEPTH = 8;

/**
 * startDir 自身を含め、上方向へ最大 maxDepth 階層まで hasCatalogIndex(dir) を判定し、
 * 最初に true を返したディレクトリを返す。ファイルシステムのルートに達したら打ち切る。
 * hasCatalogIndex は `<dir>/catalog/INDEX.md` の存在判定を呼び出し側（fs 依存）が注入する
 * ことで、このディレクトリ探索ロジック自体は fs 非依存の純関数として単体テストできる。
 */
export async function resolveUpwardCatalogRoot(
    startDir: string,
    maxDepth: number,
    hasCatalogIndex: (dir: string) => Promise<boolean> | boolean
): Promise<string | undefined> {
    let current = startDir;
    for (let depth = 0; depth <= maxDepth; depth++) {
        if (await hasCatalogIndex(current)) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
    return undefined;
}
