import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { BrowserWindow, ipcMain } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { parseUpdateCache } from '../common/update-feed';
import { resolveAllowPrerelease, ShellUpdaterEvent } from '../common/shell-update-applier';
import { CHANNEL_UPDATER_EVENT, CHANNEL_UPDATER_GET_STATE, CHANNEL_UPDATER_RESTART } from '../electron-common/electron-api';

/** U2 のフロントエンド/CLI と共有するキャッシュファイル名（update-feed.ts の同名定数と同じ値 — 複製の経緯は同ファイル冒頭コメント参照）。 */
const UPDATE_CACHE_FILENAME = 'update-check.json';

/**
 * electron-updater（U3・内部リポ契約 update-and-versioning §11）の main プロセス配線。
 *
 * 起動時に 1 回だけ `checkForUpdates()` を呼ぶ。`autoDownload = true` で新版があれば
 * 裏で DL、`autoInstallOnAppQuit = true` で適用は「アプリを終了するとき」に限る
 * （作業中の強制再起動・モーダルでの中断はしない — 契約の適用規律どおり）。
 * channel = prerelease の間は `allowPrerelease = true` で追従する（§11）。
 *
 * オフライン・fetch 失敗・未署名の開発ビルド（`app.isPackaged === false` で
 * electron-updater 自体が投げる `dev-app-update.yml` 不在エラー等）はすべて例外を
 * 握りつぶして沈黙する — 契約の「現行動作（U2 のホームバナー + 手動 DL 誘導）を
 * 壊さない」を main プロセス側で担保する。
 */
@injectable()
export class AkariUpdaterElectronMain implements ElectronMainApplicationContribution {
    protected lastEvent: ShellUpdaterEvent | undefined;

    onStart(_application: ElectronMainApplication): void {
        ipcMain.handle(CHANNEL_UPDATER_GET_STATE, async (): Promise<ShellUpdaterEvent | undefined> => this.lastEvent);
        ipcMain.handle(CHANNEL_UPDATER_RESTART, async (): Promise<void> => {
            // quitAndInstall はアプリを終了させる副作用を持つため await しない（呼び出し元の
            // IPC ハンドラを待たせても意味がなく、終了自体が「結果」になる）。
            autoUpdater.quitAndInstall();
        });

        try {
            this.configureAndCheck();
        } catch (error) {
            console.error('[akari-surfaces] electron-updater の初期化に失敗しました（沈黙して既存の U2 手動 DL 誘導へ縮退します）:', error);
        }
    }

    protected configureAndCheck(): void {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = resolveAllowPrerelease(this.readCachedChannel());

        autoUpdater.on('checking-for-update', () => this.emit({ kind: 'checking-for-update' }));
        autoUpdater.on('update-available', (info: UpdateInfo) => this.emit({ kind: 'update-available', version: info.version }));
        autoUpdater.on('update-not-available', () => this.emit({ kind: 'update-not-available' }));
        autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.emit({ kind: 'update-downloaded', version: info.version }));
        autoUpdater.on('error', (error: Error) => {
            // 沈黙原則: ログにのみ残し、ユーザーには例外を露出しない。
            console.error('[akari-surfaces] electron-updater error（沈黙）:', error);
            this.emit({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        });

        // 起動をブロックしない: checkForUpdates は非同期・失敗はここで飲み込む
        // （未署名の開発ビルド・オフライン・GitHub API 失敗のいずれもここに落ちる）。
        autoUpdater.checkForUpdates().catch(error => {
            console.error('[akari-surfaces] checkForUpdates に失敗しました（沈黙して継続します）:', error);
        });
    }

    /**
     * `~/.akari/update-check.json`（U2・フロントエンド/CLI と共有するキャッシュ。
     * `AKARI_HOME` で差し替え可 — akari-home-widget.tsx の resolveAkariHomeUri と
     * 同じ規約）の `feed.channel` を読む。無い・壊れている・未フェッチはすべて
     * undefined（`resolveAllowPrerelease` がフェイルセーフ側 = prerelease 追従に倒す）。
     * このファイルへの書き込みは行わない（読み取り専用 — 書き手は U2 のフロントエンド
     * バックグラウンド fetch のみ）。
     */
    protected readCachedChannel(): string | undefined {
        try {
            const home = process.env.AKARI_HOME || join(homedir(), '.akari');
            const raw = readFileSync(join(home, UPDATE_CACHE_FILENAME), 'utf8');
            const cache = parseUpdateCache(raw);
            const channel = cache?.feed?.channel;
            return typeof channel === 'string' ? channel : undefined;
        } catch {
            return undefined;
        }
    }

    protected emit(event: ShellUpdaterEvent): void {
        this.lastEvent = event;
        for (const browserWindow of BrowserWindow.getAllWindows()) {
            if (!browserWindow.isDestroyed()) {
                browserWindow.webContents.send(CHANNEL_UPDATER_EVENT, event);
            }
        }
    }
}
