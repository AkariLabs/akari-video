import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { app, BrowserWindow, nativeTheme, systemPreferences } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';

/** Electron nativeTheme をレンダラーへ配信する。送るのは真偽値だけで任意コードは受け取らない。 */
@injectable()
export class AkariAppearanceElectronMain implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        const broadcast = (): void => {
            const dark = nativeTheme.shouldUseDarkColors;
            const microphone = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown';
            for (const window of BrowserWindow.getAllWindows()) {
                if (window.isDestroyed()) { continue; }
                void window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('akari-native-theme', { detail: { dark: ${dark} } }));`).catch(() => undefined);
                void window.webContents.executeJavaScript(`window.akariPermissions = { microphone: ${JSON.stringify(microphone)} }; window.dispatchEvent(new CustomEvent('akari-permissions', { detail: window.akariPermissions }));`).catch(() => undefined);
            }
        };
        nativeTheme.on('updated', broadcast);
        app.on('browser-window-created', (_event, window) => { window.webContents.on('did-finish-load', broadcast); window.on('focus', broadcast); });
        broadcast();
    }
}
