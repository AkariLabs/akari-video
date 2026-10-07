import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, dialog, ipcMain, session, shell, webContents } from '@theia/core/electron-shared/electron';
import type { WebContents } from 'electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_PARTNER_WEB } from '../electron-common/electron-api';
import { externalUrl, guardPartnerWebview, PARTNER_WEB_PARTITION } from '../electron-common/partner-web-url';

export { externalUrl, localWebOrigin } from '../electron-common/partner-web-url';

const guardedContents = new WeakSet<WebContents>();

export function installWebviewGuard(contents: WebContents): void {
    if (contents.getType() !== 'window' || guardedContents.has(contents)) return;
    guardedContents.add(contents);
    const pendingOrigins: string[] = [];
    contents.on('will-attach-webview', (event, preferences, params) => {
        const origin = guardPartnerWebview(event, preferences, params);
        if (origin) pendingOrigins.push(origin);
    });
    contents.on('did-attach-webview', (_event, guest) => {
        const origin = pendingOrigins.shift();
        if (!origin || guest.getType() !== 'webview') {
            guest.close({ waitForBeforeUnload: false });
            return;
        }
        restrictGuest(contents, guest, origin);
    });
}

app.on('web-contents-created', (_event, contents) => installWebviewGuard(contents));

@injectable()
export class PartnerWebMain implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        const webSession = session.fromPartition(PARTNER_WEB_PARTITION);
        webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        webSession.setPermissionCheckHandler(() => false);
        for (const contents of webContents.getAllWebContents()) installWebviewGuard(contents);
        ipcMain.handle(CHANNEL_PARTNER_WEB, async (event, operation: string) => {
            if (event.senderFrame !== event.sender.mainFrame) throw new Error('Main frame required');
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('Window unavailable');
            if (operation === 'ownerId') return String(window.id);
            throw new Error('Invalid operation');
        });
    }

}

function restrictGuest(host: WebContents, guest: WebContents, origin: string): void {
    const allowed = (target: string): boolean => {
        try { return new URL(target).origin === origin; } catch { return false; }
    };
    const outside = (target: string): void => { void offerExternal(host, guest, target); };
    guest.on('will-navigate', (event, target) => {
        if (!allowed(target)) { event.preventDefault(); outside(target); }
    });
    guest.on('will-redirect', (event, target) => {
        if (!allowed(target)) { event.preventDefault(); outside(target); }
    });
    guest.setWindowOpenHandler(({ url }) => {
        if (allowed(url)) void guest.loadURL(url);
        else outside(url);
        return { action: 'deny' };
    });
}

async function offerExternal(host: WebContents, guest: WebContents, raw: string): Promise<void> {
    const url = externalUrl(raw);
    if (!url || host.isDestroyed() || guest.isDestroyed()) return;
    const window = BrowserWindow.fromWebContents(host);
    if (!window || window.isDestroyed()) return;
    const answer = await dialog.showMessageBox(window, { type: 'question',
        title: 'DeepSeek Harness の外へ移動', message: `${new URL(url).hostname} を既定のブラウザで開きますか？`,
        detail: url, buttons: ['開かない', '既定のブラウザで開く'], defaultId: 0, cancelId: 0 });
    if (answer.response === 1 && !guest.isDestroyed() && !window.isDestroyed()) await shell.openExternal(url);
}
