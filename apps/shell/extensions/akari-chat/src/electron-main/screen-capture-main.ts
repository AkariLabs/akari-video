import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHAT_SCREEN_SOURCE, type ChatScreenSourceResult } from '../electron-common/screen-capture';

@injectable()
export class ChatScreenCaptureMain implements ElectronMainApplicationContribution {
    onStart(): void {
        ipcMain.handle(CHAT_SCREEN_SOURCE, async (event): Promise<ChatScreenSourceResult> => {
            const access = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
            if (access === 'denied' || access === 'restricted') {
                return { error: '画面収録の許可が必要です。システム設定 › プライバシーとセキュリティ › 画面収録で AKARI を許可してください。' };
            }
            try {
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                const win = BrowserWindow.fromWebContents(event.sender);
                const displayId = win ? String(screen.getDisplayMatching(win.getBounds()).id) : undefined;
                const selected = sources.find(source => source.display_id === displayId) ?? sources[0];
                const warning = access === 'not-determined'
                    ? '画面収録の許可を確認します。求められたら承認してください。表示されない場合はシステム設定 › プライバシーとセキュリティ › 画面収録で AKARI を許可してください。'
                    : undefined;
                return selected ? { id: selected.id, ...(warning ? { warning } : {}) }
                    : { error: '録画できる画面が見つかりません' };
            } catch {
                return { error: access === 'not-determined'
                    ? '画面収録の許可が必要です。システム設定 › プライバシーとセキュリティ › 画面収録で AKARI を許可してください。'
                    : '画面を選べませんでした' };
            }
        });
    }
}
