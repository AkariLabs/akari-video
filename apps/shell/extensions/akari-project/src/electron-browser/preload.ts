import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_REVEAL_IN_FILE_MANAGER,
    ElectronAkariProjectApi,
    RevealInFileManagerResult
} from '../electron-common/electron-api';

const api: ElectronAkariProjectApi = {
    revealInFileManager: (fsPath: string): Promise<RevealInFileManagerResult> =>
        ipcRenderer.invoke(CHANNEL_REVEAL_IN_FILE_MANAGER, fsPath)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariProject', api);
}
