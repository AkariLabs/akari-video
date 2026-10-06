export const CHANNEL_ASK_MICROPHONE_ACCESS = 'AkariPreviewAskMicrophoneAccess';
export const CHANNEL_CAPTURE_VISUAL_THUMBNAIL = 'AkariPreviewCaptureVisualThumbnail';

export const CHANNEL_CAPTURE_PREVIEW_FRAME = 'AkariPreviewCaptureFrame';
export const CHANNEL_FINISH_PREVIEW_FRAME = 'AkariPreviewFinishFrame';
export const CHANNEL_PREVIEW_RENDERER_GONE = 'AkariPreviewRendererGone';

export interface PreviewRendererGoneNotice {
    webviewId: string;
    reason: string;
    exitCode: number | null;
    at: string;
}

export interface ElectronAkariPreviewApi {
    capturePreviewFrame(request: import('../common/preview-frame-capture').PreviewFrameCaptureRequest): Promise<{ captureId: number }>;
    finishPreviewFrame(captureId: number, discard?: boolean): Promise<import('../common/preview-frame-capture').PreviewFrameCaptureResult | undefined>;
    captureVisualThumbnail(page: import('../common/visual-thumbnail').VisualThumbnailPage): Promise<import('../common/visual-thumbnail').VisualThumbnailCapture>;
    askForMicrophoneAccess(): Promise<boolean>;
    onPreviewRendererGone(listener: (notice: PreviewRendererGoneNotice) => void): () => void;
}

declare global {
    interface Window {
        electronAkariPreview: ElectronAkariPreviewApi;
    }
}
