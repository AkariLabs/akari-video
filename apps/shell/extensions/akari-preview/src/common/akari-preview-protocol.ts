export const AKARI_PREVIEW_SERVICE_PATH = '/services/akari-preview';
export const AkariPreviewService = Symbol('AkariPreviewService');

export interface OverlayRuntimeAssets {
    runtimeJavaScript: string;
    interactionJavaScript: string;
    interactionCss: string;
}

export interface VideoStreamReference {
    id: string;
    url: string;
}

export interface VideoStreamRequest {
    videoUri: string;
}

export interface AkariPreviewService {
    getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets>;
    createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference>;
    disposeVideoStream(id: string): Promise<void>;
}
