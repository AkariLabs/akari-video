import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_ASK_MICROPHONE_ACCESS,
    CHANNEL_CAPTURE_VISUAL_THUMBNAIL,
    CHANNEL_CAPTURE_PREVIEW_FRAME,
    CHANNEL_FINISH_PREVIEW_FRAME,
    ElectronAkariPreviewApi
} from '../electron-common/electron-api';

const api: ElectronAkariPreviewApi = {
    capturePreviewFrame: request => ipcRenderer.invoke(CHANNEL_CAPTURE_PREVIEW_FRAME, request),
    finishPreviewFrame: (captureId, discard) => ipcRenderer.invoke(CHANNEL_FINISH_PREVIEW_FRAME, captureId, discard),
    captureVisualThumbnail: page => ipcRenderer.invoke(CHANNEL_CAPTURE_VISUAL_THUMBNAIL, page),
    askForMicrophoneAccess: () => ipcRenderer.invoke(CHANNEL_ASK_MICROPHONE_ACCESS)
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPreview', api);
}
