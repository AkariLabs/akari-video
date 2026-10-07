import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, dialog, ipcMain, session, shell, WebContentsView } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_PARTNER_WEB } from '../electron-common/electron-api';
import { externalUrl, isHostMainFrameReload, localWebOrigin } from '../electron-common/partner-web-url';
import { maskToken } from '../common/dsh-output-mask';

export { externalUrl, localWebOrigin } from '../electron-common/partner-web-url';

interface WebState { window: BrowserWindow; view: WebContentsView; origin: string; detachHostListeners: () => void; }

@injectable()
export class PartnerWebMain implements ElectronMainApplicationContribution {
    private readonly states = new Map<number, WebState>();

    onStart(_application: ElectronMainApplication): void {
        const webSession = session.fromPartition('persist:akari-partner-deepseek');
        webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        webSession.setPermissionCheckHandler(() => false);
        ipcMain.handle(CHANNEL_PARTNER_WEB, async (event, operation: string, input?: any) => {
            if (event.senderFrame !== event.sender.mainFrame) throw new Error('Main frame required');
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('Window unavailable');
            if (operation === 'ownerId') return String(window.id);
            if (operation === 'open') return this.open(window, input?.url);
            const state = this.states.get(window.id);
            if (operation === 'inspect') {
                if (app.isPackaged || process.env.AKARI_PARTNER_WEB_TEST !== '1') throw new Error('Inspect unavailable');
                if (!state) throw new Error('Web partner is not open');
                return {
                    viewBounds: state.view.getBounds(), windowBounds: window.getBounds(),
                    url: state.view.webContents.getURL().replace(/token=[^&#]+/g, 'token=***')
                };
            }
            if (operation === 'close') { if (state) this.close(state); return; }
            if (!state) throw new Error('Web partner is not open');
            if (operation === 'bounds') {
                const { x, y, width, height, visible } = input ?? {};
                if (![x, y, width, height].every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) return;
                state.view.setBounds({
                    x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)),
                    width: visible ? Math.max(0, Math.floor(width)) : 0,
                    height: visible ? Math.max(0, Math.floor(height)) : 0
                });
                return;
            }
            throw new Error('Invalid operation');
        });
    }

    private async open(window: BrowserWindow, raw: unknown): Promise<void> {
        const origin = localWebOrigin(raw);
        if (!origin || typeof raw !== 'string') throw new Error('Invalid local web URL');
        const previous = this.states.get(window.id);
        if (previous) this.close(previous);
        const view = new WebContentsView({ webPreferences: {
            partition: 'persist:akari-partner-deepseek', nodeIntegration: false, contextIsolation: true, sandbox: true,
            // A hidden view can lose renderer CPU priority while the host is busy.
            // Keep dsh responsive during loading and when another tab hides the view.
            // This cannot raise the priority of a renderer created while its window is occluded.
            backgroundThrottling: false
        } });
        const hostContents = window.webContents;
        const onHostNavigation = (event: { isMainFrame?: boolean; isSameDocument?: boolean },
            _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
            if (isHostMainFrameReload(event, isInPlace, isMainFrame)) this.close(state);
        };
        const onHostGone = (): void => this.close(state);
        const onWindowClosed = (): void => this.close(state);
        const state: WebState = { window, view, origin, detachHostListeners: () => {
            hostContents.removeListener('did-start-navigation', onHostNavigation);
            hostContents.removeListener('render-process-gone', onHostGone);
            window.removeListener('closed', onWindowClosed);
        } };
        this.states.set(window.id, state);
        hostContents.on('did-start-navigation', onHostNavigation);
        hostContents.on('render-process-gone', onHostGone);
        window.once('closed', onWindowClosed);
        const wc = view.webContents;
        wc.removeAllListeners('will-navigate');
        const allowed = (target: string): boolean => {
            try { return new URL(target).origin === origin; } catch { return false; }
        };
        const outside = (target: string): void => { void this.offerExternal(state, target); };
        wc.on('will-navigate', (event, target) => {
            if (!allowed(target)) { event.preventDefault(); outside(target); }
        });
        wc.on('will-redirect', (event, target) => {
            if (!allowed(target)) { event.preventDefault(); outside(target); }
        });
        wc.setWindowOpenHandler(({ url }) => {
            if (allowed(url)) void wc.loadURL(url);
            else outside(url);
            return { action: 'deny' };
        });
        window.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        try { await wc.loadURL(raw); }
        catch (error) { this.close(state); throw new Error(maskToken(String(error))); }
    }

    private async offerExternal(state: WebState, raw: string): Promise<void> {
        const url = externalUrl(raw);
        if (!url || this.states.get(state.window.id) !== state || state.window.isDestroyed()) return;
        const answer = await dialog.showMessageBox(state.window, { type: 'question',
            title: 'DeepSeek Harness の外へ移動', message: `${new URL(url).hostname} を既定のブラウザで開きますか？`,
            detail: url, buttons: ['開かない', '既定のブラウザで開く'], defaultId: 0, cancelId: 0 });
        if (answer.response === 1 && this.states.get(state.window.id) === state) await shell.openExternal(url);
    }

    private close(state: WebState): void {
        if (this.states.get(state.window.id) !== state) return;
        this.states.delete(state.window.id);
        state.detachHostListeners();
        if (!state.window.isDestroyed()) state.window.contentView.removeChildView(state.view);
        state.view.webContents.close();
    }
}
