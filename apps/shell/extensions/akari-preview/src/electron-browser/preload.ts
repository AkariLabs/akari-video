import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_ASK_MICROPHONE_ACCESS,
    CHANNEL_CAPTURE_VISUAL_THUMBNAIL,
    ElectronAkariPreviewApi
} from '../electron-common/electron-api';

const api: ElectronAkariPreviewApi = {
    captureVisualThumbnail: page => ipcRenderer.invoke(CHANNEL_CAPTURE_VISUAL_THUMBNAIL, page),
    askForMicrophoneAccess: () => ipcRenderer.invoke(CHANNEL_ASK_MICROPHONE_ACCESS)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPreview', api);
}
