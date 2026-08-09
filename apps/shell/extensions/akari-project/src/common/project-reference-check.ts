/**
 * 素材・できたもの（export）のリネーム/削除前の参照チェック用の純関数
 * （task 2026-08-09-material-context-menu-mvp 指示9）。プロジェクト文書（edit.json /
 * captions.json のテキスト）の中に対象パスが何回出現するかを数えるだけの v0 ヒューリスティック
 * — AST 解析や JSON パースはしない（文字列出現数の合算）。呼び出し側は edit.json /
 * captions.json への書き込みを一切行わない（読み取り専用チェック）。
 */

/**
 * `documents` 全体を通した `relativePath` の出現数の合算。ディレクトリ（`isDirectory`）
 * のときは `relativePath` 単体の出現と `relativePath + '/'`（配下パス prefix）の出現を
 * 別々に数えて合算する（同じ 1 箇所への言及でも両方にマッチしうるが、v0 は正確な
 * 重複排除をしない単純合算でよい — 司令塔裁定どおり）。
 */
export function countReferences(documents: readonly string[], relativePath: string, isDirectory: boolean): number {
    const needles = isDirectory ? [relativePath, `${relativePath}/`] : [relativePath];
    return documents.reduce(
        (total, document) => total + needles.reduce((sum, needle) => sum + countOccurrences(document, needle), 0),
        0
    );
}

function countOccurrences(haystack: string, needle: string): number {
    if (!needle) {
        return 0;
    }
    let count = 0;
    let fromIndex = 0;
    for (;;) {
        const index = haystack.indexOf(needle, fromIndex);
        if (index === -1) {
            return count;
        }
        count++;
        fromIndex = index + needle.length;
    }
}
