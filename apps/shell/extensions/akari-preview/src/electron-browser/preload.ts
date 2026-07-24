import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_ASK_MICROPHONE_ACCESS,
    ElectronAkariPreviewApi
} from '../electron-common/electron-api';

const api: ElectronAkariPreviewApi = {
    askForMicrophoneAccess: () => ipcRenderer.invoke(CHANNEL_ASK_MICROPHONE_ACCESS)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPreview', api);
}
