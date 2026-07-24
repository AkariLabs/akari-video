export const AKARI_PREVIEW_SERVICE_PATH = '/services/akari-preview';
export const AkariPreviewService = Symbol('AkariPreviewService');

export interface OverlayRuntimeAssets {
    threeJavaScript: string;
    threeRuntimeJavaScript: string;
    runtimeJavaScript: string;
    interactionJavaScript: string;
    interactionCss: string;
    // win2-fonts-wire: render-cut の焼き込みキャプション（packages/render-cut/src/captions.mjs）と
    // 同じ Noto Sans JP を字幕表示に固定するための @font-face src。prepareHtml() の webview は
    // file:// を同一オリジンで読めない（render-cut の rasterize.mjs は Puppeteer が file:// ページを
    // 直接 goto するため pathToFileURL がそのまま使えるが、こちらは Theia WebviewWidget 経由で
    // 別オリジンに描画される）ため、data: URI として埋め込む。
    captionFontDataUri: string;
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

export type ReviewSessionTransportEvent =
    | { recT: number; type: 'play' | 'pause' | 'tick'; timelineT: number }
    | { recT: number; type: 'seek'; from: number; to: number }
    | { recT: number; type: 'rate'; value: number };

export interface StartReviewSessionRequest {
    projectRootUri: string;
    editUri: string;
    timelineT: number;
    playing: boolean;
}

export interface StartReviewSessionResult {
    id: string;
    sessionDir: string;
    startedAt: string;
    editHash: string;
}

export interface AppendReviewSessionEventRequest {
    sessionDir: string;
    event: ReviewSessionTransportEvent;
}

export interface AppendReviewSessionAudioRequest {
    sessionDir: string;
    pcmBase64: string;
}

export interface EndReviewSessionRequest {
    sessionDir: string;
    startedAt: string;
    endedAt: string;
    editHash: string;
    recT: number;
    timelineT: number;
}

export interface ListReviewSessionsRequest {
    projectRootUri: string;
}

export interface ReviewSessionSummary {
    id: string;
    startedAt: string;
    endedAt: string | null;
    durationSec: number;
    orphaned: boolean;
}

// HEVC (H.265) is not reliably decodable on Windows without a paid Store add-on (see the
// win portability audit §HEVC プレビュー in the internal repo), so
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
    startReviewSession(request: StartReviewSessionRequest): Promise<StartReviewSessionResult>;
    appendReviewSessionEvent(request: AppendReviewSessionEventRequest): Promise<void>;
    appendReviewSessionAudio(request: AppendReviewSessionAudioRequest): Promise<void>;
    endReviewSession(request: EndReviewSessionRequest): Promise<void>;
    listReviewSessions(request: ListReviewSessionsRequest): Promise<ReviewSessionSummary[]>;
}
