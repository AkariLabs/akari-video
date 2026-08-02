/**
 * edit.json / captions.json の lint ゲート付き書き込み層（Node 専用）。
 *
 * 由来: apps/shell の akari-annotations-service.ts / akari-preview-service.ts に
 * 複製されていた assertLintPasses / runEditLint / findEditLintBinPath / writeAtomic を
 * ここへ一本化した（プレビュー・パリティ契約 §2.7「すべての書き込み経路は edit-lint を通す」）。
 * preview-server の PUT ハンドラも同じゲートを使う。
 *
 * ゲートの作法（CF-write と同一）: 候補全文を実ファイルへは一切書かず、兄弟ファイル
 * （source 動画・captions.json 等）をシンボリックリンクで写した一時ディレクトリに候補だけを
 * 置いて packages/edit-lint/bin/edit-lint.mjs --json を叩く（edit-lint は「呼び出しのみ」— 改変しない）。
 *
 * fail-open（オーナー裁定 2026-08-02、初出 2026-07-26 editlint-packaged-resolve）:
 * lint 実行系（bin）が見つからない場合は書き込みを全面ブロックせず検証スキップで続行する。
 * 編集不能より lint なし保存の方が被害が小さいという判断（型不正は各書き込みの
 * ローカル検証が別途残るため安全側は保たれる）。
 */
export interface EditLintFinding {
    severity?: string;
    message?: string;
    check?: string;
    path?: string;
}
export interface EditLintGateResult {
    pass: boolean;
    errors: string[];
    findings: EditLintFinding[];
}
/** 候補ファイル名（プロジェクト直下の basename）→ 書き込み予定の全文。 */
export type LintCandidates = Record<string, string>;
/**
 * プロジェクト直下の候補ファイル群（edit.json / captions.json）を、実ファイルへ書く前に
 * edit-lint へかける。複数候補（edit.json + captions.json の同時書き換え）は同じ一時
 * ディレクトリに置いて 1 回で整合検証する。
 */
export declare function lintProjectCandidates(projectRoot: string, candidates: LintCandidates): Promise<EditLintGateResult>;
/** lint に落ちたら書き込まずに例外を投げる（呼び出し側の catch で UI が巻き戻る）。 */
export declare function assertLintPasses(projectRoot: string, candidates: LintCandidates): Promise<void>;
/** lint ゲート → atomic 書き込み（tmp + rename）を一括で行う唯一の正規経路。 */
export declare function writeProjectFilesGuarded(projectRoot: string, candidates: LintCandidates): Promise<void>;
export declare function writeAtomic(destination: string, content: string): Promise<void>;
export declare function runEditLint(projectRoot: string): Promise<EditLintGateResult>;
export declare function findEditLintBinPath(): string;
