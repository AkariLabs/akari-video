/**
 * 素材箱の walk 判定（task.md 決定事項2、正本:
 * 内部リポのタスク契約 material-bin-grouping）:
 * 「meta.json を含むディレクトリ = 1 素材 = 1 カード」。
 *
 * この判定はディレクトリ深さに依存しない（受入2）— 呼び出し側の再帰 walk が、訪れた
 * ディレクトリ 1 つごとにこの純関数へ「直下（1段だけ）の子一覧」を渡せば、旧配置
 * `assets/<id>/` 直下でも新配置 `assets/<category>/<id>/` でも同じ判定で拾える。
 * ファイルシステム I/O を持たない純関数（catalog-reader.ts の流儀を踏襲）。
 */

export interface AssetBinChildNode {
    name: string;
    isDirectory: boolean;
}

const META_FILE_NAME = 'meta.json';

/**
 * 与えられた「あるディレクトリの直下の子一覧」に meta.json（ファイル）が含まれるかどうか。
 * true なら呼び出し側はそのディレクトリを 1 素材 = 1 カードとして打ち切り、
 * 配下（fragment.html 等）をこれ以上展開しない。
 */
export function isAssetBinGroupDirectory(children: readonly AssetBinChildNode[]): boolean {
    return children.some(child => !child.isDirectory && child.name === META_FILE_NAME);
}
