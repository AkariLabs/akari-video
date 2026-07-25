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

export interface QuickExportStatus {
    readonly phase: QuickExportPhase;
    /** 直近の子プロセス出力（stdout+stderr）の末尾。実行中は随時伸びる。 */
    readonly logTail: string;
    /** lint-failed のときだけ、edit-lint の findings 件数。 */
    readonly lintIssueCount?: number;
    /** done のときだけ、プロジェクトルート相対の出力先（例: 'exports/final.mp4'）。 */
    readonly artifactPath?: string;
    readonly artifactSize?: number;
    /** edit-lint / render-cut が書いた HTML レポートが存在すれば、そのプロジェクト相対パス。 */
    readonly reportPath?: string;
    /** failed のときだけ、stderr 末尾の要約数行。 */
    readonly failureSummary?: string;
}

export interface AkariQuickExportService {
    start(request: QuickExportStartRequest): Promise<QuickExportStartOutcome>;
    getStatus(): Promise<QuickExportStatus>;
}
