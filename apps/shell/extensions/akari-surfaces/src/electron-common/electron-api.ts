import { ShellUpdaterEvent } from '../common/shell-update-applier';

export const CHANNEL_UPDATER_EVENT = 'AkariShellUpdaterEvent';
export const CHANNEL_UPDATER_GET_STATE = 'AkariShellUpdaterGetState';
export const CHANNEL_UPDATER_RESTART = 'AkariShellUpdaterRestartAndInstall';

export type { ShellUpdaterEvent } from '../common/shell-update-applier';

export interface ElectronAkariUpdaterApi {
    /** main プロセスが直近に観測したイベント。ホーム widget が後から生成された場合の初期同期用（無ければ undefined）。 */
    getLastEvent(): Promise<ShellUpdaterEvent | undefined>;
    /** イベント購読。戻り値の関数を呼ぶと解除する。 */
    onEvent(listener: (event: ShellUpdaterEvent) => void): () => void;
    /** 「今すぐ再起動して適用」ボタン: electron-updater の quitAndInstall を main プロセスへ委ねる。 */
    restartAndInstall(): Promise<void>;
}

declare global {
    interface Window {
        /** 未署名の開発ビルド（`theia start`・electron を経由しない起動）では存在しない — 呼び出し側は必ずガードする。 */
        electronAkariUpdater?: ElectronAkariUpdaterApi;
    }
}
