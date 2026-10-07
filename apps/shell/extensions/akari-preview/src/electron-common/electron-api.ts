export const CHANNEL_ASK_MICROPHONE_ACCESS = 'AkariPreviewAskMicrophoneAccess';
export const CHANNEL_CAPTURE_VISUAL_THUMBNAIL = 'AkariPreviewCaptureVisualThumbnail';

export const CHANNEL_CAPTURE_PREVIEW_FRAME = 'AkariPreviewCaptureFrame';
export const CHANNEL_FINISH_PREVIEW_FRAME = 'AkariPreviewFinishFrame';
export const CHANNEL_PREVIEW_RENDERER_GONE = 'AkariPreviewRendererGone';
export const CHANNEL_CONNECTION_DIAGNOSTIC = 'AkariConnectionDiagnostic';

export type ConnectionDiagnosticEvent = 'socket-disconnect' | 'socket-reconnect';

export interface PreviewRendererGoneNotice {
    webviewId: string;
    reason: string;
    exitCode: number | null;
    /** 検知対象 frame を最初に観測した時刻（Unix ミリ秒）。 */
    observedAt: number;
    at: string;
}

export interface ElectronAkariPreviewApi {
    capturePreviewFrame(request: import('../common/preview-frame-capture').PreviewFrameCaptureRequest): Promise<{ captureId: number }>;
    finishPreviewFrame(captureId: number, discard?: boolean): Promise<import('../common/preview-frame-capture').PreviewFrameCaptureResult | undefined>;
    captureVisualThumbnail(page: import('../common/visual-thumbnail').VisualThumbnailPage): Promise<import('../common/visual-thumbnail').VisualThumbnailCapture>;
    askForMicrophoneAccess(): Promise<boolean>;
    onPreviewRendererGone(listener: (notice: PreviewRendererGoneNotice) => void): () => void;
    recordConnectionDiagnostic(event: ConnectionDiagnosticEvent, reason?: string): void;
}

declare global {
    interface Window {
        electronAkariPreview: ElectronAkariPreviewApi;
    }
}
