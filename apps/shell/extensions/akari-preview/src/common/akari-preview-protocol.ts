export const AKARI_PREVIEW_SERVICE_PATH = '/services/akari-preview';
export const AkariPreviewService = Symbol('AkariPreviewService');

export interface OverlayRuntimeAssets {
    threeJavaScript: string;
    threeRuntimeJavaScript: string;
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

export interface AssetStreamRequest {
    assetUri: string;
}

export interface AkariPreviewService {
    getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets>;
    createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference>;
    disposeVideoStream(id: string): Promise<void>;
    createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference>;
    disposeAssetStream(id: string): Promise<void>;
}
