import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_COPY_FILE_TO_CLIPBOARD,
    CHANNEL_REVEAL_IN_FILE_MANAGER,
    CopyFileToClipboardResult,
    ElectronAkariProjectApi,
    RevealInFileManagerResult
} from '../electron-common/electron-api';

const api: ElectronAkariProjectApi = {
    revealInFileManager: (fsPath: string): Promise<RevealInFileManagerResult> =>
        ipcRenderer.invoke(CHANNEL_REVEAL_IN_FILE_MANAGER, fsPath),
    copyFileToClipboard: (fsPath: string): Promise<CopyFileToClipboardResult> =>
        ipcRenderer.invoke(CHANNEL_COPY_FILE_TO_CLIPBOARD, fsPath)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariProject', api);
}
