export const CHANNEL_ASK_MICROPHONE_ACCESS = 'AkariPreviewAskMicrophoneAccess';
export const CHANNEL_CAPTURE_VISUAL_THUMBNAIL = 'AkariPreviewCaptureVisualThumbnail';

export interface ElectronAkariPreviewApi {
    captureVisualThumbnail(page: import('../common/visual-thumbnail').VisualThumbnailPage): Promise<import('../common/visual-thumbnail').VisualThumbnailCapture>;
    askForMicrophoneAccess(): Promise<boolean>;
}

declare global {
    interface Window {
        electronAkariPreview: ElectronAkariPreviewApi;
    }
}
