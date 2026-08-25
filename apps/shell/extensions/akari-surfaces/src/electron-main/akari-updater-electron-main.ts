import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, ipcMain } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { parseUpdateCache } from '../common/update-feed';
import {
    FALLBACK_FEED_OPTIONS,
    isAppTranslocationPath,
    resolveAllowPrerelease,
    resolveShellUpdaterErrorReason,
    ShellUpdaterEvent,
    shouldApplyFeedUrlFallback
} from '../common/shell-update-applier';
import { CHANNEL_UPDATER_CHECK, CHANNEL_UPDATER_EVENT, CHANNEL_UPDATER_GET_STATE, CHANNEL_UPDATER_RESTART } from '../electron-common/electron-api';

/** U2 のフロントエンド/CLI と共有するキャッシュファイル名（update-feed.ts の同名定数と同じ値 — 複製の経緯は同ファイル冒頭コメント参照）。 */
const UPDATE_CACHE_FILENAME = 'update-check.json';
const UPDATER_LOG_FILENAME = 'updater.log';

/**
 * 定期再チェック間隔（4 時間）。起動時 1 回だけのチェックだと、アプリを何日も
 * 起動しっぱなしにする使い方（実測でこれが既定の使われ方だった）では新リリースを
 * 永遠に知らないままになるため、長寿命セッションでも新版を拾えるようにする。
 * electron-updater は進行中の checkForUpdates を内部でデデュープするので多重発火は安全。
 */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * electron-updater（U3・内部リポ契約 update-and-versioning §11）の main プロセス配線。
 *
 * 起動時 + CHECK_INTERVAL_MS ごと + レンダラーの「更新する」ボタン（IPC）で
 * `checkForUpdates()` を呼ぶ。`autoDownload = true` で新版があれば
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
        ipcMain.handle(CHANNEL_UPDATER_CHECK, async (): Promise<void> => {
            // 結果はイベント（CHANNEL_UPDATER_EVENT）でレンダラーへ流れるため await しない。
            this.safeCheck();
        });

        try {
            this.configureAndCheck();
        } catch (error) {
            this.recordUpdaterError('electron-updater の初期化に失敗しました', error);
        }
    }

    protected configureAndCheck(): void {
        const appUpdateYmlExists = existsSync(join(process.resourcesPath, 'app-update.yml'));
        if (shouldApplyFeedUrlFallback(app.isPackaged, appUpdateYmlExists)) {
            autoUpdater.setFeedURL(FALLBACK_FEED_OPTIONS);
        }

        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = resolveAllowPrerelease(this.readCachedChannel());

        autoUpdater.on('checking-for-update', () => this.emit({ kind: 'checking-for-update' }));
        autoUpdater.on('update-available', (info: UpdateInfo) => this.emit({ kind: 'update-available', version: info.version }));
        autoUpdater.on('update-not-available', () => this.emit({ kind: 'update-not-available' }));
        autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.emit({ kind: 'update-downloaded', version: info.version }));
        autoUpdater.on('error', (error: Error) => {
            this.recordUpdaterError('electron-updater error', error);
        });

        // 起動をブロックしない: checkForUpdates は非同期・失敗はここで飲み込む
        // （未署名の開発ビルド・オフライン・GitHub API 失敗のいずれもここに落ちる）。
        this.safeCheck();
        setInterval(() => this.safeCheck(), CHECK_INTERVAL_MS);
    }

    protected safeCheck(): void {
        if (isAppTranslocationPath(process.execPath)) {
            this.recordUpdaterError('App Translocation を検知しました', new Error('App Translocation'));
            return;
        }
        autoUpdater.checkForUpdates().catch(error => {
            this.recordUpdaterError('checkForUpdates に失敗しました', error);
        });
    }

    /**
     * Finder 起動のパッケージ版では stderr の永続先を利用者が確認できる保証がないため、
     * console.error と併せて AKARI_HOME/logs/updater.log へ最小の診断行を追記する。
     */
    protected recordUpdaterError(context: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        const reason = resolveShellUpdaterErrorReason(message, process.execPath);
        console.error(`[akari-surfaces] ${context}:`, error);
        this.appendUpdaterLog(context, message);
        this.emit({ kind: 'error', message, reason });
    }

    protected appendUpdaterLog(context: string, message: string): void {
        try {
            const home = process.env.AKARI_HOME || join(homedir(), '.akari');
            const logDirectory = join(home, 'logs');
            mkdirSync(logDirectory, { recursive: true });
            const safeContext = context.replace(/[\r\n]+/g, ' ');
            const safeMessage = message.replace(/[\r\n]+/g, ' ');
            appendFileSync(join(logDirectory, UPDATER_LOG_FILENAME), `${new Date().toISOString()} ${safeContext}: ${safeMessage}\n`, 'utf8');
        } catch (logError) {
            console.error('[akari-surfaces] updater 診断ログの追記に失敗しました:', logError);
        }
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
