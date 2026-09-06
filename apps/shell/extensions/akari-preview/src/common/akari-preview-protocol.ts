import { ReviewToolMode } from './review-tool-mode';

export const AKARI_PREVIEW_SERVICE_PATH = '/services/akari-preview';
export const AkariPreviewService = Symbol('AkariPreviewService');

export interface OverlayRuntimeAssets {
    threeJavaScript: string;
    threeTextJavaScript: string;
    threeRuntimeJavaScript: string;
    videoFxJavaScript: string;
    runtimeJavaScript: string;
    interactionJavaScript: string;
    interactionCss: string;
    // 共有カーネル（packages/edit-store/src/webview-kernel.ts — timeline-map 等）。
    // webview は sandbox 制約で import できないため、IIFE バンドル
    // （edit-store lib/webview-kernel.js、global: AkariEditKernel）をインライン注入する。
    webviewKernelJavaScript: string;
    // packages/frame-engine/src から生成した製品プレビュー用 IIFE。legacy 明示時は返さない。
    frameEngineJavaScript?: string;
    // win2-fonts-wire: render-cut の焼き込みキャプション（packages/render-cut/src/captions.mjs）と
    // 同じ Noto Sans JP を字幕表示に固定するための @font-face src。prepareHtml() の webview は
    // file:// を同一オリジンで読めない（render-cut の rasterize.mjs は Puppeteer が file:// ページを
    // 直接 goto するため pathToFileURL がそのまま使えるが、こちらは Theia WebviewWidget 経由で
    // 別オリジンに描画される）ため、data: URI として埋め込む。
    // 2026-09-02（task/2026-09-02-preview-perf）以降、shell の prepareHtml() はこの形を使わず
    // getOverlayRuntimeAssetUrls() の URL 配信を使う。文字列形はテストと互換のために残す。
    captionFontDataUri: string;
}

/**
 * オーバーレイ実行系・字幕フォント・frame-engine を webview へ「URL で」渡す形。
 *
 * getOverlayRuntimeAssets() は各資産を文字列（フォントは base64 data: URI）で返すため、
 * prepareHtml() が組み立てる HTML が開くたびに約 15 MB（字幕フォントだけで 12.8 MB）になり、
 * setHTML の IPC と Chromium のパースが毎回掛かっていた（task/2026-09-02-preview-perf）。
 * こちらは資産を素材配信サーバー（127.0.0.1 の Range サーバー）の固定ルート
 * `/static/<content-hash>/<name>` で配り、HTML には <script src> と @font-face url() だけを
 * 埋める。パスに内容ハッシュを含むので immutable キャッシュが効き、2 回目以降の setHTML は
 * 資産の転送もパースも起こさない。interactionCss だけは style-src 'unsafe-inline' の既定に
 * 合わせて文字列のまま返す（数十 KB）。
 */
export interface OverlayRuntimeAssetUrls {
    /** 資産を配るオリジン（http://127.0.0.1:<port>）。CSP の script-src / font-src に載せる。 */
    origin: string;
    threeJavaScriptUrl: string;
    threeTextJavaScriptUrl: string;
    threeRuntimeJavaScriptUrl: string;
    videoFxJavaScriptUrl: string;
    runtimeJavaScriptUrl: string;
    interactionJavaScriptUrl: string;
    interactionCss: string;
    webviewKernelJavaScriptUrl: string;
    /** includeFrameEngine 指定時のみ。バンドルが無い（legacy 明示）時は undefined。 */
    frameEngineJavaScriptUrl?: string;
    /** preview の両音声経路で使う pitch-preserving AudioWorklet。生成物が無い場合だけ undefined。 */
    previewAudioWorkletUrl?: string;
    captionFontUrl: string;
}

export interface ReadVideoFxLutRequest {
    projectRootUri: string;
    lutRef: string;
}

export interface VideoStreamReference {
    id: string;
    url: string;
}

export interface VideoStreamRequest {
    videoUri: string;
    workspaceRoots?: string[];
}

export interface AssetStreamRequest {
    assetUri: string;
    workspaceRoots?: string[];
}

export interface FragmentAssetPreviewRequest {
    projectRootUri: string;
    html: string;
    htmlPath: string;
    overlayId: string;
    workspaceRoots?: string[];
}

export interface FragmentAssetPreviewResult {
    html: string;
    streams: (VideoStreamReference & { uri: string })[];
    warnings: string[];
}

export interface RasterizeTelopPreviewRequest {
    preset: string;
    params?: Record<string, unknown>;
    duration: number;
    width: number;
    height: number;
    fps: number;
}

