import { ShellUpdaterEvent } from '../common/shell-update-applier';

export const CHANNEL_UPDATER_EVENT = 'AkariShellUpdaterEvent';
export const CHANNEL_UPDATER_GET_STATE = 'AkariShellUpdaterGetState';
export const CHANNEL_UPDATER_RESTART = 'AkariShellUpdaterRestartAndInstall';
export const CHANNEL_UPDATER_CHECK = 'AkariShellUpdaterCheckNow';
export const UPDATER_CANCEL_REQUEST_FILENAME = 'updater-cancel-request.json';

/** Ignore stale or mismatched requests from another download session. */
export function isUpdaterCancelRequest(raw: string, version: string, startedAt: number, now: number): boolean {
    try {
        const value = JSON.parse(raw) as { version?: unknown; time?: unknown };
        return value.version === version && typeof value.time === 'number' && Number.isFinite(value.time)
            && value.time >= startedAt && value.time <= now + 5000;
    } catch { return false; }
}

/** electron-updater 6.8.9 creates these names in cacheDir/pending. */
export function isUpdaterTemporaryFileName(name: string): boolean {
    return /^(?:\d+-)?temp-[^/\\]+$/.test(name);
}

interface TrackedUpdaterResponse {
    on(event: 'end' | 'error' | 'aborted' | 'close', listener: () => void): unknown;
}

interface TrackedUpdaterRequest {
    on(event: 'abort' | 'error', listener: () => void): unknown;
    on(event: 'response', listener: (response: TrackedUpdaterResponse) => void): unknown;
    abort(): void;
}

/** Tracks updater requests until the response finishes or fails; request close can precede the response body. */
export class UpdaterRequestTracker {
    private readonly requests = new Set<TrackedUpdaterRequest>();

    track<T>(candidate: T): T {
        if (!candidate || typeof (candidate as TrackedUpdaterRequest).on !== 'function'
            || typeof (candidate as TrackedUpdaterRequest).abort !== 'function') { return candidate; }
        const request = candidate as TrackedUpdaterRequest;
        this.requests.add(request);
        const forget = (): void => { this.requests.delete(request); };
        for (const event of ['abort', 'error'] as const) { request.on(event, forget); }
        request.on('response', response => {
            if (!response || typeof response.on !== 'function') { return; }
            for (const event of ['end', 'error', 'aborted', 'close'] as const) { response.on(event, forget); }
        });
        return candidate;
    }

    abortAll(): unknown[] {
        const errors: unknown[] = [];
        for (const request of [...this.requests]) {
            this.requests.delete(request);
            try { request.abort(); } catch (error) { errors.push(error); }
        }
        return errors;
    }

    get size(): number { return this.requests.size; }
}

export type { ShellUpdaterEvent } from '../common/shell-update-applier';

export interface ElectronAkariUpdaterApi {
    /** main プロセスが直近に観測したイベント。ホーム widget が後から生成された場合の初期同期用（無ければ undefined）。 */
    getLastEvent(): Promise<ShellUpdaterEvent | undefined>;
    /** イベント購読。戻り値の関数を呼ぶと解除する。 */
    onEvent(listener: (event: ShellUpdaterEvent) => void): () => void;
    /** 「今すぐ再起動して適用」ボタン: electron-updater の quitAndInstall を main プロセスへ委ねる。 */
    restartAndInstall(): Promise<void>;
    /** 「更新する」ボタン: electron-updater のチェック（→ autoDownload で自動 DL）を即時発火する。結果はイベント購読側に流れる。 */
    checkForUpdatesNow(): Promise<void>;
}

declare global {
    interface Window {
        /** 未署名の開発ビルド（`theia start`・electron を経由しない起動）では存在しない — 呼び出し側は必ずガードする。 */
        electronAkariUpdater?: ElectronAkariUpdaterApi;
        akariNativeDark?: boolean;
        akariPermissions?: { microphone: string };
        electronTheiaCore?: { setTheme(theme: 'dark' | 'light' | 'system'): void; setZoomLevel(level: number): void };
    }
}
