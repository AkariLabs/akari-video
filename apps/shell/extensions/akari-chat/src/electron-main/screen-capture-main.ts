import { t } from '@akari-video/i18n';
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
                return { error: t('chat.screenCaptureMain.ui.permissionScreenRecordingRequiredSystemSettingsPrivacySecurityMessage') };
            }
            try {
                const sources = await desktopCapturer.getSources({ types: ['screen'] });
                const win = BrowserWindow.fromWebContents(event.sender);
                const displayId = win ? String(screen.getDisplayMatching(win.getBounds()).id) : undefined;
                const selected = sources.find(source => source.display_id === displayId) ?? sources[0];
                const warning = access === 'not-determined'
                    ? t('chat.screenCaptureMain.ui.confirmScreenRecordingPermissionApproveWhenAskedIfMessage')
                    : undefined;
                return selected ? { id: selected.id, ...(warning ? { warning } : {}) }
                    : { error: t('chat.screenCaptureMain.ui.noScreensFoundRecordText') };
            } catch {
                return { error: access === 'not-determined'
                    ? t('chat.screenCaptureMain.ui.permissionScreenRecordingRequiredSystemSettingsPrivacySecurityMessage')
                    : t('chat.screenCaptureMain.ui.couldNotSelectScreenError') };
            }
        });
    }
}
