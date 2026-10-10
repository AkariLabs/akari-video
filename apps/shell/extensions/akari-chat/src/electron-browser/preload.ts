import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import { CHAT_SCREEN_SOURCE, type ElectronAkariChatApi } from '../electron-common/screen-capture';

const api: ElectronAkariChatApi = {
    screenSource: () => ipcRenderer.invoke(CHAT_SCREEN_SOURCE)
};
export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariChat', api);
}
