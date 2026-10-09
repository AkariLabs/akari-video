import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { isWindows } from '@theia/core/lib/common/os';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationConfig } from '@theia/application-package/lib/application-props';

/** Theia が起動時の frame 設定を読む前に、Windows の古い native 設定を直す。 */
@injectable()
export class AkariElectronMainApplication extends ElectronMainApplication {
    protected normalizedFrame = false;

    protected override getDefaultOptions() {
        return { ...super.getDefaultOptions(), backgroundColor: '#0b1222' };
    }

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
            window.webContents.on('dom-ready', () => {
                // bundle の起動を待たず、前回の場所とテーマで読み込み面を塗る。
                void window.webContents.executeJavaScript(`(() => {
                    const scope = localStorage.getItem('akari.ground.scope') === 'project' ? 'project' : 'channel';
                    const light = localStorage.getItem('akari.ground.theme') === 'light';
                    const color = scope === 'project' ? (light ? '#efe9e3' : '#1a0f08') : (light ? '#e3e8f1' : '#0b1222');
                    document.documentElement.style.setProperty('--akari-loading-ground', color);
                    const style = document.createElement('style');
                    style.textContent = 'html,body,.theia-preload{background-color:var(--akari-loading-ground)!important}';
                    document.head.appendChild(style);
                    return color;
                })();`).then(color => {
                    if (!window.isDestroyed()) { window.setBackgroundColor(color); }
                }).catch(() => undefined);
            });
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
