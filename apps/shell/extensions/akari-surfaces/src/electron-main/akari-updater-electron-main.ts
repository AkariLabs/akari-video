import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, ipcMain } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { autoUpdater, UpdateCheckResult, UpdateInfo } from 'electron-updater';
import { compareVersions } from '../common/update-feed';
import {
    buildFallbackAppUpdateYml,
    FALLBACK_APP_UPDATE_YML_FILENAME,
    FALLBACK_FEED_OPTIONS,
    isAppTranslocationPath,
    resolveUpdaterCheckChannel,
    resolveUpdateChannel,
    resolveShellUpdaterErrorReason,
    resolveManualUpdaterCheckEvent,
    resolveUpdateUiEnabled,
    ShellUpdaterEvent,
    shouldApplyFeedUrlFallback
} from '../common/shell-update-applier';
import { CHANNEL_UPDATER_CHECK, CHANNEL_UPDATER_EVENT, CHANNEL_UPDATER_GET_STATE, CHANNEL_UPDATER_GET_CAPABILITIES, CHANNEL_UPDATER_RESTART,
    isUpdaterCancelRequest, isUpdaterTemporaryFileName, UPDATER_CANCEL_REQUEST_FILENAME, UpdaterRequestTracker } from '../electron-common/electron-api';

