import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, ipcMain, session, shell, WebContentsView } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_PARTNER_WEB } from '../electron-common/electron-api';

interface WebState { window: BrowserWindow; view: WebContentsView; origin: string; }

function localWebOrigin(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
            || url.username || url.password || !url.port) return undefined;
        return url.origin;
    } catch { return undefined; }
}
function externalUrl(raw: string): string | undefined {
    try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) return undefined;
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return undefined;
        return url.toString();
    } catch { return undefined; }
}

@injectable()
export class PartnerWebMain implements ElectronMainApplicationContribution {
    private readonly states = new Map<number, WebState>();

    onStart(_application: ElectronMainApplication): void {
        const webSession = session.fromPartition('persist:akari-partner-deepseek');
        webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        webSession.setPermissionCheckHandler(() => false);
        ipcMain.handle(CHANNEL_PARTNER_WEB, async (event, operation: string, input?: any) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('Window unavailable');
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
            partition: 'persist:akari-partner-deepseek', nodeIntegration: false, contextIsolation: true, sandbox: true
        } });
        const state: WebState = { window, view, origin };
        this.states.set(window.id, state);
        const wc = view.webContents;
        wc.removeAllListeners('will-navigate');
        const allowed = (target: string): boolean => {
            try { return new URL(target).origin === origin; } catch { return false; }
        };
        const outside = (target: string): void => {
            const external = externalUrl(target);
            if (external) void shell.openExternal(external);
        };
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
        window.once('closed', () => this.close(state));
        try { await wc.loadURL(raw); }
        catch (error) { this.close(state); throw error; }
    }

    private close(state: WebState): void {
        if (this.states.get(state.window.id) !== state) return;
        this.states.delete(state.window.id);
        if (!state.window.isDestroyed()) state.window.contentView.removeChildView(state.view);
        state.view.webContents.close();
    }
}
