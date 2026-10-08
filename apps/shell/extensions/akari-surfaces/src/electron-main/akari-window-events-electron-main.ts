import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { isWindows } from '@theia/core/lib/common/os';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationConfig } from '@theia/application-package/lib/application-props';

/** Theia が起動時の frame 設定を読む前に、Windows の古い native 設定を直す。 */
@injectable()
export class AkariElectronMainApplication extends ElectronMainApplication {
    protected normalizedFrame = false;

    protected getTitleBarStyle(config: FrontendApplicationConfig): 'native' | 'custom' {
        if (isWindows && !this.normalizedFrame) {
            this.normalizedFrame = true;
            const state = this.electronStore.get('windowstate');
            if (state?.frame === true) {
                this.electronStore.set('windowstate', { ...state, frame: false });
            }
        }
        return super.getTitleBarStyle(config);
    }
}

/** 窓の全画面状態を renderer の帯へ伝える。 */
@injectable()
export class AkariWindowEventsElectronMain implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        const attach = (window: BrowserWindow): void => {
            const broadcast = (): void => {
                if (window.isDestroyed()) { return; }
                const fullScreen = window.isFullScreen();
                void window.webContents.executeJavaScript(
                    `window.dispatchEvent(new CustomEvent('akari-window-fullscreen', { detail: { fullScreen: ${fullScreen} } }));`
                ).catch(() => undefined);
            };
            window.on('enter-full-screen', broadcast);
            window.on('leave-full-screen', broadcast);
            window.on('maximize', broadcast);
            window.on('unmaximize', broadcast);
        };
        BrowserWindow.getAllWindows().forEach(attach);
        app.on('browser-window-created', (_event, window) => attach(window));
    }
}
