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
    /** `update-available` 受信〜DL 完了まで true（「ダウンロード中」バナー）。 */
    downloading?: boolean;
    downloadingVersion?: string;
    /** 直近の check/DL が error で終わった印。「更新する」ボタンをブラウザ手動 DL へ縮退させる。 */
    failed?: boolean;
}

export const INITIAL_SHELL_UPDATER_UI_STATE: ShellUpdaterUiState = { downloaded: false };

/**
 * イベント → 次のバナー状態（同期・純粋関数）。
 *
 * - `update-available`（version 付き）: 自動 DL が始まった合図なので「ダウンロード中」
 *   バナーへ（DL 済みなら既存バナーを維持）。かつては U2 バナーとの二重表示を避けて
 *   沈黙していたが、「更新する」ボタンが electron-updater 直結になった（適用まで
 *   アプリ内で完結する）ため、進行が見えないほうが不安になる — 表示に切り替えた
 * - `update-downloaded`（version 付き）: 「DL 済み・再起動で適用」バナーへ
 * - `error`: 例外をユーザーに露出しない（契約 §11 の沈黙原則）。DL 済みならそのまま、
 *   そうでなければ `failed` を立てて「更新する」を手動 DL へ縮退させるだけ
 * - `update-not-available` / `checking-for-update`: DL 中表示だけ畳み、他は変えない
 */
export function applyShellUpdaterEvent(state: ShellUpdaterUiState, event: ShellUpdaterEvent): ShellUpdaterUiState {
    if (event.kind === 'update-downloaded' && typeof event.version === 'string' && event.version.length > 0) {
        return { downloaded: true, downloadedVersion: event.version };
    }
    if (state.downloaded) {
        return state;
    }
    if (event.kind === 'update-available' && typeof event.version === 'string' && event.version.length > 0) {
        return { downloaded: false, downloading: true, downloadingVersion: event.version };
    }
    if (event.kind === 'error') {
        return { downloaded: false, failed: true };
    }
    if (event.kind === 'update-not-available' && state.downloading) {
        return { downloaded: false };
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

/** 「ダウンロード中」バナー本文。DL 中でなければ空文字（バナー非表示の合図）。 */
export function formatDownloadingBannerText(state: ShellUpdaterUiState): string {
    if (state.downloaded || !state.downloading || !state.downloadingVersion) {
        return '';
    }
    return `AKARI Video v${state.downloadingVersion} をダウンロードしています。完了すると再起動ボタンが表示されます。`;
}
