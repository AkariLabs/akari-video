/**
 * 「この場で書き出す」バックエンド（akari-shell-strip 所有・node 側で
 * edit-lint / render-cut CLI を子プロセス実行する）の JSON-RPC 契約。
 * フロントエンドは `start` を呼んで即座に返り値を受け取り（fire-and-forget）、
 * 実行中は `getStatus` を短い間隔でポーリングして進捗テキスト・不確定バーを
 * 更新する（task.md 「自前の進捗テキスト + 不確定バーで可」）。
 */

export const AKARI_QUICK_EXPORT_SERVICE_PATH = '/services/akari-quick-export';
export const AkariQuickExportService = Symbol('AkariQuickExportService');

export interface QuickExportStartRequest {
    readonly projectRootUri: string;
    readonly outputName: string;
    readonly rerunLint: boolean;
    /** 既定（'standard'）なら render-cut に --quality を渡さない。 */
    readonly quality?: 'high' | 'standard' | 'light';
    /** 既定（'auto'）なら render-cut に --encoder を渡さない。 */
    readonly encoder?: 'auto' | 'videotoolbox' | 'x264';
    /** 未指定（そのまま）なら render-cut に --fps を渡さない。 */
    readonly fps?: number;
    /** フォルダ選択ダイアログで得た絶対パスの URI 文字列。未指定なら既定の exports/ を使う。 */
    readonly outputDirectoryUri?: string;
}

export type QuickExportStartOutcome =
    | { readonly accepted: true }
    | { readonly accepted: false; readonly reason: 'already-running' };

export type QuickExportPhase =
    | 'idle'
    | 'linting'
    | 'lint-failed'
    | 'rendering'
    | 'done'
    | 'failed';

export interface QuickExportLintFinding {
    readonly check?: string;
    readonly severity?: string;
    readonly message?: string;
}

export interface QuickExportStatus {
    readonly phase: QuickExportPhase;
    /** 直近の子プロセス出力（stdout+stderr）の末尾。実行中は随時伸びる。 */
    readonly logTail: string;
    /** lint-failed のときだけ、edit-lint の findings 件数。 */
    readonly lintIssueCount?: number;
    /** lint-failed のときだけ、findings の severity 別件数。 */
    readonly lintErrorCount?: number;
    readonly lintWarningCount?: number;
    /** lint-failed のときだけ、日本語要約と英語詳細の組み立てに使う findings。 */
    readonly lintFindings?: readonly QuickExportLintFinding[];
    /** done のときだけ、プロジェクトルート相対の出力先（例: 'exports/final.mp4'）。 */
    readonly artifactPath?: string;
    readonly artifactSize?: number;
    /** edit-lint / render-cut が書いた HTML レポートが存在すれば、そのプロジェクト相対パス。 */
    readonly reportPath?: string;
    /** failed のときだけ、stderr 末尾の要約数行。 */
    readonly failureSummary?: string;
    /**
     * render-cut の `--progress` 出力（PROGRESS out_time_ms=.../done）由来の詳細進捗
     * （task 2026-07-25-export-options）。phase が 'rendering' の間だけ随時更新される。
     * まだ 1 行も届いていない、または % の分母が無く残り時間を外挿できないうちは undefined。
     */
    readonly progressPercent?: number;
    readonly progressElapsedMs?: number;
    readonly progressRemainingMs?: number;
}

export interface AkariQuickExportService {
    start(request: QuickExportStartRequest): Promise<QuickExportStartOutcome>;
    getStatus(): Promise<QuickExportStatus>;
}
