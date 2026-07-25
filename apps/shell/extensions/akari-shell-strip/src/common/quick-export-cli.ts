import { DEFAULT_EXPORT_OUTPUT_NAME } from './export-request-packet';

/**
 * 「この場で書き出す」バックエンドが `packages/edit-lint` / `packages/render-cut`
 * の既存 CLI を子プロセスで直接呼ぶ際の引数組み立てと、完了判定を担う純関数群。
 * 両 CLI 本体は無改造・子プロセスからの呼び出しのみ（task.md 境界）。
 *
 * render-cut は解像度を表す CLI 引数を持たない（出力解像度は edit.json の
 * output.width/height から決まる — packages/render-cut/src/plan.mjs 参照）。
 * そのため設定 quick-pick の「解像度プリセット」は直接実行パスの CLI 引数には
 * 反映できない（正直な縮退。report にも明記）。
 */

export const QUICK_EXPORT_OUTPUT_DIRECTORY = 'exports';

/** edit-lint CLI: `edit-lint <projectRoot> --json`（`.akari/lint.json` を書く既定の呼び方）。 */
export function buildEditLintArgs(projectRoot: string): string[] {
    return [projectRoot, '--json'];
}

/**
 * 出力ファイル名からディレクトリ区切り・親ディレクトリ参照を剥がし、
 * 常に `exports/` 直下のファイル名 1 段に収める（パス脱出防止）。
 * 空文字・空白のみ・`.`/`..` のみになった場合は既定名にフォールバックする。
 */
export function sanitizeQuickExportOutputName(outputName: string): string {
    const trimmed = outputName.trim();
    const segments = trimmed.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.' && segment !== '..');
    const lastSegment = segments[segments.length - 1]?.trim();
    return lastSegment || DEFAULT_EXPORT_OUTPUT_NAME;
}

/** render-cut の `--out` に渡す、プロジェクトルート相対の出力パス（常に `exports/` 直下）。 */
export function buildRenderCutOutputRelativePath(outputName: string): string {
    return `${QUICK_EXPORT_OUTPUT_DIRECTORY}/${sanitizeQuickExportOutputName(outputName)}`;
}

/** render-cut CLI: `render-cut <projectRoot> --out exports/<name>`。 */
export function buildRenderCutArgs(projectRoot: string, outputName: string): string[] {
    return [projectRoot, '--out', buildRenderCutOutputRelativePath(outputName)];
}

export type QuickExportLintOutcome = 'pass' | 'fail' | 'error';

/** edit-lint の exit code: 0 PASS・1 FAIL・2 実行エラー（bin/edit-lint.mjs の契約どおり）。 */
export function determineLintOutcome(exitCode: number | null): QuickExportLintOutcome {
    if (exitCode === 0) {
        return 'pass';
    }
    if (exitCode === 1) {
        return 'fail';
    }
    return 'error';
}

export type QuickExportRenderOutcome = 'success' | 'failure';

/**
 * render-cut の完了判定は exit code だけでなく実ファイルの存在 + サイズも見る
 * （task.md 「exit 0 + 出力ファイル実在（サイズ > 0）で完了表示」）。
 */
export function determineRenderOutcome(
    exitCode: number | null,
    output: { readonly exists: boolean; readonly size: number } | undefined
): QuickExportRenderOutcome {
    if (exitCode !== 0) {
        return 'failure';
    }
    if (!output || !output.exists || output.size <= 0) {
        return 'failure';
    }
    return 'success';
}

/** stderr 全文から末尾 N 行だけを要約として取り出す（空行は除く）。 */
export function summarizeStderrTail(stderr: string, maxLines = 5): string {
    const lines = stderr.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
    return lines.slice(-maxLines).join('\n');
}
