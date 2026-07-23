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

export interface ResolveHevcProxyRequest {
    videoUri: string;
    projectRootUri: string;
}

// HEVC (H.265) is not reliably decodable on Windows without a paid Store add-on (see
// tasks/2026-07-23-win-portability-audit/report.md §HEVC プレビュー in the internal repo), so
// akari-preview lazily transcodes a local H.264 proxy on first preview request and reuses it on
// a size+mtime cache hit. This runs on all platforms (not just win32) so the behavior is
// identical everywhere and macOS gets the same test coverage as the platform that actually needs
// it.
export type ResolveHevcProxyUnavailableReason =
    | 'ffprobe-not-found'
    | 'ffmpeg-not-found'
    | 'probe-failed'
    | 'source-missing'
    | 'proxy-generation-failed';

export type ResolveHevcProxyResult =
    | { status: 'not-hevc' }
    | { status: 'ready'; proxyUri: string }
    | { status: 'unavailable'; reason: ResolveHevcProxyUnavailableReason };

export interface AkariPreviewService {
    getOverlayRuntimeAssets(): Promise<OverlayRuntimeAssets>;
    createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference>;
    disposeVideoStream(id: string): Promise<void>;
    createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference>;
    disposeAssetStream(id: string): Promise<void>;
    transcodeAudioToWav(request: TranscodeAudioRequest): Promise<TranscodeAudioResult>;
    disposeTranscodedAudioStream(id: string): Promise<void>;
    resolveHevcProxy(request: ResolveHevcProxyRequest): Promise<ResolveHevcProxyResult>;
}
