import {
    ElectronMainApplication,
    ElectronMainApplicationContribution
} from '@theia/core/lib/electron-main/electron-main-application';
import { ipcMain, systemPreferences } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import { CHANNEL_ASK_MICROPHONE_ACCESS } from '../electron-common/electron-api';

@injectable()
export class AkariPreviewElectronApi implements ElectronMainApplicationContribution {
    onStart(_application: ElectronMainApplication): void {
        ipcMain.handle(CHANNEL_ASK_MICROPHONE_ACCESS, async () => {
            if (process.platform !== 'darwin') {
                return true;
            }
            const allowed = await systemPreferences.askForMediaAccess('microphone');
            return allowed;
        });
    }
}
