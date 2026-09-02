/**
 * 「この場で書き出す」バックエンド（akari-shell-strip 所有・node 側で
 * edit-lint / render-cut CLI を子プロセス実行する）の JSON-RPC 契約。
 * フロントエンドは `start` を呼んで即座に返り値を受け取り（fire-and-forget）、
 * 実行中は `getStatus` を短い間隔でポーリングして進捗テキスト・不確定バーを
 * 更新する（task.md 「自前の進捗テキスト + 不確定バーで可」）。
 */

import { QuickExportStage } from './quick-export-progress';

export const AKARI_QUICK_EXPORT_SERVICE_PATH = '/services/akari-quick-export';
export const AkariQuickExportService = Symbol('AkariQuickExportService');

export interface QuickExportStartRequest {
    readonly projectRootUri: string;
    readonly outputName: string;
    readonly rerunLint: boolean;
    /** 既定（'standard'）なら render-cut に --quality を渡さない。 */
    readonly quality?: 'master' | 'high' | 'standard' | 'light';
    /** 未指定でも render-cut に --engine auto を明示送信する。 */
    readonly engine?: 'auto' | 'gpu' | 'osr';
    /** 未指定でも render-cut に --encoder auto を明示送信する。 */
    readonly encoder?: 'auto' | 'videotoolbox' | 'nvenc' | 'qsv' | 'amf' | 'mf' | 'x264';
    /** 書き出し映像コーデック。未指定なら h264。 */
    readonly codec?: 'h264' | 'hevc';
    /** 未指定（そのまま）なら render-cut に --fps を渡さない。 */
    readonly fps?: number;
    /** 未指定なら edit.json の画素数を維持する。 */
    readonly scaleTo?: { readonly width: number; readonly height: number };
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
    | 'cancelled'
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
    /** render-cut が現在実行している工程。 */
    readonly progressStage?: QuickExportStage;
    /** render 工程で処理済みのコマ数。 */
    readonly progressFrame?: number;
    /** render 工程の総コマ数。 */
    readonly progressTotalFrames?: number;
    /** render 工程を実行しているエンジン。 */
    readonly progressEngine?: 'gpu' | 'osr';
    /** GPU 直結の書き出しが最後に書いた実フレーム JPEG のコマ番号。 */
    readonly progressPreviewFrame?: number;
    /** 同 JPEG の絶対パス（プロジェクト内 .akari/cache/export-preview 配下）。 */
    readonly progressPreviewPath?: string;
    readonly progressElapsedMs?: number;
    readonly progressRemainingMs?: number;
}

export interface AkariQuickExportService {
    start(request: QuickExportStartRequest): Promise<QuickExportStartOutcome>;
    getStatus(): Promise<QuickExportStatus>;
    cancel(): Promise<{ cancelled: boolean }>;
    revealArtifact(): Promise<{ revealed: boolean }>;
    copyArtifact(): Promise<{ copied: boolean; reason?: string }>;
    /**
     * 書き出し中の実フレーム JPEG を data URL にして返す。
     * プロジェクト内 `.akari/cache/export-preview/` 配下のパスだけを許し、
     * それ以外・読めない場合は undefined を返す（任意パス読み出しを受けない）。
     */
    readPreviewFrame(path: string): Promise<string | undefined>;
}
