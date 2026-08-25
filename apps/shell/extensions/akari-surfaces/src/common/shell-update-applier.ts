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

import { compareVersions } from './update-feed';

export type ShellUpdaterEventKind =
    | 'checking-for-update'
    | 'update-available'
    | 'update-not-available'
    | 'update-downloaded'
    | 'error';

export interface ShellUpdaterEvent {
    kind: ShellUpdaterEventKind;
    version?: string;
    /** updater の失敗理由。既存の message 消費側を保ったまま UI 向けに additive に運ぶ。 */
    reason?: string;
    /** 既存 IPC ペイロードとの互換用の生エラーメッセージ。 */
    message?: string;
}

export interface ShellUpdaterUiState {
    /** electron-updater が新版を DL 済みで、再起動すれば適用できる状態か。 */
    downloaded: boolean;
    downloadedVersion?: string;
    /** `update-available` 受信〜DL 完了まで true（「ダウンロード中」バナー）。 */
    downloading?: boolean;
    downloadingVersion?: string;
    /** 直近の check/DL が error で終わった印。次のボタン押下では再チェックを妨げない。 */
    failed?: boolean;
    /** 直近の失敗理由。バックグラウンド失敗では保持だけして画面には出さない。 */
    failureReason?: string;
    /** 明示クリックから始まったチェックが進行中か。 */
    checkRequestedByUser?: boolean;
    /** 明示クリックの失敗でブラウザへ縮退したときだけ表示する理由。 */
    fallbackReason?: string;
}

export const INITIAL_SHELL_UPDATER_UI_STATE: ShellUpdaterUiState = { downloaded: false };

/**
 * イベント → 次のバナー状態（同期・純粋関数）。
 *
 * - `update-available`（version 付き）: 自動 DL が始まった合図なので「ダウンロード中」
 *   バナーへ。DL 済みでも、その版より新しければ staged を追い越して DL 中へ戻る。
 *   かつては U2 バナーとの二重表示を避けて
 *   沈黙していたが、「更新する」ボタンが electron-updater 直結になった（適用まで
 *   アプリ内で完結する）ため、進行が見えないほうが不安になる — 表示に切り替えた
 * - `update-downloaded`（version 付き）: 「DL 済み・再起動で適用」バナーへ
 * - `error`: DL 済みならそのまま。それ以外は理由を保持し、明示クリック起点のときだけ
 *   ブラウザ縮退理由も立てる（バックグラウンド失敗は表示しない）
 * - `checking-for-update`: DL 進行状態を維持したまま、過去の失敗系フィールドだけ解除する
 * - `update-not-available`: 一過性の失敗・進行表示を畳む
 */
export function applyShellUpdaterEvent(state: ShellUpdaterUiState, event: ShellUpdaterEvent): ShellUpdaterUiState {
    if (event.kind === 'update-downloaded' && typeof event.version === 'string' && event.version.length > 0) {
        const stagedVersion = state.downloadingVersion ?? state.downloadedVersion;
        if (stagedVersion && compareVersions(event.version, stagedVersion) < 0) {
            return state;
        }
        return { downloaded: true, downloadedVersion: event.version };
    }
    if (state.downloaded) {
        if (
            event.kind === 'update-available'
            && typeof event.version === 'string'
            && event.version.length > 0
            && typeof state.downloadedVersion === 'string'
            && compareVersions(event.version, state.downloadedVersion) > 0
        ) {
            return { downloaded: false, downloading: true, downloadingVersion: event.version };
        }
        return state;
    }
    if (event.kind === 'update-available' && typeof event.version === 'string' && event.version.length > 0) {
        return { downloaded: false, downloading: true, downloadingVersion: event.version };
    }
    if (event.kind === 'error') {
        const failureReason = normalizeUpdaterReason(event.reason ?? event.message);
        return {
            downloaded: false,
            failed: true,
            failureReason,
            fallbackReason: state.checkRequestedByUser ? failureReason : state.fallbackReason
        };
    }
    if (event.kind === 'checking-for-update') {
        const next = { ...state };
        delete next.failed;
        delete next.failureReason;
        delete next.fallbackReason;
        return next;
    }
    if (event.kind === 'update-not-available') {
        return { downloaded: false };
    }
    return state;
}