export interface TranscodeAudioRequest {
    audioUri: string;
    workspaceRoots?: string[];
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

export interface ProbeAudioPresenceRequest {
    videoUri: string;
}

// hasAudio is undefined when ffprobe is unavailable or the probe itself failed — the caller
// must not treat "unknown" as "silent" (see hevc-proxy.ts's probeHasAudioStream doc comment).
export interface ProbeAudioPresenceResult {
    hasAudio: boolean | undefined;
}

export type ReviewSessionTransportEvent =
    | { recT: number; type: 'play' | 'pause' | 'tick'; timelineT: number }
    | { recT: number; type: 'seek'; from: number; to: number }
    | { recT: number; type: 'rate'; value: number };

// docs/contract-2026-08-11-review-session-ui-events.md #1: passive UI recording (M1) + M2 tool
// mode. target follows the #2 vocabulary (panel:<id> / tab:<id> / timeline:cut:<n> /
// timeline:overlay:<id> / asset:<path>). intent is set true only while the select tool (M2,
// ReviewToolMode 'select') is active -- see ReviewSessionRecorder.handleUiClick. tool.mode fires
// once per actual mode switch (ReviewSessionRecorder.setToolMode).
export type ReviewSessionUiEvent =
    | { recT: number; type: 'ui.click'; target: string; label: string; intent?: boolean }
    | { recT: number; type: 'ui.tab'; target: string; label: string }
    | { recT: number; type: 'ui.panel'; target: string; label: string }
    | { recT: number; type: 'tool.mode'; mode: ReviewToolMode };

export type ReviewSessionEvent = ReviewSessionTransportEvent | ReviewSessionUiEvent;

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
    event: ReviewSessionEvent;
}

export interface AppendReviewSessionAudioRequest {
    sessionDir: string;
    pcmBase64: string;
}

export interface ReviewStrokeFrame {
    timelineT: number;
    sourceT: number;
    cutIndex: number | null;
}

interface ReviewStrokeBase {
    id: string;
    space: 'content-rect';
    recTStart: number;
    recTEnd: number;
    frame: ReviewStrokeFrame;
}

export interface ReviewPenStroke extends ReviewStrokeBase {
    tool: 'pen';
    points: Array<[number, number]>;
}

// task.md 指示4: the rect tool lands through the same session stroke pipeline as pen (additive
// `tool` discriminant), using box: [x,y,w,h] normalized 0-1 -- the same shape as review.json's
// region.box (docs/contract-2026-07-20-review-json-v1-annotation-model.md §2), so a future
// landing into an annotation record's targetKind:"region" needs no reshaping. Choice documented
// in report.md: session-level capture only for M2 (no automatic review.json annotation record --
// matches how pen strokes already work today).
export interface ReviewRectStroke extends ReviewStrokeBase {
    tool: 'rect';
    box: [number, number, number, number];
}

export type ReviewStroke = ReviewPenStroke | ReviewRectStroke;

export interface AppendReviewSessionStrokeRequest {
    sessionDir: string;
    stroke: ReviewStroke;
}

export interface ReadReviewSessionStrokesRequest {
    projectRootUri: string;
    sessionId: string;
}

/**
 * Existing sessions are a tolerant read boundary: missing/legacy/damaged stroke files never make
 * the session list unusable. Valid entries are returned in file order and warnings describe only
 * the entries that were ignored.
 */
