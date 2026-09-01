import { summarizeStderrTail } from './quick-export-cli';

/**
 * preview-server（packages/preview-server/src/server.mjs）起動まわりの純関数群。
 * fs / net / child_process に触らないので単体テストの対象
 * （test/preview-server-cli.test.mjs）。副作用のある実行は
 * node/akari-preview-server-service.ts が担う。
 */

/** `akari.sh --preview` の既定 4567 に揃える。 */
export const PREVIEW_SERVER_DEFAULT_PORT = 4567;
/** 4567 から順に試すポート数（4567〜4576）。 */
export const PREVIEW_SERVER_PORT_ATTEMPTS = 10;
export const PREVIEW_SERVER_HOST = '127.0.0.1';
/** stdout に URL 行が現れるまで待つ上限。 */
export const PREVIEW_SERVER_READY_TIMEOUT_MS = 10_000;
/** server.mjs のパッケージ相対パス（bin/ ではなく src/ に入口がある）。 */
export const PREVIEW_SERVER_ENTRY_RELATIVE_PATH = 'src/server.mjs';

export type PreviewOpenVariant = 'latest' | 'legacy';

/** server.mjs の引数列（--no-lint は付けない — PUT の lint ゲートは WebUI の既定どおり）。 */
export function buildPreviewServerArgs(projectRoot: string, port: number): string[] {
    return [projectRoot, '--port', String(port), '--host', PREVIEW_SERVER_HOST];
}

/**
 * 起動完了判定: stdout に最初に現れた `http://127.0.0.1:<port>`（末尾スラッシュ無し）。
 * server.mjs は listen 完了時に「  http://127.0.0.1:<port>」を含む 4 行を出す。
 */
export function parsePreviewServerReadyUrl(text: string): string | undefined {
    const match = /http:\/\/127\.0\.0\.1:\d+/.exec(text);
    return match ? match[0] : undefined;
}

/** 最新版（frame-engine・既定）と従来版（?frameEngine=0）の開く URL。 */
export function buildPreviewOpenUrl(baseUrl: string, variant: PreviewOpenVariant): string {
    const base = baseUrl.replace(/\/+$/, '');
    return variant === 'legacy' ? `${base}/?frameEngine=0` : `${base}/`;
}

/**
 * 子プロセスが起動完了前に終了した / running 中に落ちたときの日本語要約。
 * server.mjs は EADDRINUSE を捕捉しない（例外で exit 1・stderr に EADDRINUSE）
 * ため stderr の文字列で判定する。
 */
export function describePreviewServerFailure(exitCode: number | null, stderr: string, port: number): string {
    if (stderr.includes('EADDRINUSE')) {
        return `ポート ${port} は別のプロセスが使用中です`;
    }
    const summary = summarizeStderrTail(stderr);
    if (summary) {
        return summary;
    }
    return `exit code ${exitCode ?? '不明'} で終了しました（エラー出力はありません）`;
}
