/**
 * F5「+ 新しい動画を始める」（task 2026-08-03-shell-quickwins-feedback）専用の
 * バックエンドサービス契約。RPC パスは `akari-project` 拡張の既存
 * `/services/akari-project` とは意図的に**別**にしてある。
 *
 * 経緯: 当初は `akari-project` 拡張が公開する既存 `AkariProjectService`
 * （`/services/akari-project`）を、本タスクの所有パス内から独立した 2 本目の
 * プロキシとして再利用しようとした。しかし実機（Electron + CDP）検証で
 * 恒久ハングを発見した — Theia core の `ChannelMultiplexer#open(id)`
 * （`@theia/core/lib/common/message-rpc/channel.js`）は同じ id（= RPC パス
 * 文字列）で二重に channel を開こうとすると同期的に例外を投げるが、
 * `ServiceConnectionProvider#listen()`（`.../browser/messaging/service-connection-provider.js`）
 * はその呼び出しを `.then()` チェーンで受けていて `.catch()` が無いため、例外は
 * 誰にも観測されずに握りつぶされる。`akari-project` 拡張自身が起動時に自分の
 * `AkariProjectService` プロキシを既に生成・channel open 済みのため、**別の
 * 拡張モジュールから同じパスへ**プロキシを作ると、後発側の channel は永久に
 * 確立されず、そのプロキシのメソッド呼び出しは何のエラーも表示せず無限に
 * pending のままになる（`akari-shell-quickwins-feedback` タスク report.md に
 * 実機ログ・再現手順を記録）。
 *
 * そのため本パスは専用の新設パスとし、実処理は `packages/project-scaffold`
 * （pure Node ESM・Theia 非依存の「プロジェクト作成の単一実装」）の
 * `createProject()` をそのまま呼ぶだけで、ロジックは複製しない
 * （`akari-surfaces/src/node/akari-new-project-service.ts` 参照）。
 */

export const AKARI_NEW_PROJECT_SERVICE_PATH = '/services/akari-surfaces-new-project';
export const AkariNewProjectService = Symbol('AkariNewProjectService');

export interface AkariNewProjectService {
    /**
     * 空のフォルダーへプロジェクト雛形を作成する
     * （テンプレコピー + フォールバック補完 + スキル同梱 + git init）。
     * フォルダーに既存ファイルがあると失敗する。
     */
    createProject(destinationUri: string): Promise<void>;
}
