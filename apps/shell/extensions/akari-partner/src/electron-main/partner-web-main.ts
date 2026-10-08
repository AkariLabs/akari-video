import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, dialog, ipcMain, session, shell, webContents } from '@theia/core/electron-shared/electron';
import type { WebContents } from 'electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_PARTNER_WEB, PartnerWebTheme } from '../electron-common/electron-api';
import { allowPartnerWebRequest, externalUrl, guardPartnerWebview, PARTNER_WEB_PARTITION } from '../electron-common/partner-web-url';

export { externalUrl, localWebOrigin } from '../electron-common/partner-web-url';

const guardedContents = new WeakSet<WebContents>();
const ownerThemes = new Map<string, PartnerWebTheme>();
const ownerGuests = new Map<string, Set<GuardedGuest>>();
const observedWindows = new WeakSet<BrowserWindow>();

interface GuardedGuest {
    contents: WebContents;
    ownerId: string;
    pending: Promise<void>;
    disposed: boolean;
}

function logThemeFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[akari-partner] guest theme emulation skipped: ' + message.replace(/[\r\n]+/g, ' '));
}

function applyGuestTheme(record: GuardedGuest): void {
    record.pending = record.pending.then(async () => {
        if (record.disposed || record.contents.isDestroyed()) return;
        const theme = ownerThemes.get(record.ownerId);
        if (!theme) return;
        try {
            const debuggerClient = record.contents.debugger;
            if (!debuggerClient.isAttached()) {
                debuggerClient.attach();
            }
            await debuggerClient.sendCommand('Emulation.setEmulatedMedia', {
                features: [{ name: 'prefers-color-scheme', value: theme }]
            });
        } catch (error) { logThemeFailure(error); }
    });
}

function observeOwnerWindow(window: BrowserWindow): void {
    if (observedWindows.has(window)) return;
    observedWindows.add(window);
    window.once('closed', () => {
        const ownerId = String(window.id);
        ownerThemes.delete(ownerId);
        ownerGuests.delete(ownerId);
    });
}

function rememberGuardedGuest(host: WebContents, guest: WebContents): void {
    const window = BrowserWindow.fromWebContents(host);
    if (!window) return;
    observeOwnerWindow(window);
    const ownerId = String(window.id);
    const record: GuardedGuest = { contents: guest, ownerId, pending: Promise.resolve(), disposed: false };
    const records = ownerGuests.get(ownerId) ?? new Set<GuardedGuest>();
    records.add(record);
    ownerGuests.set(ownerId, records);
    const guestDebugger = guest.debugger;
    const onDetach = (_event: unknown, reason: string): void => {
        if (!record.disposed && reason !== 'target closed') logThemeFailure('debugger detached: ' + reason);
    };
    guestDebugger.on('detach', onDetach);
    guest.once('destroyed', () => {
        try {
            record.disposed = true;
            records.delete(record);
            if (records.size === 0) ownerGuests.delete(ownerId);
            guestDebugger.removeListener('detach', onDetach);
        } catch { /* A destroyed guest must not interrupt other destroyed listeners. */ }
    });
    applyGuestTheme(record);
}

export function installWebviewGuard(contents: WebContents): void {
    if (guardedContents.has(contents)) return;
    guardedContents.add(contents);
    let pendingOrigin: string | undefined;
    contents.on('will-attach-webview', (event, preferences, params) => {
        pendingOrigin = guardPartnerWebview(event, preferences, params);
    });
    contents.on('did-attach-webview', (_event, guest) => {
        const origin = pendingOrigin;
        pendingOrigin = undefined;
        if (!origin || guest.getType() !== 'webview') {
            guest.close({ waitForBeforeUnload: false });
            return;
        }
        restrictGuest(contents, guest, origin);
        rememberGuardedGuest(contents, guest);
    });
}

app.on('web-contents-created', (_event, contents) => installWebviewGuard(contents));

@injectable()
export class PartnerWebMain implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        const webSession = session.fromPartition(PARTNER_WEB_PARTITION);
        webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        webSession.setPermissionCheckHandler(() => false);
        webSession.on('will-download', event => event.preventDefault());
        webSession.webRequest.onBeforeRequest((details, callback) => {
            callback({ cancel: !allowPartnerWebRequest(details) });
        });
        for (const contents of webContents.getAllWebContents()) installWebviewGuard(contents);
        ipcMain.handle(CHANNEL_PARTNER_WEB, async (event, operation: string, ownerId?: string, theme?: unknown) => {
            if (event.senderFrame !== event.sender.mainFrame) throw new Error('Main frame required');
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) throw new Error('Window unavailable');
            if (operation === 'ownerId') return String(window.id);
            if (operation === 'setTheme') {
                if (ownerId !== String(window.id)) return;
                if (theme !== 'dark' && theme !== 'light') return;
                observeOwnerWindow(window);
                ownerThemes.set(ownerId, theme);
                for (const guest of ownerGuests.get(ownerId) ?? []) applyGuestTheme(guest);
                return;
            }
            throw new Error('Invalid operation');
        });
    }

}

function restrictGuest(host: WebContents, guest: WebContents, origin: string): void {
    const allowed = (target: string): boolean => {
        try { return new URL(target).origin === origin; } catch { return false; }
    };
    const outside = (target: string): void => { void offerExternal(host, guest, target); };
    let recovering = false;
    guest.removeAllListeners('will-navigate');
    guest.on('will-navigate', (event, target) => {
        if (!allowed(target)) { event.preventDefault(); outside(target); }
    });
    guest.on('will-redirect', (event, target) => {
        if (!allowed(target)) { event.preventDefault(); outside(target); }
    });
    guest.on('did-navigate', (_event, target) => {
        if (allowed(target)) {
            recovering = false;
        } else if (!recovering) {
            recovering = true;
            void guest.loadURL(`${origin}/`).catch(() => undefined);
        }
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
