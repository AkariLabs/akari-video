/**
 * electron-updater（U3・main プロセス。内部リポ契約 update-and-versioning §11）の
 * イベントから、ホームバナーの「DL 済み・再起動で適用されます」状態を導く純粋関数群。
 *
 * `update-feed.ts`（U2・D5 裁定）とは別の仕組み: あちらはリモートフィード
 * （latest.json）とローカル版を比較して「新版があります」を判定する（DL 前のバナーの
 * SSOT）のに対し、こちらは実際に electron-updater が main プロセスで動かした DL の
 * 進行（IPC イベント）だけを見る。DL 前は U2 のバナーがそのまま出る（本ファイルは
 * 関与しない）→ DL 完了で初めて本ファイルの状態が「再起動して適用」ボタン付き
 * バナーへ切り替える（task.md §3-4 指定の 2 段階）。
 */

export type ShellUpdaterEventKind =
    | 'checking-for-update'
    | 'update-available'
    | 'update-not-available'
    | 'update-downloaded'
    | 'error';

export interface ShellUpdaterEvent {
    kind: ShellUpdaterEventKind;
    version?: string;
    message?: string;
}

export interface ShellUpdaterUiState {
    /** electron-updater が新版を DL 済みで、再起動すれば適用できる状態か。 */
    downloaded: boolean;
    downloadedVersion?: string;
}

export const INITIAL_SHELL_UPDATER_UI_STATE: ShellUpdaterUiState = { downloaded: false };

/**
 * イベント → 次のバナー状態（同期・純粋関数）。`update-downloaded`（version 付き）だけが
 * 状態を変える。`error` / `update-not-available` / `checking-for-update` / `update-available`
 * は既存状態をそのまま返し沈黙する（契約 §11「エラー/オフラインで例外がユーザーに
 * 露出しない（沈黙 + 既存バナー縮退）」— `update-available` の「新版があります」表示は
 * U2 のリモートフィード比較バナーが既に担っているため、ここで別の表示を足さない）。
 */
export function applyShellUpdaterEvent(state: ShellUpdaterUiState, event: ShellUpdaterEvent): ShellUpdaterUiState {
    if (event.kind === 'update-downloaded' && typeof event.version === 'string' && event.version.length > 0) {
        return { downloaded: true, downloadedVersion: event.version };
    }
    return state;
}

/**
 * channel が `'stable'` でなければ prerelease を追従する
 * （契約 §11「channel = prerelease の間は allowPrerelease = true」）。
 * channel が読めない（未フェッチ・壊れたキャッシュ）場合もフェイルセーフ側 = true
 * （現状 2026-08 時点は全リリースが prerelease — 契約 §7）。
 */
export function resolveAllowPrerelease(channel: string | null | undefined): boolean {
    return channel !== 'stable';
}

/** 「DL 済み・再起動で適用されます」バナー本文（task.md §4 指示の状態）。DL 済みでなければ空文字（バナー非表示の合図 — formatHomeBannerText と同じ流儀）。 */
export function formatDownloadedBannerText(state: ShellUpdaterUiState): string {
    if (!state.downloaded || !state.downloadedVersion) {
        return '';
    }
    return `AKARI Video v${state.downloadedVersion} をダウンロード済みです。再起動すると適用されます。`;
}