export type UpdateButtonAction = 'check' | 'browser-fallback' | 'none';

/**
 * 「更新する」の分岐。failed は再チェックを阻害せず、API がある限り必ず先に再試行する。
 */
export function resolveUpdateButtonAction(state: ShellUpdaterUiState, updaterApiAvailable: boolean): UpdateButtonAction {
    if (state.downloaded) {
        return 'none';
    }
    return updaterApiAvailable ? 'check' : 'browser-fallback';
}

/** 明示クリックによる再チェック開始。過去の失敗・縮退表示を消して pending を立てる。 */
export function beginUserInitiatedUpdaterCheck(state: ShellUpdaterUiState): ShellUpdaterUiState {
    if (state.downloaded) {
        return state;
    }
    return { downloaded: false, checkRequestedByUser: true };
}

/** ホーム表示時の再チェック。DL 済み状態を含め UI 状態では抑止せず、失敗は沈黙する。 */
export function checkForShellUpdatesOnHomeShow(
    api: Pick<{ checkForUpdatesNow(): Promise<void> }, 'checkForUpdatesNow'> | undefined
): void {
    if (!api) {
        return;
    }
    void api.checkForUpdatesNow().catch(() => {
        // バックグラウンドチェックの失敗は画面に出さない（契約 §11）。
    });
}

/** API 不在など、チェックを開始できない場合の明示クリック起点の縮退状態。 */
export function applyImmediateUpdaterFallback(state: ShellUpdaterUiState, reason: string): ShellUpdaterUiState {
    if (state.downloaded) {
        return state;
    }
    const normalizedReason = normalizeUpdaterReason(reason);
    return {
        downloaded: false,
        failed: true,
        failureReason: normalizedReason,
        fallbackReason: normalizedReason
    };
}

/** error が明示クリックから始まったものかを副作用前に判定する。 */
export function shouldOpenUpdaterBrowserFallback(state: ShellUpdaterUiState, event: ShellUpdaterEvent): boolean {
    return event.kind === 'error' && state.checkRequestedByUser === true && !state.downloaded;
}

/** 明示クリック起点の縮退時だけ出す 1 行。バックグラウンド失敗では空文字。 */
export function formatUpdaterFallbackText(state: ShellUpdaterUiState): string {
    if (!state.fallbackReason) {
        return '';
    }
    return `アプリ内更新が使えないため、ブラウザでダウンロードページを開きます（理由: ${state.fallbackReason}）`;
}

const APP_TRANSLOCATION_REASON = 'アプリを Applications フォルダへ移動してから再起動してください';
const OFFLINE_UPDATE_REASON = 'オフラインのため確認できませんでした。ネットワーク接続後にもう一度押すか、アプリを再起動してください';

/** macOS App Translocation の実行パスを、OS API に依存せず判定する純粋関数。 */
export function isAppTranslocationPath(executablePath: string | null | undefined): boolean {
    return typeof executablePath === 'string' && /(?:^|[\\/])AppTranslocation(?:[\\/]|$)/.test(executablePath);
}

/** main プロセスが IPC に載せるユーザー向け理由を決める純粋関数。 */
export function resolveShellUpdaterErrorReason(
    message: string | null | undefined,
    executablePath: string | null | undefined
): string {
    if (isAppTranslocationPath(executablePath)) {
        return APP_TRANSLOCATION_REASON;
    }
    const normalized = normalizeUpdaterReason(message);
    if (/(?:offline|network|internet|ENOTFOUND|EAI_AGAIN|ECONN(?:REFUSED|RESET)|ETIMEDOUT|ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|CONNECTION_TIMED_OUT))/i.test(normalized)) {
        return OFFLINE_UPDATE_REASON;
    }
    return normalized;
}

function normalizeUpdaterReason(reason: string | null | undefined): string {
    const normalized = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim() : '';
    return normalized || '原因を確認できませんでした';
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