export interface ReadReviewSessionStrokesResult {
    sessionId: string;
    strokes: ReviewStroke[];
    warnings: string[];
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
// win portability audit §HEVC プレビュー in the internal repo). task/2026-08-09-drop-hevc-proxy:
// measurement showed <video> hardware-decodes HEVC fine on the platforms tested, so this is no
// longer invoked proactively on open — resolveHevcProxy is called exactly once per source, only
// after the browser side observes an actual <video> playback failure (MEDIA_ERR_DECODE /
// MEDIA_ERR_SRC_NOT_SUPPORTED). See AkariPreviewOpenHandler.handleHevcFallbackRequest. The
// resulting proxy is cached (size+mtime keyed) and reused for the rest of the app session.
// Alpha pixel formats use VP9/yuva WebM; opaque HEVC uses H.264/MP4. This runs on all platforms.
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

// task/2026-09-02-shell-frame-engine-alpha-intake: frame-engine 面のアルファ層（.webm / .mov）を
// Web UI（packages/preview-server）と同じ media-bin alpha-intake で「色 mp4 + マスク mp4」へ取り込む。
// 派生物は入力の隣（<name>.color.mp4 / <name>.mask.mp4）に置かれ、Web UI と shell がキャッシュを共有する。
// frame-engine は MP4 しか読めないため、生の WebM / ProRes を渡すと本編ごと止まる（invalid box）。
export interface PrepareAlphaIntakeRequest {
    videoUri: string;
    projectRootUri: string;
}

export type PrepareAlphaIntakeResult =
    | { status: 'alpha'; colorUri: string; maskUri: string; maskFormat: string; skipped: boolean }
    | { status: 'opaque' }
    | { status: 'unavailable'; reason: string };

// CF-write: layerWrite/audioWrite の書き込み前ゲート。edit.json の候補全文を実際には書き込まず
// packages/edit-lint（呼び出しのみ・改変禁止）で検証する。プロジェクトルートの兄弟ファイル
// （source 動画・captions.json 等）はシンボリックリンクで一時ディレクトリへ写し、参照整合チェックが
// 誤検出しないようにする。
/**
 * 書き込み前 lint ゲートの検証依頼。editUri は対象ファイルの URI — edit.json のほか
 * captions.json も渡せる（URI の basename がそのまま lint 候補のファイル名になる）。
 */
export interface LintEditCandidateRequest {
    editUri: string;
    candidateText: string;
}

export interface LintEditCandidateResult {
    pass: boolean;
    errors: string[];
}

export interface PrepareLegacyEditRequest {
    editUri: string;
}

export type PrepareLegacyEditResult =
    | { ok: true; version: 0 | 1; nextText: string; changes: Array<{ path: string; note: string }> }
    | { ok: false; version: number; blockers: string[] };

export interface ResolveCaptionDisplayRequest {
    captionsUri: string;
    editUri: string;
    workspaceRoots?: string[];
}

export interface ResolvedCaptionDisplayPayload {
    schema: 'caption-layout/v1';
    emphasisWords?: unknown;
    captions: Array<{
        id: string;
        source_cue_id: string;
        start: number;
        end: number;
        text: string;
        text_style?: Record<string, unknown>;
        style_vars?: Record<string, string>;
    }>;
}

export interface BuildWaveformPeaksRequest {
    assetUri: string;
    workspaceRoots?: string[];
    buckets?: number;
}

export type BuildWaveformPeaksResult =
    | { ok: true; peaks: number[]; durationSec: number; buckets: number }
    | { ok: false; reason: string };

export interface AkariPreviewService {
    buildWaveformPeaks(request: BuildWaveformPeaksRequest): Promise<BuildWaveformPeaksResult>;
    promotePreviewAudioSidecars(request: import('./preview-audio-priority').PromotePreviewAudioSidecarsRequest):
        Promise<import('./preview-audio-priority').PromotePreviewAudioSidecarsResult>;
    getOverlayRuntimeAssets(options?: { includeFrameEngine?: boolean }): Promise<OverlayRuntimeAssets>;
    getOverlayRuntimeAssetUrls(options?: { includeFrameEngine?: boolean }): Promise<OverlayRuntimeAssetUrls>;
    readVideoFxLut(request: ReadVideoFxLutRequest): Promise<string>;
    createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference>;
    disposeVideoStream(id: string): Promise<void>;
    createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference>;
    rewriteFragmentAssets(request: FragmentAssetPreviewRequest): Promise<FragmentAssetPreviewResult>;
    rasterizeTelopPreview(request: RasterizeTelopPreviewRequest): Promise<VideoStreamReference>;
    disposeAssetStream(id: string): Promise<void>;
    transcodeAudioToWav(request: TranscodeAudioRequest): Promise<TranscodeAudioResult>;
    disposeTranscodedAudioStream(id: string): Promise<void>;
    resolveHevcProxy(request: ResolveHevcProxyRequest): Promise<ResolveHevcProxyResult>;
    prepareAlphaIntake(request: PrepareAlphaIntakeRequest): Promise<PrepareAlphaIntakeResult>;
    probeAudioPresence(request: ProbeAudioPresenceRequest): Promise<ProbeAudioPresenceResult>;
    startReviewSession(request: StartReviewSessionRequest): Promise<StartReviewSessionResult>;
    appendReviewSessionEvent(request: AppendReviewSessionEventRequest): Promise<void>;
    appendReviewSessionAudio(request: AppendReviewSessionAudioRequest): Promise<void>;
    appendReviewSessionStroke(request: AppendReviewSessionStrokeRequest): Promise<void>;
    readReviewSessionStrokes(request: ReadReviewSessionStrokesRequest): Promise<ReadReviewSessionStrokesResult>;
    endReviewSession(request: EndReviewSessionRequest): Promise<void>;
    listReviewSessions(request: ListReviewSessionsRequest): Promise<ReviewSessionSummary[]>;
    lintEditCandidate(request: LintEditCandidateRequest): Promise<LintEditCandidateResult>;
    prepareLegacyEdit(request: PrepareLegacyEditRequest): Promise<PrepareLegacyEditResult>;
    resolveCaptionDisplay(request: ResolveCaptionDisplayRequest): Promise<ResolvedCaptionDisplayPayload | null>;
}
