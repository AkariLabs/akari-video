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

export interface TranscodeAudioRequest {
    audioUri: string;
}

export type TranscodeAudioErrorKind =
    | 'ffmpeg-not-found'
    | 'input-too-large'
    | 'timeout'
    | 'output-too-large'
    | 'transcode-failed';

export type TranscodeAudioResult =
    | { ok: true; stream: VideoStreamReference }
    | { ok: false; error: TranscodeAudioErrorKind };

export interface AkariPreviewService {
    getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets>;
    createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference>;
    disposeVideoStream(id: string): Promise<void>;
    createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference>;
    disposeAssetStream(id: string): Promise<void>;
    transcodeAudioToWav(request: TranscodeAudioRequest): Promise<TranscodeAudioResult>;
    disposeTranscodedAudioStream(id: string): Promise<void>;
}