/** U2 のフロントエンド/CLI と共有するキャッシュファイル名（update-feed.ts の同名定数と同じ値 — 複製の経緯は同ファイル冒頭コメント参照）。 */
const UPDATER_LOG_FILENAME = 'updater.log';
const TEST_UPDATE_CONFIG_FILENAME = 'akari-updater-l1.yml';

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
    protected downloadedVersion: string | undefined;
    protected activeDownload: { version: string; timer: ReturnType<typeof setInterval>; startedAt: number; result: UpdateCheckResult; cancelling: boolean } | undefined;
    protected readonly updaterRequests = new UpdaterRequestTracker();
    protected requestTrackingInstalled = false;

    onStart(_application: ElectronMainApplication): void {
        ipcMain.handle(CHANNEL_UPDATER_GET_CAPABILITIES, async () => ({
            isPackaged: app.isPackaged,
            updateUiEnabled: resolveUpdateUiEnabled({
                isPackaged: app.isPackaged,
                feedUrlOverridden: !!process.env.AKARI_UPDATE_FEED_URL,
                testFeedUrlSet: !!process.env.AKARI_UPDATER_TEST_FEED_URL
            })
        }));
        ipcMain.handle(CHANNEL_UPDATER_GET_STATE, async (): Promise<ShellUpdaterEvent | undefined> =>
            resolveManualUpdaterCheckEvent(true, this.activeDownload?.version, this.downloadedVersion) ?? this.lastEvent);
        ipcMain.handle(CHANNEL_UPDATER_RESTART, async (): Promise<void> => {
            // quitAndInstall はアプリを終了させる副作用を持つため await しない（呼び出し元の
            // IPC ハンドラを待たせても意味がなく、終了自体が「結果」になる）。
            autoUpdater.quitAndInstall();
        });
        ipcMain.handle(CHANNEL_UPDATER_CHECK, async (_event, request: unknown): Promise<void> => {
            // 結果はイベント（CHANNEL_UPDATER_EVENT）でレンダラーへ流れるため await しない。
            const candidate = request && typeof request === 'object' ? request as { userInitiated?: unknown; channel?: unknown } : undefined;
            this.safeCheck(candidate?.userInitiated === true, candidate?.channel);
        });

        try {
            this.configureAndCheck();
        } catch (error) {
            this.recordUpdaterError('electron-updater の初期化に失敗しました', error);
        }
    }

    protected configureAndCheck(): void {
        const testFeedUrl = process.env.AKARI_UPDATER_TEST_FEED_URL;
        const appUpdateYmlExists = existsSync(join(process.resourcesPath, 'app-update.yml'));
        if (testFeedUrl) {
            const configPath = join(app.getPath('userData'), TEST_UPDATE_CONFIG_FILENAME);
            mkdirSync(dirname(configPath), { recursive: true });
            writeFileSync(configPath, `provider: generic\nurl: ${JSON.stringify(testFeedUrl)}\nupdaterCacheDirName: akari-video-updater-l1\n`, 'utf8');
            autoUpdater.forceDevUpdateConfig = true;
            autoUpdater.updateConfigPath = configPath;
        } else if (shouldApplyFeedUrlFallback(app.isPackaged, appUpdateYmlExists)) {
            autoUpdater.setFeedURL(FALLBACK_FEED_OPTIONS);
            this.applyFallbackUpdateConfig();
        }

        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = this.readUpdateSettings().channel === 'prerelease';
        this.trackUpdaterRequests();

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

    protected trackUpdaterRequests(): void {
        if (this.requestTrackingInstalled) { return; }
        this.requestTrackingInstalled = true;
        // electron-updater 6.8.9 passes onCancel to HttpExecutor.doDownload but does not
        // connect it to ClientRequest.abort(). Track the actual requests so cancelling
        // also stops Chromium's in-flight transfer, including redirected requests.
        const updater = autoUpdater as unknown as { httpExecutor?: { createRequest?: (...args: unknown[]) => unknown } | null };
        const executor = updater.httpExecutor;
        if (!executor || typeof executor.createRequest !== 'function') {
            console.warn('[akari-surfaces] updater の createRequest が使えず、通信の追跡を省略しました');
            return;
        }
        const original = executor.createRequest;
        executor.createRequest = (...args: unknown[]): unknown => {
            const request = Reflect.apply(original, executor, args);
            try { return this.updaterRequests.track(request); }
            catch (error) {
                console.error('[akari-surfaces] updater 通信の追跡に失敗しました:', error);
                return request;
            }
        };
    }

    /**
     * feed URL フォールバックの後半。`setFeedURL` は provider（checkForUpdates）にしか効かず、
     * electron-updater は DL 開始時に app-update.yml から updaterCacheDirName を読む
     * （AppUpdater.getOrCreateDownloadHelper → configOnDisk）。app-update.yml の無い
     * ローカル --dir ビルドでは「チェック成功 → DL で ENOENT」を「更新する」のたびに
     * 繰り返していた（オーナー実機 2026-09-13・0.1.63 → 0.1.64、updater.log に 16 回）。
     * 同形の yml を userData へ書いて `updateConfigPath` を差し替え、DL まで通す。
     * 失敗はログして続行する（チェックまでは従来どおり動く）。
     *
     * `updateConfigPath` の setter は clientPromise を捨てるため、成功したときは直前の
     * `setFeedURL` ではなくこの yml が provider も決める（同じ FALLBACK_FEED_OPTIONS から
     * 作るので結果は同じ）。`setFeedURL` は本メソッドが失敗したときにチェックを生かす
     * 保険として残している — 消さないこと。
     */
    protected applyFallbackUpdateConfig(): void {
        try {
            const configPath = join(app.getPath('userData'), FALLBACK_APP_UPDATE_YML_FILENAME);
            mkdirSync(dirname(configPath), { recursive: true });
            writeFileSync(configPath, buildFallbackAppUpdateYml(), 'utf8');
            autoUpdater.updateConfigPath = configPath;
        } catch (error) {
            this.recordUpdaterError('フォールバック用 app-update.yml の準備に失敗しました', error);
        }
    }

    protected safeCheck(manual = false, offeredChannel?: unknown): void {
        const currentEvent = resolveManualUpdaterCheckEvent(manual, this.activeDownload?.version, this.downloadedVersion);
        if (currentEvent) { this.emit(currentEvent); return; }
        if (this.activeDownload) {
            return;
        }
        const settings = this.readUpdateSettings();
        const channel = resolveUpdaterCheckChannel(settings.channel, manual, offeredChannel);
        autoUpdater.allowPrerelease = channel === 'prerelease';
        if (!manual && !settings.autoCheck) { return; }
        if (isAppTranslocationPath(process.execPath)) {
            this.recordUpdaterError('App Translocation を検知しました', new Error('App Translocation'));
            return;
        }
        if (manual) { this.appendUpdaterLog('手動更新確認', `channel=${channel}`); }
        const startedAt = Date.now();
        autoUpdater.checkForUpdates().then(result => {
            if (manual) { this.appendUpdaterLog('手動更新結果', `available=${!!result?.isUpdateAvailable} version=${result?.updateInfo?.version ?? 'unknown'}`); }
            if (manual && !result) {
                this.recordUpdaterError('手動更新を開始できませんでした', new Error('このビルドではアプリ内更新を利用できません'));
                return;
            }
            if (!this.activeDownload && result?.isUpdateAvailable && result.cancellationToken && result.downloadPromise) {
                this.watchDownload(result, startedAt);
            }
        }).catch(error => {
            this.recordUpdaterError('checkForUpdates に失敗しました', error);
        });
    }

    protected watchDownload(result: UpdateCheckResult, startedAt: number): void {
        const version = result.updateInfo.version;
        const active = { version, startedAt, result, cancelling: false, timer: undefined as unknown as ReturnType<typeof setInterval> };
        const requestPath = join(process.env.AKARI_HOME || join(homedir(), '.akari'), UPDATER_CANCEL_REQUEST_FILENAME);
        active.timer = setInterval(() => {
            if (!existsSync(requestPath) || active.cancelling) { return; }
            let request = '';
            try { request = readFileSync(requestPath, 'utf8'); JSON.parse(request); }
            catch (error) { console.error('[akari-surfaces] 取消要求の読み取りに失敗しました:', error); return; }
            try { unlinkSync(requestPath); }
            catch (error) { console.error('[akari-surfaces] 取消要求の削除に失敗しました:', error); return; }
            if (!isUpdaterCancelRequest(request, version, startedAt, Date.now())) { return; }
            active.cancelling = true;
            clearInterval(active.timer);
            result.cancellationToken!.cancel();
            for (const error of this.updaterRequests.abortAll()) {
                console.error('[akari-surfaces] 更新通信の中断に失敗しました:', error);
            }
            void this.finishCancellation(active);
        }, 200);
        this.activeDownload = active;
        void result.downloadPromise!.then(() => {
            if (!active.cancelling) { clearInterval(active.timer); if (this.activeDownload === active) { this.activeDownload = undefined; } }
        }, () => {
            if (!active.cancelling) { clearInterval(active.timer); if (this.activeDownload === active) { this.activeDownload = undefined; } }
        });
    }

    protected async finishCancellation(active: { version: string; timer: ReturnType<typeof setInterval>; startedAt: number; result: UpdateCheckResult; cancelling: boolean }): Promise<void> {
        let cancelled = false;
        try { await active.result.downloadPromise; } catch { cancelled = true; }
        if (!cancelled) { this.activeDownload = undefined; return; }
        // AppUpdater.executeDownload clears pending on CancellationError. Remove only
        // leftover temp-* files, including createTempUpdateFile's numbered fallback.
        const helper = (autoUpdater as unknown as { downloadedUpdateHelper?: { cacheDirForPendingUpdate: string } }).downloadedUpdateHelper;
        if (helper && existsSync(helper.cacheDirForPendingUpdate)) {
            try {
                for (const name of readdirSync(helper.cacheDirForPendingUpdate)) {
                    if (isUpdaterTemporaryFileName(name)) {
                        try { unlinkSync(join(helper.cacheDirForPendingUpdate, name)); }
                        catch (error) { console.error('[akari-surfaces] 更新一時ファイルの削除に失敗しました:', error); }
                    }
                }
            } catch (error) { console.error('[akari-surfaces] 更新一時ファイルの削除に失敗しました:', error); }
        }
        this.activeDownload = undefined;
        this.emit({ kind: 'update-not-available' });
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

    protected readUpdateSettings(): { channel: 'stable' | 'prerelease'; autoCheck: boolean } {
        try {
            const home = process.env.AKARI_HOME || join(homedir(), '.akari');
            const value = JSON.parse(readFileSync(join(home, 'update-preferences.json'), 'utf8')) as { channel?: string; autoCheck?: boolean };
            return { channel: resolveUpdateChannel(value.channel), autoCheck: value.autoCheck !== false };
        } catch { return { channel: 'prerelease', autoCheck: true }; }
    }

    protected emit(event: ShellUpdaterEvent): void {
        if (event.kind === 'update-downloaded' && event.version) { this.downloadedVersion = event.version; }
        if (event.kind === 'update-available' && event.version && this.downloadedVersion
            && compareVersions(event.version, this.downloadedVersion) > 0) { this.downloadedVersion = undefined; }
        this.lastEvent = event;
        for (const browserWindow of BrowserWindow.getAllWindows()) {
            if (!browserWindow.isDestroyed()) {
                browserWindow.webContents.send(CHANNEL_UPDATER_EVENT, event);
            }
        }
    }
}
