import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { ipcMain, systemPreferences } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_ASK_MICROPHONE_ACCESS, CHANNEL_CAPTURE_VISUAL_THUMBNAIL, CHANNEL_CAPTURE_PREVIEW_FRAME, CHANNEL_FINISH_PREVIEW_FRAME } from '../electron-common/electron-api';
import { capturePreviewFrame, finishPreviewFrame } from './preview-frame-capture';
import { captureVisualThumbnail } from './visual-thumbnail-capture';

@injectable()
export class AkariPreviewElectronApi implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        ipcMain.handle(CHANNEL_CAPTURE_PREVIEW_FRAME, (event, request) => capturePreviewFrame(event.sender, request));
        ipcMain.handle(CHANNEL_FINISH_PREVIEW_FRAME, (event, captureId, discard) => finishPreviewFrame(event.sender, captureId, discard));
        ipcMain.handle(CHANNEL_CAPTURE_VISUAL_THUMBNAIL, (_event, page) => captureVisualThumbnail(page));
        ipcMain.handle(CHANNEL_ASK_MICROPHONE_ACCESS, async () => {
            if (process.platform !== 'darwin') {
                return true;
            }
            const allowed = await systemPreferences.askForMediaAccess('microphone');
            return allowed;
        });
    }
}
