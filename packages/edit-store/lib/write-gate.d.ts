/**
 * edit.json / captions.json の atomic 書き込みと保存後 lint（Node 専用）。
 *
 * 由来: apps/shell の akari-annotations-service.ts / akari-preview-service.ts に
 * 複製されていた assertLintPasses / runEditLint / findEditLintBinPath / writeAtomic を
 * ここへ一本化した（プレビュー・パリティ契約 §2.7「すべての書き込み経路は edit-lint を通す」）。
 * preview-server の PUT ハンドラも同じ共有層を使う。保存前ゲートだった lint は
 * task 2026-08-18-shell-write-path-latency で保存後 debounce lint へ移した。
 *
 * 保存の臨界経路は tmp + rename だけに限定する。edit-lint は保存後 400ms の末尾
 * debounce で同じプロジェクトにつき最新 1 本だけをプロセス内実行する。lint が
 * 利用できない場合は従来どおり fail-open とし、編集不能にはしない。
 *
 * fail-open（オーナー裁定 2026-08-02、初出 2026-07-26 editlint-packaged-resolve）:
 * lint 実行系が見つからない場合は書き込みを全面ブロックせず検証スキップで続行する。
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
/** 候補ファイル名（プロジェクト直下からの相対パス）→ 書き込み予定の全文。null は不在扱い。 */
export type LintCandidates = Record<string, string | null>;
export interface DeferredLintOptions {
    debounceMs?: number;
    onLintResult?: (result: EditLintGateResult) => void | Promise<void>;
}
/**
 * 実ファイルは変更せず、候補全文だけを options.inputOverrides で差し替えて検証する。
 * 既存 export のシグネチャは維持し、preview-server の保存前検査にも使える。
 */
export declare function lintProjectCandidates(projectRoot: string, candidates: LintCandidates): Promise<EditLintGateResult>;
/** 互換 API。保存後 lint への移行後も、明示的に検証したい呼び出し側向けに残す。 */
export declare function assertLintPasses(projectRoot: string, candidates: LintCandidates): Promise<void>;
/** atomic 保存を即時完了し、lint は末尾 debounce で非同期に実行する。 */
export declare function writeProjectFilesGuarded(projectRoot: string, candidates: LintCandidates, options?: DeferredLintOptions): Promise<void>;
/**
 * 同じプロジェクト宛ての連続保存をまとめ、最後の状態だけを lint する。
 * 保存後 lint は実 projectRoot に対して writeReports=true で走るため、結果は
 * `.akari/lint.json` と `.akari/reports/edit-lint-report.html` へ書かれる。
 * これは render-cut が読む PASS ゲートを常に最新に保つ、意図した保存後 lint の副作用。
 */
export declare function scheduleProjectLint(projectRoot: string, options?: DeferredLintOptions): void;
export declare function writeAtomic(destination: string, content: string): Promise<void>;
/**
 * edit-lint をプロセス内実行する。inputOverrides は候補全文のメモリ差し替え。
 * writeReports=false は保存前候補検査用で実プロジェクトへレポートを書かない。
 * 既定の true は保存後 lint 用で、projectRoot の `.akari/lint.json` と HTML レポートを更新する。
 */
export declare function runEditLint(projectRoot: string, inputOverrides?: LintCandidates, writeReports?: boolean): Promise<EditLintGateResult>;
export declare function findEditLintModulePath(): string;
/** 既存の複数候補探索を維持する。 */
export declare function findEditLintBinPath(): string;
