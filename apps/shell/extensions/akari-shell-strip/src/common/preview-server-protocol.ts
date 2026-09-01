/**
 * メニュー「ひらく → ブラウザプレビュー」のバックエンド（akari-shell-strip 所有・
 * node 側で packages/preview-server の server.mjs を子プロセス実行する）の
 * JSON-RPC 契約。フロントエンドは `start` を呼んで running / failed まで待ち、
 * 実行中（starting / running）は `getStatus` を 1 秒間隔でポーリングして
 * 予期しない終了（failed）を反映する（quick-export-protocol.ts と同じ流儀）。
 */

export const AKARI_PREVIEW_SERVER_SERVICE_PATH = '/services/akari-preview-server';
export const AkariPreviewServerService = Symbol('AkariPreviewServerService');

export type PreviewServerPhase = 'idle' | 'starting' | 'running' | 'failed';

export interface PreviewServerStatus {
    readonly phase: PreviewServerPhase;
    readonly projectRootUri?: string;
    /** running のときだけ。例 'http://127.0.0.1:4567'（末尾スラッシュ無し）。 */
    readonly url?: string;
    readonly port?: number;
    readonly pid?: number;
    /** 子プロセス stdout+stderr の末尾（4,000 文字上限・quick-export と同じ）。 */
    readonly logTail: string;
    /** failed のときだけ・日本語 1〜数行。 */
    readonly failureSummary?: string;
}

export interface PreviewServerStartRequest {
    readonly projectRootUri: string;
}

export interface AkariPreviewServerService {
    /** running / failed まで待って返す。 */
    start(request: PreviewServerStartRequest): Promise<PreviewServerStatus>;
    getStatus(): Promise<PreviewServerStatus>;
    /** idle になってから返す。 */
    stop(): Promise<PreviewServerStatus>;
}
