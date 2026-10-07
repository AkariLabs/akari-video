import { contextBridge, ipcRenderer } from '@theia/core/electron-shared/electron';
import {
    CHANNEL_ASK_MICROPHONE_ACCESS,
    CHANNEL_CAPTURE_VISUAL_THUMBNAIL,
    CHANNEL_CAPTURE_PREVIEW_FRAME,
    CHANNEL_FINISH_PREVIEW_FRAME,
    CHANNEL_PREVIEW_RENDERER_GONE,
    CHANNEL_CONNECTION_DIAGNOSTIC,
    ElectronAkariPreviewApi
} from '../electron-common/electron-api';

const api: ElectronAkariPreviewApi = {
    capturePreviewFrame: request => ipcRenderer.invoke(CHANNEL_CAPTURE_PREVIEW_FRAME, request),
    finishPreviewFrame: (captureId, discard) => ipcRenderer.invoke(CHANNEL_FINISH_PREVIEW_FRAME, captureId, discard),
    captureVisualThumbnail: page => ipcRenderer.invoke(CHANNEL_CAPTURE_VISUAL_THUMBNAIL, page),
    askForMicrophoneAccess: () => ipcRenderer.invoke(CHANNEL_ASK_MICROPHONE_ACCESS),
    recordConnectionDiagnostic: (event, reason) => ipcRenderer.send(CHANNEL_CONNECTION_DIAGNOSTIC, event, reason),
    onPreviewRendererGone: listener => {
        const handler = (_event: unknown, notice: Parameters<typeof listener>[0]): void => listener(notice);
        ipcRenderer.on(CHANNEL_PREVIEW_RENDERER_GONE, handler);
        return () => ipcRenderer.removeListener(CHANNEL_PREVIEW_RENDERER_GONE, handler);
    }
};

export function preload(): void {
    contextBridge.exposeInMainWorld('electronAkariPreview', api);
}
