import URI from '@theia/core/lib/common/uri';
import { Command, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ApplicationShell,
    FrontendApplicationContribution,
    OpenHandler,
    OpenerService,
    WidgetManager,
    open
} from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    AkariPreviewService,
    OverlayRuntimeAssets,
    ReviewStrokeFrame
} from '../common/akari-preview-protocol';
import {
    bgmLoopOffsetSeconds,
    resolveBgmSourceOffset,
    resolveSfxTrimWindow,
    resolveTimedScheduleWindow
} from '../common/audio-schedule';
import { classifyEditAssetPath, uncToFileUriString, windowsDriveToFileUriString } from '../common/edit-asset-path';
import {
    CAPTION_FONT_FAMILY,
    CAPTION_FONT_LOAD_DESCRIPTOR,
    captionFontFaceCss,
    RESOLVED_CAPTION_STYLE_VARIABLE_NAMES,
    RESOLVED_SINGLE_LINE_CAPTION_CSS,
    RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE,
    RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE,
    RESOLVED_SINGLE_LINE_FRAGMENT_OPEN
} from '../common/caption-visual-contract';
import { CutFraming, computeCutFramingVisual } from '../common/cut-framing-visual';
import { CutFreeze, checkCutFreezeCrossing } from '../common/cut-freeze-visual';
import { LayerPerspective, computeLayerPerspectiveVisual } from '../common/layer-perspective-visual';
import { PEN_TUNING } from '../common/pen-canvas-visuals';
import { fitPreviewCompositeRect } from '../common/preview-composite-layout';
import { resolveAnnotationStrokeCompositionSeconds } from '../common/review-stroke-seek';
import { locatePreviewCaptions, parsePreviewCaptions, parseResolvedPreviewCaptions, PreviewCaption } from './akari-preview-captions';
import {
    ReviewSessionRecorder,
    ReviewSessionUiState,
    ReviewTransportChange,
    ReviewTransportSnapshot
} from './review-session-recorder';

interface OverlayTransform {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

interface EditSummaryOverlay {
    id: string;
    html: string;
    start: number;
    duration: number;
    track: number;
    transform: OverlayTransform;
    vars: Record<string, string>;
}

interface EditSummaryLayer {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src?: string;
    transform: OverlayTransform;
    opacity: number;
    blend: string;
    chromaKey: boolean;
    proxyMissing: boolean;
    track: number;
}

interface EditSummaryCut {
    /** 参照するソース id（v1 cuts[].src。v0 は既定 id）。webview はこれで <video> を切り替える */
    src: string;
    in: number;
    out: number;
    transform?: OverlayTransform;
    opacity?: number;
    speed?: number;
    transitionOut?: {
        type: 'dissolve' | 'fade-black' | 'fade-white';
        duration: number;
    };
    at?: number;
    track: number;
    /** contract-2026-07-22-render-basics.md #6 (静的クロップ / ズームキーフレーム）。
     * 深いバリデーションは common/cut-framing-visual.ts の computeCutFramingVisual が担う
     * ため、ここでは「非配列オブジェクト」であることだけ確認して素通しする。 */
    framing?: CutFraming;
    /** contract-2026-07-22-render-basics.md #7（フリーズ）。同上、深いバリデーションは
     * common/cut-freeze-visual.ts の checkCutFreezeCrossing 側。 */
    freeze?: CutFreeze;
}

interface EditSummaryAudioSource {
    src: string;
    gainDb: number;
}

interface EditSummaryBgm extends EditSummaryAudioSource {
    ducking: boolean;
    fadeIn?: number;
    fadeOut?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: file-internal start offset (素材秒).
    in?: number;
}

interface EditSummaryTimedAudio extends EditSummaryAudioSource {
    id: string;
    t: number;
    track?: number;
    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (sfx only; narration is unaffected):
    // playback window = material's [in, out). Omitted in/out are resolved against the decoded
    // buffer's real duration in the injected preview script (createPreviewAudio's decodeOne).
    in?: number;
    out?: number;
}

interface EditSummaryAudio {
    bgm?: EditSummaryBgm;
    sfx: EditSummaryTimedAudio[];
    narration: EditSummaryTimedAudio[];
}

interface EditSummaryEmphasisWord {
    id: string;
    src?: string;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_hint?: string;
}

interface EditSummaryTrackState {
    muted?: boolean;
    hidden?: boolean;
}

interface EditSummaryTracks {
    cuts?: EditSummaryTrackState[];
    layers?: EditSummaryTrackState[];
    audio?: EditSummaryTrackState[];
}

interface EditSummaryTimelineTrack {
    kind: 'cuts' | 'layers' | 'overlays' | 'captions' | 'audio';
    ref?: number;
}

interface EditSummary {
    output: { width: number; height: number; fps?: number };
    overlays: EditSummaryOverlay[];
    layers: EditSummaryLayer[];
    cuts: EditSummaryCut[];
    audio?: EditSummaryAudio;
    tracks?: EditSummaryTracks;
    timelineTracks?: EditSummaryTimelineTrack[];
    hasInlineCaptions?: boolean;
    indicators: string[];
}

interface PreviewModel {
    summary: EditSummary;
    editUri?: URI;
    relatedEditUri?: URI;
    sourceUri?: URI;
    /** ソース id → 実体 URI（v0 は既定 id ひとつ・v1 は sources[] 全件） */
    sourcesById?: Map<string, { uri: URI; proxyUri?: URI }>;
    // Explicit edit.json source.proxy (v0/v1 schema field), read-only, highest priority over the
    // HEVC-triggered proxy resolved in refreshPreview(). Only set when the file actually exists.
    sourceProxyUri?: URI;
    overlayUris: URI[];
    assetUris: URI[];
    assetStreamIds: string[];
    captionsUri?: URI;
    captions: PreviewCaption[];
    emphasisWords?: EditSummaryEmphasisWord[];
    session?: {
        muted: boolean;
        captionsVisible: boolean;
        hiddenTracks: number[];
        hiddenTracksByScope: { cuts: number[]; layers: number[]; audio: number[] };
        mutedTracksByScope: { cuts: number[]; audio: number[]; layers: number[] };
        allTracksHiddenScopes: string[];
        allTracksMutedScopes: string[];
    };
}

interface OverlayWriteRequest {
    type: 'akari-preview-overlay-write';
    requestId: string;
    overlayId: string;
    patch: {
        vars?: Record<string, unknown>;
        transform?: OverlayTransform;
        // 断片テキスト編集（contenteditable）の書き戻し。overlays[].html は契約上ファイル参照
        // なので、この値は edit.json ではなく参照先の断片ファイルへ書く
        html?: string;
    };
}

// ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的。#/$defs/layerCrop）。
interface LayerCropPatch {
    x: number;
    y: number;
    w: number;
    h: number;
}

// ㉖ layers[].perspective（corner-pin パース変形。v0 静的。#/$defs/layerPerspective）。
interface LayerPerspectivePatch {
    corners: [number, number][];
}

// CF-write: overlayWrite と同型の layers[] 版。追加/削除は CF-dnd（別レーン）の範囲のため対象外、
// transform/crop/perspective 変更のみ扱う（t/duration 変更は既存の timeline moveLayer 経路で
// 既に書き戻る）。perspective: null は「解除」（layer.perspective を削除）を表す。
interface LayerWriteRequest {
    type: 'akari-preview-layer-write';
    requestId: string;
    layerId: string;
    patch: {
        transform?: OverlayTransform;
        crop?: LayerCropPatch;
        perspective?: LayerPerspectivePatch | null;
    };
}

// CF-write: layerWrite と同型の cuts[] 版（akari-preview-open-handler.ts:2780 layerWrite に倣う。
// ㉓ 本編ビデオのクリック選択+transform）。追加/削除・in/out はタイムライン側の既存経路の
// 対象のため扱わない。transform のみ。
interface CutWriteRequest {
    type: 'akari-preview-cut-write';
    requestId: string;
    cutIndex: number;
    patch: {
        transform?: OverlayTransform;
    };
}

// ㉓ 字幕クリック選択+移動（v0 スコープ = 選択 + 位置移動の最小）。captions.json は
// zone が固定 9 値の enum（3x3 配置ゾーン、schemas/captions.schema.json）で自由座標が
// 無いため、書き戻しは「ドラッグ位置→最近傍 zone への吸着」で表現する（schema 追加なし。
// zone 語彙で表現できない自由配置が必要になった場合は実装せず report へ設計提案を書く
// 契約 §のとおり）。
const CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;
type CaptionZoneValue = typeof CAPTION_ZONES[number];

interface CaptionWriteRequest {
    type: 'akari-preview-caption-write';
    requestId: string;
    captionId: string;
    patch: {
        zone: CaptionZoneValue;
    };
}

interface PreviewCaptionSelectedRequest {
    type: 'akari-preview-caption-selected';
    captionId: string | null;
}

interface WaveformFetchRequest {
    type: 'akari-preview-waveform-fetch';
    requestId: string;
}

interface OpenOutputRequest {
    type: 'akari-preview-open-output-request';
}

interface PreviewReviewStrokeStartRequest {
    type: 'akari-preview-review-stroke-start';
    frame: ReviewStrokeFrame;
}

interface PreviewReviewStrokeEndRequest {
    type: 'akari-preview-review-stroke-end';
    points: Array<[number, number]>;
}

interface ReviewAnnotationStrokeRequest {
    editUri: string;
    sourceT: number;
    strokes: Array<{
        points: Array<[number, number]>;
        frame?: { sourceT?: number; cutIndex?: number | null };
    }>;
}

interface PreviewWidgetMarker extends WebviewWidget {
    akariPreviewConfigured?: boolean;
    akariPreviewConfiguration?: Promise<void>;
    akariPreviewRefresh?: Promise<void>;
    akariPreviewCaptionsUpdate?: Promise<void>;
    akariPreviewEditUri?: URI;
    akariPreviewRelatedEditUri?: URI;
    akariPreviewVideoUri?: URI;
    akariPreviewCaptionsUri?: URI;
    akariPreviewTrackedResources?: Set<string>;
    akariPreviewTrackedSuffixes?: Set<string>;
    akariPreviewStreamId?: string;
    /** v1 マルチソースで代表ソース以外に開いた動画ストリーム id（代表は akariPreviewStreamId） */
    akariPreviewExtraStreamIds?: string[];
    akariPreviewAssetStreamIds?: string[];
    akariPreviewSeekable?: boolean;
    akariPreviewMuted?: boolean;
    akariPreviewCaptionsVisible?: boolean;
    akariPreviewHiddenTracks?: Set<number>;
    akariPreviewHiddenTracksByScope?: { cuts?: number[]; layers?: number[]; audio?: number[] };
    akariPreviewMutedTracksByScope?: { cuts?: number[]; audio?: number[]; layers?: number[] };
    akariPreviewAllTracksMutedScopes?: string[];
    akariPreviewAllTracksHiddenScopes?: string[];
}

// akari-transcript の AKARI_TRANSCRIPT_SEEK_REQUESTED.id（akari-transcript-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.registerHandler に後付け登録する。
const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
// akari-annotations 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
// CF-select: overlay 選択同期チャンネルの layers 版（akari-annotations 側と文字列のみミラー）。
const TIMELINE_LAYER_SELECTED_EVENT = 'akari.timeline.layerSelected';
const TIMELINE_SET_MUTED_EVENT = 'akari.timeline.setMuted';
const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
const TIMELINE_SET_CLIPS_VISIBILITY_EVENT = 'akari.timeline.setClipsVisibility';
const TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT = 'akari.timeline.setOverlayTrackMuted';
const TIMELINE_SET_LAYERS_VISIBILITY_EVENT = 'akari.timeline.setLayersVisibility';
const TIMELINE_SET_LAYERS_MUTED_EVENT = 'akari.timeline.setLayersMuted';
const TIMELINE_SET_AUDIO_VISIBILITY_EVENT = 'akari.timeline.setAudioVisibility';
const TIMELINE_SET_AUDIO_MUTED_EVENT = 'akari.timeline.setAudioMuted';
const TIMELINE_SET_CAPTIONS_MUTED_EVENT = 'akari.timeline.setCaptionsMuted';
const TIMELINE_SET_BEATS_VISIBILITY_EVENT = 'akari.timeline.setBeatsVisibility';
const TIMELINE_SET_BEATS_MUTED_EVENT = 'akari.timeline.setBeatsMuted';
const TIMELINE_SYNC_TRACK_TOGGLES_EVENT = 'akari.timeline.syncTrackToggles';
// akari-annotations 側の TIMELINE_LIVE_TRANSFORM_EVENT とミラー（文字列のみ、cross-package import なし）。
// インスペクターのスクラブドラッグ中、書き込みなしで cuts/layers の transform/opacity をプレビューへ
// 即時反映する ephemeral イベント。
const TIMELINE_LIVE_TRANSFORM_EVENT = 'akari.timeline.liveTransform';
const PREVIEW_OVERLAY_SELECTED_EVENT = 'akari.preview.overlaySelected';
const PREVIEW_LAYER_SELECTED_EVENT = 'akari.preview.layerSelected';
// ㉓ forwardOverlaySelection/forwardLayerSelection の流儀で追加した cut 版。
// タイムライン側（akari-annotations、編集禁止）の購読は本タスクの対象外
// （既存 2 チャンネルと同じ配線パターンだけをここに追加する）。
const PREVIEW_CUT_SELECTED_EVENT = 'akari.preview.cutSelected';
// ㉓ 字幕版。既存 2 チャンネルと同じ配線パターンをここに追加するだけ
// （タイムライン側〔akari-annotations、編集禁止〕の購読は対象外）。
const PREVIEW_CAPTION_SELECTED_EVENT = 'akari.preview.captionSelected';
// akari-annotations の録音セクション側と文字列だけをミラーし、extension 間の npm 依存を作らない。
const REVIEW_SESSION_START_EVENT = 'akari.review.session.start';
const REVIEW_ANNOTATION_SHOW_STROKES_EVENT = 'akari.review.annotation.showStrokes';
const REVIEW_SESSION_STOP_EVENT = 'akari.review.session.stop';
const REVIEW_SESSION_REFRESH_EVENT = 'akari.review.session.refresh';
const REVIEW_SESSION_OPEN_FOLDER_EVENT = 'akari.review.session.openFolder';
const REVIEW_SESSION_STATE_EVENT = 'akari.review.session.state';

// akari-annotations の ATTACH_AKARI_ANNOTATIONS_PASSIVE.id（akari-annotations-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.executeCommand に渡す。
const ATTACH_TIMELINE_PASSIVE_COMMAND_ID = 'akari.annotations.attachPassive';

// タイムライン操作時にアウトプットプレビューのタブを前面へ出すための内部コマンド。
// label なし = コマンドパレット非表示（ATTACH_AKARI_ANNOTATIONS_PASSIVE と同じパターン）。
const ENSURE_PREVIEW_VISIBLE_COMMAND: Command = { id: 'akari.preview.ensureVisible' };
const SEEK_OUTPUT_PREVIEW_COMMAND: Command = { id: 'akari.preview.seekOutput' };
const TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND: Command = { id: 'akari.preview.togglePlayback' };
const PREVIEW_OPEN_TIMEOUT_MS = 10_000;
const PREVIEW_OPEN_ATTEMPTS = 2;
const PREVIEW_OPEN_ERROR_MESSAGE = '動画プレビューを開けませんでした。しばらく待ってから、もう一度お試しください。';

interface TranscriptSeekRequest {
    videoUri?: string;
    time?: number;
    captionId?: string;
}

interface EnsureVisibleRequest {
    editUri?: string;
}

interface SeekOutputRequest {
    editUri?: string;
    time?: number;
}

interface TogglePlaybackRequest {
    editUri?: string;
}

interface PreviewPlaybackTickRequest {
    type: 'akari-preview-playback-tick';
    time: number;
    playing: boolean;
    rate?: number;
}

interface PreviewOverlaySelectedRequest {
    type: 'akari-preview-overlay-selected';
    overlayId: string | null;
}

// CF-select: overlay 選択同期チャンネルの layers 版。
interface PreviewLayerSelectedRequest {
    type: 'akari-preview-layer-selected';
    layerId: string | null;
}

// ㉓ overlay/layer 選択同期チャンネルの cut 版。true = 現在再生中のカットが選択中。
interface PreviewCutSelectedRequest {
    type: 'akari-preview-cut-selected';
    selected: boolean;
}

interface PreviewReviewTransportRequest {
    type: 'akari-preview-review-transport-event';
    event: ReviewTransportChange;
}

interface ReviewSessionControlRequest {
    projectRootUri?: string;
    editUri?: string;
}

interface PreviewSessionSettings {
    muted: boolean;
    captionsVisible: boolean;
    hiddenTracks: Set<number>;
    hiddenTracksByScope: { cuts: Set<number>; layers: Set<number>; audio: Set<number> };
    mutedTracksByScope: { cuts: Set<number>; audio: Set<number>; layers: Set<number> };
    allTracksHiddenByScope: { cuts: boolean; layers: boolean; audio: boolean };
    allTracksMutedByScope: { cuts: boolean; audio: boolean; layers: boolean };
}

interface TrackVisibilityV2Request {
    videoUri?: string;
    scope?: 'cuts' | 'overlays' | 'layers' | 'audio' | 'captions';
    track?: number | null;
    hidden?: boolean;
    muted?: boolean;
}

const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: [],
    layers: [],
    cuts: [],
    indicators: []
};
// v0（単一 source）を v1 と同じ「id → ソース」表で扱うための既定 id。
// cuts[].src を持たない v0 のカットは全てこの id を指す。
const DEFAULT_SOURCE_ID = '__default__';
// ドットディレクトリ（.git/.akari/.claude 等）と node_modules は名前探索の対象外。
// スキル同梱の開発用フィクスチャ（.claude/skills/**/dev-fixtures/）を拾わないための除外。
const isSkippedSearchDirectory = (name: string): boolean => name.startsWith('.') || name === 'node_modules';
const PLAYABLE_VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const UNSUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.avi', '.mts', '.m2ts', '.wmv']);
const CLAIMED_VIDEO_EXTENSIONS = new Set([
    ...PLAYABLE_VIDEO_MIME_TYPES.keys(),
    ...UNSUPPORTED_VIDEO_EXTENSIONS
]);
const UNSUPPORTED_FORMAT_MESSAGE = 'この形式はアプリ内プレビューに未対応です。書き出し後の MP4 をプレビューできます。';
const OUTSIDE_WORKSPACE_MESSAGE = 'ワークスペース外の動画はプレビューできません。';
const THREE_SCENE_KEYS = new Set([
    'model',
    'camera',
    'lights',
    'animationClip',
    'materialOverrides',
    // environment / shadows がここに無いと宣言ごと拒否され、model パスが空になって
    // preview の読み込みが失敗していた（export は別経路のため影響を受けていなかった）
    'environment',
    'shadows'
]);
const LAYER_BLEND_TO_CSS = new Map<string, string>([
    ['normal', 'normal'],
    ['screen', 'screen'],
    ['multiply', 'multiply'],
    ['add', 'plus-lighter'],
    ['difference', 'difference'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['overlay', 'overlay'],
    ['hardlight', 'hard-light'],
    ['softlight', 'soft-light']
]);

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-preview-open-handler';
    protected readonly recentWrites = new Map<string, number>();
    protected readonly openPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly openOutputPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly previewSessionSettings = new Map<string, PreviewSessionSettings>();
    protected readonly pendingOutputInitialSeek = new Map<string, number>();
    protected readonly reviewTransportByEdit = new Map<string, ReviewTransportSnapshot>();
    protected overlayWriteTail = Promise.resolve();
    protected layerWriteTail = Promise.resolve();
    protected cutWriteTail = Promise.resolve();
    protected captionWriteTail = Promise.resolve();
    protected readonly lifecycleDisposables = new DisposableCollection();
    protected reviewSessionRecorder: ReviewSessionRecorder | undefined;
    protected retryWidgetSequence = 0;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    onStart(): void {
        this.reviewSessionRecorder = new ReviewSessionRecorder(
            this.previewService,
            state => this.forwardReviewSessionState(state)
        );
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            const kind = id.startsWith('akari-output-preview-') ? 'output'
                : id.startsWith('akari-preview-') ? 'raw' : undefined;
            if (kind && viewId) {
                const identityUri = new URI(viewId).normalizePath();
                const initialSeekTime = kind === 'output'
                    ? this.pendingOutputInitialSeek.get(identityUri.toString())
                    : undefined;
                void this.configurePreview(event.widget, identityUri, kind, initialSeekTime).catch(error => {
                    if (!event.widget.isDisposed) {
                        console.warn('[akari-preview] failed to configure created preview widget', viewId, error);
                    }
                });
            }
        });
        this.registerSeekHandler();
        this.registerEnsureVisibleCommand();
        this.registerOutputSeekCommand();
        this.registerTogglePlaybackCommand();
        const onTimelineOverlaySelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; overlayId?: string | null }>).detail;
            if (!detail?.editUri || (typeof detail.overlayId !== 'string' && detail.overlayId !== null)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-overlay', overlayId: detail.overlayId });
            }
        };
        window.addEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected)
        });
        // CF-select: タイムラインでレイヤーを選択 → 出力プレビュー側もハイライト（overlay と同型）。
        const onTimelineLayerSelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; layerId?: string | null }>).detail;
            if (!detail?.editUri || (typeof detail.layerId !== 'string' && detail.layerId !== null)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-layer', layerId: detail.layerId });
            }
        };
        window.addEventListener(TIMELINE_LAYER_SELECTED_EVENT, onTimelineLayerSelected);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_LAYER_SELECTED_EVENT, onTimelineLayerSelected)
        });
        const registerTimelineSetting = <T extends { editUri?: string }>(
            type: string,
            apply: (widget: PreviewWidgetMarker | undefined, detail: T, settings: PreviewSessionSettings) => void
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) {
                    return;
                }
                let key: string;
                try {
                    key = new URI(detail.editUri).normalizePath().toString();
                } catch {
                    return;
                }
                const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
                const widget = this.openOutputPreviews.get(key);
                apply(widget?.isAttached ? widget : undefined, detail, settings);
                this.previewSessionSettings.set(key, settings);
            };
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        registerTimelineSetting<{ editUri?: string; muted?: boolean }>(TIMELINE_SET_MUTED_EVENT, (widget, detail, settings) => {
            if (typeof detail.muted !== 'boolean') return;
            settings.muted = detail.muted;
            if (widget) {
                widget.akariPreviewMuted = detail.muted;
                widget.sendMessage({ type: 'akari-preview-set-muted', muted: detail.muted });
            }
        });
        registerTimelineSetting<{ editUri?: string; track?: number; visible?: boolean }>(
            TIMELINE_SET_TRACK_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (!Number.isInteger(detail.track) || detail.track! < 0 || typeof detail.visible !== 'boolean') return;
                if (detail.visible) settings.hiddenTracks.delete(detail.track!); else settings.hiddenTracks.add(detail.track!);
                if (widget) {
                    widget.akariPreviewHiddenTracks = new Set(settings.hiddenTracks);
                    widget.sendMessage({
                        type: 'akari-preview-set-track-visibility', track: detail.track, visible: detail.visible
                    });
                }
            }
        );
        const onTrackVisibilityV2 = (event: Event): void => {
            this.applyTrackVisibilityV2((event as CustomEvent<TrackVisibilityV2Request>).detail);
        };
        window.addEventListener(TIMELINE_SET_TRACK_VISIBILITY_EVENT, onTrackVisibilityV2);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_SET_TRACK_VISIBILITY_EVENT, onTrackVisibilityV2)
        });
        const onSyncTrackToggles = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                cuts?: { hidden?: number[]; muted?: number[] };
                layers?: { hidden?: number[]; muted?: number[] };
            }>).detail;
            if (!detail?.editUri) return;
            this.applyTimelineTrackSync(detail.editUri, detail.cuts, detail.layers);
        };
        window.addEventListener(TIMELINE_SYNC_TRACK_TOGGLES_EVENT, onSyncTrackToggles);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_SYNC_TRACK_TOGGLES_EVENT, onSyncTrackToggles)
        });
        const registerTimelineSettingV2Adapter = <T extends { editUri?: string }>(
            type: string,
            toRequest: (detail: T) => Omit<TrackVisibilityV2Request, 'videoUri'>
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) return;
                this.applyTrackVisibilityV2({ ...toRequest(detail), videoUri: detail.editUri });
            };
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_CLIPS_VISIBILITY_EVENT,
            detail => ({
                scope: 'cuts', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; track?: number; muted?: boolean }>(
            TIMELINE_SET_OVERLAY_TRACK_MUTED_EVENT,
            detail => ({ scope: 'overlays', track: detail.track, muted: detail.muted })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_LAYERS_VISIBILITY_EVENT,
            detail => ({
                scope: 'layers', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; muted?: boolean }>(
            TIMELINE_SET_LAYERS_MUTED_EVENT,
            detail => ({ scope: 'layers', track: null, muted: detail.muted })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_AUDIO_VISIBILITY_EVENT,
            detail => ({
                scope: 'audio', track: null,
                hidden: typeof detail.visible === 'boolean' ? !detail.visible : undefined
            })
        );
        registerTimelineSettingV2Adapter<{ editUri?: string; muted?: boolean }>(
            TIMELINE_SET_AUDIO_MUTED_EVENT,
            detail => ({ scope: 'audio', track: null, muted: detail.muted })
        );
        // captions/beats はプレビュー側に音声・専用描画の対象がない（字幕に音声なし・beats はプレビュー非描画）。
        // 購読はするが意図的に no-op。
        const noopTimelineSetting = (): void => { /* no-op: プレビュー側に対応する状態がないスコープ */ };
        window.addEventListener(TIMELINE_SET_CAPTIONS_MUTED_EVENT, noopTimelineSetting);
        window.addEventListener(TIMELINE_SET_BEATS_VISIBILITY_EVENT, noopTimelineSetting);
        window.addEventListener(TIMELINE_SET_BEATS_MUTED_EVENT, noopTimelineSetting);
        this.lifecycleDisposables.push({
            dispose: () => {
                window.removeEventListener(TIMELINE_SET_CAPTIONS_MUTED_EVENT, noopTimelineSetting);
                window.removeEventListener(TIMELINE_SET_BEATS_VISIBILITY_EVENT, noopTimelineSetting);
                window.removeEventListener(TIMELINE_SET_BEATS_MUTED_EVENT, noopTimelineSetting);
            }
        });
        registerTimelineSetting<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (typeof detail.visible !== 'boolean') return;
                settings.captionsVisible = detail.visible;
                if (widget) {
                    widget.akariPreviewCaptionsVisible = detail.visible;
                    widget.sendMessage({ type: 'akari-preview-set-captions-visibility', visible: detail.visible });
                }
            }
        );
        const onLiveTransform = (event: Event): void => {
            const detail = (event as CustomEvent<{
                editUri?: string;
                target?: { kind: 'cut'; index: number } | { kind: 'layer'; id: string };
                field?: string;
                value?: number;
            }>).detail;
            if (!detail?.editUri || !detail.target
                || (detail.target.kind !== 'cut' && detail.target.kind !== 'layer')
                || typeof detail.field !== 'string' || typeof detail.value !== 'number'
                || !Number.isFinite(detail.value)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({
                    type: 'akari-preview-live-transform',
                    target: detail.target,
                    field: detail.field,
                    value: detail.value
                });
            }
        };
        window.addEventListener(TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_LIVE_TRANSFORM_EVENT, onLiveTransform)
        });
        this.registerReviewSessionEvents();
    }

    protected applyTrackVisibilityV2(detail: TrackVisibilityV2Request | undefined): void {
        if (!detail || typeof detail.videoUri !== 'string'
            || (detail.scope !== 'cuts' && detail.scope !== 'overlays' && detail.scope !== 'layers'
                && detail.scope !== 'audio' && detail.scope !== 'captions')) {
            return;
        }
        let key: string;
        try {
            key = new URI(detail.videoUri).normalizePath().toString();
        } catch {
            return;
        }
        const widget = this.openOutputPreviews.get(key);
        const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
        if (detail.scope === 'overlays') {
            if (!Number.isInteger(detail.track) || detail.track! < 0 || typeof detail.hidden !== 'boolean') return;
            if (detail.hidden) settings.hiddenTracks.add(detail.track!); else settings.hiddenTracks.delete(detail.track!);
            if (widget?.isAttached) {
                widget.akariPreviewHiddenTracks = new Set(settings.hiddenTracks);
                widget.sendMessage({
                    type: 'akari-preview-set-track-visibility', track: detail.track, visible: !detail.hidden
                });
            }
            this.previewSessionSettings.set(key, settings);
            return;
        }
        if (detail.scope === 'captions') {
            if (typeof detail.hidden !== 'boolean') return;
            settings.captionsVisible = !detail.hidden;
            if (widget?.isAttached) {
                widget.akariPreviewCaptionsVisible = !detail.hidden;
                widget.sendMessage({ type: 'akari-preview-set-captions-visibility', visible: !detail.hidden });
            }
            this.previewSessionSettings.set(key, settings);
            return;
        }
        if (typeof detail.hidden === 'boolean'
            && (detail.scope === 'cuts' || detail.scope === 'layers' || detail.scope === 'audio')) {
            if (detail.track === null) {
                settings.allTracksHiddenByScope[detail.scope] = detail.hidden;
            } else if (Number.isInteger(detail.track) && detail.track! >= 0) {
                if (detail.hidden) settings.hiddenTracksByScope[detail.scope].add(detail.track!);
                else settings.hiddenTracksByScope[detail.scope].delete(detail.track!);
            }
        }
        if (typeof detail.muted === 'boolean'
            && (detail.scope === 'cuts' || detail.scope === 'audio' || detail.scope === 'layers')) {
            if (detail.track === null) {
                settings.allTracksMutedByScope[detail.scope] = detail.muted;
            } else if (Number.isInteger(detail.track) && detail.track! >= 0) {
                if (detail.muted) settings.mutedTracksByScope[detail.scope].add(detail.track!);
                else settings.mutedTracksByScope[detail.scope].delete(detail.track!);
            }
        }
        this.previewSessionSettings.set(key, settings);
        if (widget?.isAttached) {
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...settings.hiddenTracksByScope.cuts],
                layers: [...settings.hiddenTracksByScope.layers],
                audio: [...settings.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...settings.mutedTracksByScope.cuts],
                audio: [...settings.mutedTracksByScope.audio],
                layers: [...settings.mutedTracksByScope.layers]
            };
            widget.akariPreviewAllTracksHiddenScopes = Object.entries(settings.allTracksHiddenByScope)
                .filter(([, hidden]) => hidden).map(([scope]) => scope);
            widget.akariPreviewAllTracksMutedScopes = Object.entries(settings.allTracksMutedByScope)
                .filter(([, muted]) => muted).map(([scope]) => scope);
            widget.sendMessage({
                type: 'akari-preview-set-track-visibility-v2',
                scope: detail.scope,
                track: detail.track,
                hidden: detail.hidden,
                muted: detail.muted
            });
        }
    }

    protected applyTimelineTrackSync(
        videoUri: string,
        cuts?: { hidden?: number[]; muted?: number[] },
        layers?: { hidden?: number[]; muted?: number[] }
    ): void {
        let key: string;
        try {
            key = new URI(videoUri).normalizePath().toString();
        } catch {
            return;
        }
        const widget = this.openOutputPreviews.get(key);
        const settings = this.previewSessionSettings.get(key) ?? this.defaultSessionSettings();
        settings.hiddenTracksByScope.cuts = new Set(cuts?.hidden ?? []);
        settings.mutedTracksByScope.cuts = new Set(cuts?.muted ?? []);
        settings.hiddenTracksByScope.layers = new Set(layers?.hidden ?? []);
        settings.mutedTracksByScope.layers = new Set(layers?.muted ?? []);
        this.previewSessionSettings.set(key, settings);
        if (widget?.isAttached) {
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...settings.hiddenTracksByScope.cuts],
                layers: [...settings.hiddenTracksByScope.layers],
                audio: [...settings.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...settings.mutedTracksByScope.cuts],
                audio: [...settings.mutedTracksByScope.audio],
                layers: [...settings.mutedTracksByScope.layers]
            };
            widget.sendMessage({
                type: 'akari-preview-set-track-visibility-v2-bulk',
                hiddenCuts: [...settings.hiddenTracksByScope.cuts],
                mutedCuts: [...settings.mutedTracksByScope.cuts],
                hiddenLayers: [...settings.hiddenTracksByScope.layers],
                mutedLayers: [...settings.mutedTracksByScope.layers]
            });
        }
    }

    protected defaultSessionSettings(): PreviewSessionSettings {
        return {
            muted: false,
            captionsVisible: true,
            hiddenTracks: new Set<number>(),
            hiddenTracksByScope: { cuts: new Set<number>(), layers: new Set<number>(), audio: new Set<number>() },
            mutedTracksByScope: { cuts: new Set<number>(), audio: new Set<number>(), layers: new Set<number>() },
            allTracksHiddenByScope: { cuts: false, layers: false, audio: false },
            allTracksMutedByScope: { cuts: false, audio: false, layers: false }
        };
    }

    onStop(): void {
        this.lifecycleDisposables.dispose();
        void this.reviewSessionRecorder?.dispose();
        this.reviewSessionRecorder = undefined;
    }

    protected registerReviewSessionEvents(): void {
        const register = (type: string, listener: EventListener): void => {
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        register(REVIEW_SESSION_START_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (!detail?.projectRootUri || !detail.editUri || !this.reviewSessionRecorder) {
                return;
            }
            void this.startReviewSessionFromPanel(detail.projectRootUri, detail.editUri);
        });
        register(REVIEW_SESSION_STOP_EVENT, () => {
            void this.reviewSessionRecorder?.stop();
        });
        register(REVIEW_SESSION_REFRESH_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (detail?.projectRootUri && detail.editUri) {
                void this.reviewSessionRecorder?.refresh(detail.projectRootUri, detail.editUri);
            }
        });
        register(REVIEW_SESSION_OPEN_FOLDER_EVENT, event => {
            const detail = (event as CustomEvent<ReviewSessionControlRequest>).detail;
            if (!detail?.projectRootUri) {
                return;
            }
            let sessionsUri: URI;
            try {
                sessionsUri = new URI(detail.projectRootUri).resolve('review/sessions').normalizePath();
            } catch {
                return;
            }
            void open(this.openerService, sessionsUri, { mode: 'activate' }).catch(error => {
                const detail = error instanceof Error ? error.message : String(error);
                this.messages.warn(`録音セッションの保存先を開けません: ${detail}`);
            });
        });
        register(REVIEW_ANNOTATION_SHOW_STROKES_EVENT, event => {
            const detail = (event as CustomEvent<ReviewAnnotationStrokeRequest>).detail;
            if (detail) {
                void this.showReviewAnnotationStrokes(detail);
            }
        });
    }

    protected async showReviewAnnotationStrokes(detail: ReviewAnnotationStrokeRequest): Promise<void> {
        const editUri = this.normalizeReviewEditUri(detail.editUri);
        if (!editUri || !Number.isFinite(detail.sourceT) || !Array.isArray(detail.strokes)) {
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) {
            return;
        }
        const cutIndex = this.resolveReviewStrokeCutIndex(detail.strokes);
        let compositionSeconds = detail.sourceT;
        try {
            const model = await this.loadPreviewModel(new URI(editUri));
            compositionSeconds = resolveAnnotationStrokeCompositionSeconds(
                model.summary.cuts, detail.sourceT, cutIndex
            );
        } catch {
            // edit.json が読めない場合は sourceT をそのまま composition 秒として扱う
            // （cuts なしの恒等写像と同じフォールバック）。
        }
        widget.sendMessage({ type: 'akari-preview-seek', time: compositionSeconds });
        widget.sendMessage({
            type: 'akari-preview-show-annotation-strokes',
            points: detail.strokes.map(stroke => stroke.points)
        });
    }

    // strokes[].frame.cutIndex は同一 source 秒が複数カットに含まれる場合の多義解決に使う
    // （最初に見つかった有効な cutIndex を採用。ストローク群は同一 annotation・同一カットの想定）。
    protected resolveReviewStrokeCutIndex(
        strokes: ReviewAnnotationStrokeRequest['strokes']
    ): number | null {
        for (const stroke of strokes) {
            const cutIndex = stroke.frame?.cutIndex;
            if (Number.isInteger(cutIndex) && (cutIndex as number) >= 0) {
                return cutIndex as number;
            }
        }
        return null;
    }

    protected async startReviewSessionFromPanel(projectRootUri: string, requestedEditUri: string): Promise<void> {
        const recorder = this.reviewSessionRecorder;
        const editUri = this.normalizeReviewEditUri(requestedEditUri);
        if (!recorder || !editUri) {
            recorder?.reportError(projectRootUri, requestedEditUri, 'edit.json の場所を特定できません。');
            return;
        }
        const visibility = await this.ensureVisible(editUri);
        const widget = this.openOutputPreviews.get(editUri);
        if (visibility === 'unavailable' || !widget?.isAttached) {
            recorder.reportError(projectRootUri, editUri, '出力プレビューを開けませんでした。');
            return;
        }
        const transport = this.reviewTransportByEdit.get(editUri) ?? {
            timelineT: 0,
            playing: false,
            rate: 1
        };
        await recorder.start({
            projectRootUri,
            editUri,
            timelineT: transport.timelineT,
            playing: transport.playing
        }, transport);
    }

    protected normalizeReviewEditUri(value: string): string | undefined {
        try {
            return new URI(value).normalizePath().toString();
        } catch {
            return undefined;
        }
    }

    protected forwardReviewSessionState(state: ReviewSessionUiState): void {
        window.dispatchEvent(new CustomEvent(REVIEW_SESSION_STATE_EVENT, { detail: state }));
        const editUri = this.normalizeReviewEditUri(state.editUri);
        const widget = editUri ? this.openOutputPreviews.get(editUri) : undefined;
        if (widget?.isAttached) {
            widget.sendMessage({
                type: 'akari-preview-set-review-recording',
                active: state.active
            });
        }
    }

    // 戻り値は 'seeked' | 'mismatched-asset' | 'no-preview' の3値で、'no-preview' は akari-transcript 側のフォールバックハンドラが返す。
    protected registerSeekHandler(): void {
        this.commandRegistry.registerHandler(TRANSCRIPT_SEEK_COMMAND_ID, {
            isEnabled: () => this.openPreviews.size > 0,
            execute: (request?: TranscriptSeekRequest) => {
                const widget = this.findSeekableWidget(request?.videoUri);
                if (widget && Number.isFinite(request?.time)) {
                    widget.sendMessage({ type: 'akari-preview-seek', time: request!.time });
                    return 'seeked';
                }
                return 'mismatched-asset';
            }
        });
    }

    protected findSeekableWidget(videoUri: string | undefined): PreviewWidgetMarker | undefined {
        if (!videoUri) {
            return undefined;
        }
        const key = new URI(videoUri).normalizePath().toString();
        const widget = this.openPreviews.get(key);
        return widget && widget.isAttached && widget.akariPreviewSeekable ? widget : undefined;
    }

    canHandle(uri: URI): number {
        return CLAIMED_VIDEO_EXTENSIONS.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identityUri = uri.normalizePath();
        try {
            const widget = await this.getOrOpenPreview(
                identityUri,
                options?.widgetOptions ?? { area: 'main' },
                'raw'
            );
            this.attachTimelinePassively();
            await this.shell.activateWidget(widget.id);
            return widget;
        } catch (error) {
            this.reportOpenFailure(identityUri, error);
            throw error;
        }
    }

    async openOutput(uri: URI, options?: any): Promise<WebviewWidget> {
        const editUri = uri.normalizePath();
        try {
            const widget = await this.getOrOpenPreview(
                editUri,
                options?.widgetOptions ?? { area: 'main' },
                'output'
            );
            this.attachTimelinePassively();
            await this.shell.activateWidget(widget.id);
            return widget;
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            throw error;
        }
    }

    // 動画がプレビューで開かれるたびにタイムラインの自動アタッチを要求する。重複禁止・
    // セッション内の明示クローズの尊重・フォーカスを奪わない（reveal のみ）判断は
    // 呼び出し先（akari-annotations）に委ねる。取りこぼしてもプレビュー自体は開けるべきなので
    // 結果を待たず、失敗時は握りつぶす。
    protected attachTimelinePassively(): void {
        this.commandRegistry.executeCommand(ATTACH_TIMELINE_PASSIVE_COMMAND_ID)
            .catch(error => console.warn('[akari-preview] failed to auto-attach timeline', error));
    }

    // タイムライン側からの操作で、他のタブを見ていてもアウトプットプレビューのタブを
    // 必ず前面へ出すための内部コマンド。フォーカスは奪わない（revealWidget のみ）。
    protected registerEnsureVisibleCommand(): void {
        this.commandRegistry.registerCommand(ENSURE_PREVIEW_VISIBLE_COMMAND, {
            execute: (request?: EnsureVisibleRequest) => this.ensureVisible(request?.editUri)
        });
    }

    protected async ensureVisible(editUri: string | undefined): Promise<'revealed' | 'opened' | 'unavailable'> {
        if (!editUri) {
            return 'unavailable';
        }
        try {
            const uri = new URI(editUri).normalizePath();
            const existing = this.openOutputPreviews.get(uri.toString());
            if (existing?.akariPreviewConfigured && existing.isAttached && !existing.isDisposed) {
                this.shell.revealWidget(existing.id);
                return 'revealed';
            }
            const widget = await this.getOrOpenPreview(uri, { area: 'main' }, 'output');
            this.shell.revealWidget(widget.id);
            return 'opened';
        } catch (error) {
            this.reportOpenFailure(new URI(editUri), error);
            return 'unavailable';
        }
    }

    protected registerOutputSeekCommand(): void {
        this.commandRegistry.registerCommand(SEEK_OUTPUT_PREVIEW_COMMAND, {
            execute: (request?: SeekOutputRequest) => this.seekOutputPreview(request)
        });
    }

    protected registerTogglePlaybackCommand(): void {
        this.commandRegistry.registerCommand(TOGGLE_OUTPUT_PREVIEW_PLAYBACK_COMMAND, {
            execute: (request?: TogglePlaybackRequest) => this.toggleOutputPreviewPlayback(request)
        });
    }

    protected async toggleOutputPreviewPlayback(
        request: TogglePlaybackRequest | undefined
    ): Promise<'toggled' | 'unavailable'> {
        if (!request?.editUri) {
            return 'unavailable';
        }
        const editUri = new URI(request.editUri).normalizePath();
        const existing = this.openOutputPreviews.get(editUri.toString());
        if (existing?.akariPreviewConfigured && existing.isAttached && !existing.isDisposed) {
            existing.sendMessage({ type: 'akari-preview-toggle-playback' });
            return 'toggled';
        }
        return 'unavailable';
    }

    protected async seekOutputPreview(
        request: SeekOutputRequest | undefined
    ): Promise<'seeked' | 'mismatched-asset'> {
        if (!request?.editUri || !Number.isFinite(request.time)) {
            return 'mismatched-asset';
        }
        const editUri = new URI(request.editUri).normalizePath();
        const key = editUri.toString();
        const existing = this.openOutputPreviews.get(key);
        if (existing?.akariPreviewConfigured && existing.akariPreviewSeekable && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, { area: 'main' });
            }
            this.shell.revealWidget(existing.id);
            existing.sendMessage({ type: 'akari-preview-seek', time: request.time });
            return 'seeked';
        }
        try {
            const widget = await this.getOrOpenPreview(editUri, { area: 'main' }, 'output', request.time);
            this.shell.revealWidget(widget.id);
            this.attachTimelinePassively();
            return 'seeked';
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            return 'mismatched-asset';
        }
    }

    protected async getOrOpenPreview(
        uri: URI,
        widgetOptions: any,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<WebviewWidget> {
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        const existing = previews.get(seekKey);
        if (existing?.akariPreviewConfigured && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, widgetOptions);
            }
            if (kind === 'output' && Number.isFinite(initialSeekTime)) {
                existing.sendMessage({ type: 'akari-preview-seek', time: initialSeekTime });
            }
            return existing;
        }

        if (kind === 'output' && Number.isFinite(initialSeekTime)) {
            this.pendingOutputInitialSeek.set(seekKey, initialSeekTime!);
        }
        const baseId = kind === 'output'
            ? `akari-output-preview-${this.hash(uri.toString())}`
            : `akari-preview-${this.hash(uri.toString())}`;
        let lastError: unknown;
        let useFreshIdentifier = false;
        for (let attempt = 1; attempt <= PREVIEW_OPEN_ATTEMPTS; attempt += 1) {
            const identifier = {
                id: useFreshIdentifier ? `${baseId}-retry-${++this.retryWidgetSequence}` : baseId,
                viewId: uri.toString()
            };
            let widget: WebviewWidget | undefined;
            let abandoned = false;
            const operation = (async (): Promise<WebviewWidget> => {
                widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
                if (abandoned) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview open attempt was superseded.');
                }
                await this.configurePreview(widget, uri, kind, initialSeekTime);
                if (abandoned || widget.isDisposed) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview widget was disposed while opening.');
                }
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, widgetOptions);
                }
                return widget;
            })();
            try {
                return await this.withOpenTimeout(operation, uri);
            } catch (error) {
                abandoned = true;
                lastError = error;
                if (widget) {
                    this.discardPreviewWidget(widget, uri, kind);
                } else {
                    // WidgetManager は作成中 Promise を同じ ID で再利用する。作成自体が止まった場合は
                    // 次の試行だけ新しい ID にし、遅れて生成された widget は operation 側で破棄する。
                    useFreshIdentifier = true;
                }
                if (attempt < PREVIEW_OPEN_ATTEMPTS) {
                    console.warn(`[akari-preview] open attempt ${attempt} failed; retrying`, uri.toString(), error);
                }
            }
        }
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    protected withOpenTimeout<T>(operation: Promise<T>, uri: URI): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                reject(new Error(`Timed out after ${PREVIEW_OPEN_TIMEOUT_MS}ms while opening ${uri.toString()}`));
            }, PREVIEW_OPEN_TIMEOUT_MS);
            operation.then(value => {
                window.clearTimeout(timeout);
                resolve(value);
            }, error => {
                window.clearTimeout(timeout);
                reject(error);
            });
        });
    }

    protected discardPreviewWidget(widget: WebviewWidget, uri: URI, kind: 'raw' | 'output'): void {
        const marker = widget as PreviewWidgetMarker;
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        if (previews.get(seekKey) === marker) {
            previews.delete(seekKey);
        }
        if (!widget.isDisposed) {
            widget.dispose();
        }
        void this.disposePreviewStreams(marker);
    }

    protected reportOpenFailure(uri: URI, error: unknown): void {
        console.error('[akari-preview] failed to open preview', uri.toString(), error);
        // データ起因（TypeError = edit.json の検証エラー等）は「しばらく待て」では直らないので、
        // 実因メッセージをそのまま出す。原因不明のときだけ従来の汎用文言に落とす。
        const reason = error instanceof Error && error.message ? error.message : undefined;
        void this.messages.error(
            reason
                ? `${uri.path.base}: 動画プレビューを開けませんでした — ${reason}`
                : `${uri.path.base}: ${PREVIEW_OPEN_ERROR_MESSAGE}`
        );
    }

    protected async configurePreview(
        widget: WebviewWidget,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const marker = widget as PreviewWidgetMarker;
        if (marker.akariPreviewConfiguration) {
            return marker.akariPreviewConfiguration;
        }
        marker.akariPreviewConfiguration = this.doConfigurePreview(marker, identityUri, kind, initialSeekTime);
        try {
            await marker.akariPreviewConfiguration;
        } finally {
            marker.akariPreviewConfiguration = undefined;
        }
    }

    protected async doConfigurePreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const seekKey = identityUri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        previews.set(seekKey, widget);
        const session = kind === 'output' ? this.previewSessionSettings.get(seekKey) : undefined;
        if (session) {
            widget.akariPreviewMuted = session.muted;
            widget.akariPreviewCaptionsVisible = session.captionsVisible;
            widget.akariPreviewHiddenTracks = new Set(session.hiddenTracks);
            widget.akariPreviewHiddenTracksByScope = {
                cuts: [...session.hiddenTracksByScope.cuts],
                layers: [...session.hiddenTracksByScope.layers],
                audio: [...session.hiddenTracksByScope.audio]
            };
            widget.akariPreviewMutedTracksByScope = {
                cuts: [...session.mutedTracksByScope.cuts],
                audio: [...session.mutedTracksByScope.audio],
                layers: [...session.mutedTracksByScope.layers]
            };
            widget.akariPreviewAllTracksHiddenScopes = Object.entries(session.allTracksHiddenByScope)
                .filter(([, hidden]) => hidden).map(([scope]) => scope);
            widget.akariPreviewAllTracksMutedScopes = Object.entries(session.allTracksMutedByScope)
                .filter(([, muted]) => muted).map(([scope]) => scope);
        }
        await this.refreshPreview(widget, identityUri, kind, initialSeekTime);
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }

        if (widget.isDisposed) {
            return;
        }

        if (widget.akariPreviewConfigured) {
            return;
        }
        widget.akariPreviewConfigured = true;
        const disposables = new DisposableCollection();
        disposables.push(widget.onMessage(message => {
            if (this.isOverlayWriteRequest(message)) {
                this.overlayWriteTail = this.overlayWriteTail.then(() => this.handleOverlayWrite(widget, message));
            }
            if (this.isLayerWriteRequest(message)) {
                this.layerWriteTail = this.layerWriteTail.then(() => this.handleLayerWrite(widget, message));
            }
            if (this.isWaveformFetchRequest(message)) {
                void this.handleWaveformFetch(widget, message);
            }
            if (this.isOpenOutputRequest(message)) {
                void this.handleOpenOutputRequest(widget);
            }
            if (message?.type === 'akari-preview-fullscreen-fallback') {
                this.shell.toggleMaximized(widget);
            }
            if (this.isPlaybackTickRequest(message)) {
                this.forwardPlaybackTick(widget, message);
            }
            if (this.isOverlaySelectedRequest(message)) {
                this.forwardOverlaySelection(widget, message);
            }
            if (this.isLayerSelectedRequest(message)) {
                this.forwardLayerSelection(widget, message);
            }
            if (this.isCutSelectedRequest(message)) {
                this.forwardCutSelection(widget, message);
            }
            if (this.isCutWriteRequest(message)) {
                this.cutWriteTail = this.cutWriteTail.then(() => this.handleCutWrite(widget, message));
            }
            if (this.isCaptionSelectedRequest(message)) {
                this.forwardCaptionSelection(widget, message);
            }
            if (this.isCaptionWriteRequest(message)) {
                this.captionWriteTail = this.captionWriteTail.then(() => this.handleCaptionWrite(widget, message));
            }
            if (this.isReviewTransportRequest(message)) {
                this.forwardReviewTransport(widget, message);
            }
            if (this.isReviewStrokeStartRequest(message)) {
                this.forwardReviewStrokeStart(widget, message);
            }
            if (this.isReviewStrokeEndRequest(message)) {
                this.forwardReviewStrokeEnd(widget, message);
            }
        }));
        const handleFilesChanged = (event: FileChangesEvent): void => {
            const tracked = widget.akariPreviewTrackedResources ?? new Set<string>();
            const trackedSuffixes = widget.akariPreviewTrackedSuffixes ?? new Set<string>();
            const captionsUri = widget.akariPreviewCaptionsUri;
            const captionsKey = captionsUri?.toString();
            const captionsSuffix = captionsUri ? this.resourceSuffix(captionsUri) : undefined;
            let captionsChanged = false;
            let previewChanged = false;
            for (const change of event.changes) {
                const key = change.resource.toString();
                // ワークスペースルートの watcher は登録時に realpath() で解決される
                // （@theia/filesystem の ParcelWatcher、拡張側からは変更不可）ため、シンボリック
                // リンクを跨ぐワークスペース（例: iCloud Desktop/Documents 同期）では通知される
                // URI の先頭が videoUri/editUri 生成時と食い違う。basename + 直上ディレクトリ名の
                // suffix 一致もフォールバックとして見る。
                const suffix = this.resourceSuffix(change.resource);
                const writtenAt = this.recentWrites.get(key) ?? 0;
                if (key === captionsKey || (captionsSuffix !== undefined && suffix === captionsSuffix)) {
                    captionsChanged ||= Date.now() - writtenAt > 1000;
                    continue;
                }
                if (tracked.has(key) || trackedSuffixes.has(suffix)) {
                    previewChanged ||= Date.now() - writtenAt > 1000;
                    continue;
                }
                previewChanged ||= !widget.akariPreviewEditUri && change.resource.path.base === 'edit.json';
            }
            if (captionsChanged) {
                this.queueCaptionsUpdate(widget);
            }
            if (previewChanged) {
                this.queueRefresh(widget, identityUri, kind);
            }
        };
        for (const root of await this.workspaceService.roots) {
            disposables.push(await this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        }
        const videoUri = widget.akariPreviewVideoUri;
        if (videoUri && !(await this.isInsideWorkspace(videoUri))) {
            disposables.push(await this.fileService.watch(videoUri.parent, { recursive: true, excludes: [] }));
        }
        if (widget.isDisposed) {
            disposables.dispose();
            return;
        }
        // watch 登録時の初期イベントで、完成直後の HTML をもう一度ロードしない。
        // 実際のファイル変更は全 watch が確立した後から購読する。
        disposables.push(this.fileService.onDidFilesChange(handleFilesChanged));
        widget.disposed.connect(() => {
            disposables.dispose();
            if (previews.get(seekKey) === widget) {
                previews.delete(seekKey);
            }
            void this.disposePreviewStreams(widget);
        });
    }

    protected isPlaybackTickRequest(message: any): message is PreviewPlaybackTickRequest {
        return message?.type === 'akari-preview-playback-tick'
            && Number.isFinite(message.time)
            && typeof message.playing === 'boolean'
            && (message.rate === undefined || (Number.isFinite(message.rate) && message.rate > 0));
    }

    protected forwardPlaybackTick(widget: PreviewWidgetMarker, message: PreviewPlaybackTickRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        const normalizedEditUri = editUri.normalizePath().toString();
        const previous = this.reviewTransportByEdit.get(normalizedEditUri);
        this.reviewTransportByEdit.set(normalizedEditUri, {
            timelineT: message.time,
            playing: message.playing,
            rate: message.rate ?? previous?.rate ?? 1
        });
        this.reviewSessionRecorder?.handlePlaybackTick(normalizedEditUri, message.time, message.playing);
        window.dispatchEvent(new CustomEvent(PREVIEW_PLAYBACK_TICK_EVENT, {
            detail: {
                videoUri: normalizedEditUri,
                time: message.time,
                playing: message.playing
            }
        }));
    }

    protected isReviewTransportRequest(message: any): message is PreviewReviewTransportRequest {
        const event = message?.event;
        if (message?.type !== 'akari-preview-review-transport-event' || !event) {
            return false;
        }
        if ((event.type === 'play' || event.type === 'pause')
            && Number.isFinite(event.timelineT)) {
            return true;
        }
        if (event.type === 'seek' && Number.isFinite(event.from) && Number.isFinite(event.to)) {
            return true;
        }
        return event.type === 'rate' && Number.isFinite(event.value) && event.value > 0
            && Number.isFinite(event.timelineT);
    }

    protected forwardReviewTransport(widget: PreviewWidgetMarker, message: PreviewReviewTransportRequest): void {
        const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
        if (!editUri) {
            return;
        }
        const previous = this.reviewTransportByEdit.get(editUri) ?? {
            timelineT: 0,
            playing: false,
            rate: 1
        };
        const change = message.event;
        if (change.type === 'play' || change.type === 'pause') {
            previous.timelineT = change.timelineT;
            previous.playing = change.type === 'play';
        } else if (change.type === 'seek') {
            previous.timelineT = change.to;
        } else {
            previous.timelineT = change.timelineT;
            previous.rate = change.value;
        }
        this.reviewTransportByEdit.set(editUri, previous);
        this.reviewSessionRecorder?.handleTransport(editUri, change);
    }

    protected isReviewStrokeStartRequest(message: any): message is PreviewReviewStrokeStartRequest {
        const frame = message?.frame;
        return message?.type === 'akari-preview-review-stroke-start'
            && Number.isFinite(frame?.timelineT)
            && Number.isFinite(frame?.sourceT)
            && (frame?.cutIndex === null
                || (Number.isInteger(frame?.cutIndex) && frame.cutIndex >= 0));
    }

    protected forwardReviewStrokeStart(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeStartRequest
    ): void {
        const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeStart(editUri, message.frame);
        }
    }

    protected isReviewStrokeEndRequest(message: any): message is PreviewReviewStrokeEndRequest {
        return message?.type === 'akari-preview-review-stroke-end'
            && Array.isArray(message.points);
    }

    protected forwardReviewStrokeEnd(
        widget: PreviewWidgetMarker,
        message: PreviewReviewStrokeEndRequest
    ): void {
        const editUri = widget.akariPreviewEditUri?.normalizePath().toString();
        if (editUri) {
            this.reviewSessionRecorder?.handleStrokeEnd(editUri, message.points);
        }
    }

    protected isOverlaySelectedRequest(message: any): message is PreviewOverlaySelectedRequest {
        return message?.type === 'akari-preview-overlay-selected'
            && (typeof message.overlayId === 'string' || message.overlayId === null);
    }

    protected forwardOverlaySelection(widget: PreviewWidgetMarker, message: PreviewOverlaySelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_OVERLAY_SELECTED_EVENT, {
            detail: {
                videoUri: editUri.normalizePath().toString(),
                overlayId: message.overlayId
            }
        }));
    }

    protected isLayerSelectedRequest(message: any): message is PreviewLayerSelectedRequest {
        return message?.type === 'akari-preview-layer-selected'
            && (typeof message.layerId === 'string' || message.layerId === null);
    }

    protected forwardLayerSelection(widget: PreviewWidgetMarker, message: PreviewLayerSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_LAYER_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                layerId: message.layerId
            }
        }));
    }

    protected isCutSelectedRequest(message: any): message is PreviewCutSelectedRequest {
        return message?.type === 'akari-preview-cut-selected' && typeof message.selected === 'boolean';
    }

    protected forwardCutSelection(widget: PreviewWidgetMarker, message: PreviewCutSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_CUT_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                selected: message.selected
            }
        }));
    }

    protected isCaptionSelectedRequest(message: any): message is PreviewCaptionSelectedRequest {
        return message?.type === 'akari-preview-caption-selected'
            && (typeof message.captionId === 'string' || message.captionId === null);
    }

    protected forwardCaptionSelection(widget: PreviewWidgetMarker, message: PreviewCaptionSelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_CAPTION_SELECTED_EVENT, {
            detail: {
                editUri: editUri.normalizePath().toString(),
                captionId: message.captionId
            }
        }));
    }

    protected queueRefresh(widget: PreviewWidgetMarker, identityUri: URI, kind: 'raw' | 'output'): void {
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        const refresh = (): Promise<void> => {
            const editUri = kind === 'output' ? widget.akariPreviewEditUri : undefined;
            const transport = editUri
                ? this.reviewTransportByEdit.get(editUri.normalizePath().toString())
                : undefined;
            // 裁定（第13報）: edit.json 起因のリロードは直前の再生状態に関わらず必ず
            // 一時停止で復元する。位置（timelineT）だけは保持する
            return this.refreshPreview(
                widget,
                identityUri,
                kind,
                transport?.timelineT
            );
        };
        widget.akariPreviewRefresh = previous.then(
            refresh,
            refresh
        ).catch(error => console.error('[akari-preview] failed to refresh preview', error));
    }

    // basename + 直上ディレクトリ名からなる比較キー。ワークスペースルートの watcher が
    // realpath() 済みの絶対パスで通知してくる場合でも、シンボリックリンクを跨がない相対的な
    // 末尾は一致するため、tracked リソースの判定をこの suffix でも突き合わせられる。
    protected resourceSuffix(uri: URI): string {
        return `${uri.path.dir.base}/${uri.path.base}`;
    }

    protected queueCaptionsUpdate(widget: PreviewWidgetMarker): void {
        const previous = widget.akariPreviewCaptionsUpdate ?? Promise.resolve();
        widget.akariPreviewCaptionsUpdate = previous.then(async () => {
            const captions = await this.loadPreviewCaptions(widget.akariPreviewCaptionsUri, widget.akariPreviewEditUri);
            widget.sendMessage({ type: 'akari-preview-captions-update', captions });
        }).catch(error => console.error('[akari-preview] failed to update captions', error));
    }

    protected async refreshPreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        if (widget.isDisposed) {
            return;
        }
        const [model, assets] = await Promise.all([
            kind === 'output' ? this.loadPreviewModel(identityUri) : this.loadRawPreviewModel(identityUri),
            this.previewService.getOverlayRuntimeAssets()
        ]);
        const videoUri = kind === 'output' ? model.sourceUri : identityUri;
        if (!videoUri) {
            await this.disposeAssetStreams(model.assetStreamIds);
            throw new Error(`${identityUri.toString()} の source.path を解決できませんでした。`);
        }
        const extension = videoUri.path.ext.toLowerCase();
        const mimeType = PLAYABLE_VIDEO_MIME_TYPES.get(extension);
        if (!mimeType) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, UNSUPPORTED_FORMAT_MESSAGE, identityUri, kind);
            return;
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, OUTSIDE_WORKSPACE_MESSAGE, identityUri, kind);
            return;
        }
        if (widget.isDisposed) {
            await this.disposeAssetStreams(model.assetStreamIds);
            return;
        }
        // HEVC (H.265) sources are unlikely to decode on Windows (see the win portability
        // audit §HEVC プレビュー in the internal repo). streamVideoUri is
        // what actually gets streamed to <video>; videoUri itself (source identity: captions
        // lookup, file watch, seek commands, title) stays untouched below.
        const streamVideoUri = await this.resolveStreamVideoUri(videoUri, model);
        const videoStream = await this.previewService.createVideoStream({
            videoUri: streamVideoUri.toString()
        }).catch(async error => {
            await this.disposeAssetStreams(model.assetStreamIds);
            throw error;
        });
        // v1 マルチソース: 代表ソース以外の cuts[].src 先も webview から再生できるよう
        // それぞれストリームを開く（代表ソースは上の videoStream を再利用）。
        // 全ストリームは同一のローカルサーバ由来なので CSP の media-src は据え置きでよい。
        const extraVideoStreams = new Map<string, { id: string; url: string }>();
        const sourceUrlById: Record<string, string> = {};
        if (kind === 'output' && model.sourcesById) {
            for (const [sourceId, entry] of model.sourcesById) {
                if (model.sourceUri && entry.uri.toString() === model.sourceUri.toString()) {
                    sourceUrlById[sourceId] = videoStream.url;
                    continue;
                }
                if (!PLAYABLE_VIDEO_MIME_TYPES.has(entry.uri.path.ext.toLowerCase())
                    || !(await this.isInsideWorkspace(entry.uri))) {
                    console.warn('[akari-preview] sources[] の素材を再生できません（形式か配置）', entry.uri.toString());
                    continue;
                }
                try {
                    const streamUri = await this.resolveStreamVideoUri(entry.uri, model);
                    const stream = await this.previewService.createVideoStream({ videoUri: streamUri.toString() });
                    extraVideoStreams.set(sourceId, stream);
                    sourceUrlById[sourceId] = stream.url;
                } catch (error) {
                    console.warn('[akari-preview] sources[] のストリームを開けませんでした', entry.uri.toString(), error);
                }
            }
        }
        if (widget.isDisposed) {
            await Promise.all([
                this.disposeVideoStreamId(videoStream.id),
                this.disposeAssetStreams(model.assetStreamIds)
            ]);
            return;
        }
        await this.disposePreviewStreams(widget);
        if (widget.isDisposed) {
            await Promise.all([
                this.disposeVideoStreamId(videoStream.id),
                this.disposeAssetStreams(model.assetStreamIds)
            ]);
            return;
        }
        widget.akariPreviewStreamId = videoStream.id;
        widget.akariPreviewExtraStreamIds = [...extraVideoStreams.values()].map(stream => stream.id);
        widget.akariPreviewAssetStreamIds = model.assetStreamIds;
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewRelatedEditUri = model.relatedEditUri;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewCaptionsUri = model.captionsUri;
        const trackedUris = [
            ...(model.editUri ? [model.editUri] : []),
            ...(model.relatedEditUri ? [model.relatedEditUri] : []),
            ...(model.captionsUri ? [model.captionsUri] : []),
            ...model.overlayUris,
            ...model.assetUris
        ];
        widget.akariPreviewTrackedResources = new Set(trackedUris.map(uri => uri.toString()));
        widget.akariPreviewTrackedSuffixes = new Set(trackedUris.map(uri => this.resourceSuffix(uri)));
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true
        });
        widget.akariPreviewSeekable = true;
        const hasScopedSession = widget.akariPreviewHiddenTracksByScope !== undefined
            || widget.akariPreviewMutedTracksByScope !== undefined
            || widget.akariPreviewAllTracksHiddenScopes !== undefined
            || widget.akariPreviewAllTracksMutedScopes !== undefined;
        if (!hasScopedSession) {
            const hiddenCuts = new Set<number>();
            const hiddenLayers = new Set<number>();
            const mutedCuts = new Set<number>();
            const mutedAudio = new Set<number>();
            model.summary.tracks?.cuts?.forEach((track, index) => {
                if (track.hidden === true) hiddenCuts.add(index);
                if (track.muted === true) mutedCuts.add(index);
            });
            model.summary.tracks?.layers?.forEach((track, index) => {
                if (track.hidden === true) hiddenLayers.add(index);
            });
            model.summary.tracks?.audio?.forEach((track, index) => {
                if (track.muted === true) mutedAudio.add(index);
            });
            widget.akariPreviewHiddenTracksByScope = { cuts: [...hiddenCuts], layers: [...hiddenLayers] };
            widget.akariPreviewMutedTracksByScope = { cuts: [...mutedCuts], audio: [...mutedAudio] };
            widget.akariPreviewAllTracksHiddenScopes = [];
            widget.akariPreviewAllTracksMutedScopes = [];
        }
        model.session = {
            muted: widget.akariPreviewMuted ?? false,
            captionsVisible: widget.akariPreviewCaptionsVisible ?? true,
            hiddenTracks: [...(widget.akariPreviewHiddenTracks ?? new Set<number>())],
            hiddenTracksByScope: {
                cuts: [...(widget.akariPreviewHiddenTracksByScope?.cuts ?? [])],
                layers: [...(widget.akariPreviewHiddenTracksByScope?.layers ?? [])],
                audio: [...(widget.akariPreviewHiddenTracksByScope?.audio ?? [])]
            },
            mutedTracksByScope: {
                cuts: [...(widget.akariPreviewMutedTracksByScope?.cuts ?? [])],
                audio: [...(widget.akariPreviewMutedTracksByScope?.audio ?? [])],
                layers: [...(widget.akariPreviewMutedTracksByScope?.layers ?? [])]
            },
            allTracksHiddenScopes: [...(widget.akariPreviewAllTracksHiddenScopes ?? [])],
            allTracksMutedScopes: [...(widget.akariPreviewAllTracksMutedScopes ?? [])]
        };
        if (model.editUri) {
            this.previewSessionSettings.set(model.editUri.normalizePath().toString(), {
                muted: model.session.muted,
                captionsVisible: model.session.captionsVisible,
                hiddenTracks: new Set(model.session.hiddenTracks),
                hiddenTracksByScope: {
                    cuts: new Set(model.session.hiddenTracksByScope.cuts),
                    layers: new Set(model.session.hiddenTracksByScope.layers),
                    audio: new Set(model.session.hiddenTracksByScope.audio)
                },
                mutedTracksByScope: {
                    cuts: new Set(model.session.mutedTracksByScope.cuts),
                    audio: new Set(model.session.mutedTracksByScope.audio),
                    layers: new Set(model.session.mutedTracksByScope.layers)
                },
                allTracksHiddenByScope: {
                    cuts: model.session.allTracksHiddenScopes.includes('cuts'),
                    layers: model.session.allTracksHiddenScopes.includes('layers'),
                    audio: model.session.allTracksHiddenScopes.includes('audio')
                },
                allTracksMutedByScope: {
                    cuts: model.session.allTracksMutedScopes.includes('cuts'),
                    audio: model.session.allTracksMutedScopes.includes('audio'),
                    layers: model.session.allTracksMutedScopes.includes('layers')
                }
            });
        }
        widget.setHTML(this.prepareHtml(
            videoUri,
            videoStream.url,
            model,
            assets,
            initialSeekTime,
            sourceUrlById
        ));
    }

    // Picks the URI that actually gets streamed to <video>: an explicit edit.json source.proxy
    // wins outright (no ffprobe call — the pipeline already declared it authoritative); otherwise
    // asks the backend to lazily generate/reuse an H.264 proxy when the source probes as HEVC.
    // Blocks refreshPreview() until the RPC settles (no separate "generating…" UI state — see
    // report for the tradeoff). Any failure (ffmpeg/ffprobe missing, generation error, RPC
    // rejection) silently falls back to the original videoUri: worst case is unchanged pre-
    // existing behavior (the <video> error handler's showPlaybackError already covers an
    // undecodable source), never a new failure mode.
    protected async resolveStreamVideoUri(videoUri: URI, model: PreviewModel): Promise<URI> {
        if (model.sourceProxyUri) {
            return model.sourceProxyUri;
        }
        const [workspaceRoot] = await this.workspaceService.roots;
        if (!workspaceRoot) {
            return videoUri;
        }
        try {
            const result = await this.previewService.resolveHevcProxy({
                videoUri: videoUri.toString(),
                projectRootUri: workspaceRoot.resource.toString()
            });
            if (result.status === 'ready') {
                return new URI(result.proxyUri);
            }
            if (result.status === 'unavailable') {
                console.warn(`[akari-preview] HEVC プロキシを生成できませんでした（元動画のまま再生します）: ${result.reason}`);
            }
        } catch (error) {
            console.warn('[akari-preview] HEVC プロキシの解決に失敗しました（元動画のまま再生します）', error);
        }
        return videoUri;
    }

    protected showMessageCard(
        widget: PreviewWidgetMarker,
        videoUri: URI,
        message: string,
        identityUri: URI,
        kind: 'raw' | 'output'
    ): void {
        widget.akariPreviewSeekable = false;
        void this.disposePreviewStreams(widget);
        widget.akariPreviewEditUri = kind === 'output' ? identityUri : undefined;
        widget.akariPreviewRelatedEditUri = undefined;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewCaptionsUri = undefined;
        widget.akariPreviewTrackedResources = new Set(kind === 'output' ? [identityUri.toString()] : []);
        widget.akariPreviewTrackedSuffixes = new Set(kind === 'output' ? [this.resourceSuffix(identityUri)] : []);
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({ allowScripts: false, allowForms: false });
        widget.setHTML(this.prepareMessageHtml(message));
    }

    protected async loadRawPreviewModel(videoUri: URI): Promise<PreviewModel> {
        const relatedEditUri = await this.findEditJson(videoUri);
        return {
            summary: EMPTY_SUMMARY,
            relatedEditUri,
            overlayUris: [],
            assetUris: [],
            assetStreamIds: [],
            captions: []
        };
    }

    protected async loadPreviewModel(editUri: URI): Promise<PreviewModel> {
        const [workspaceRoot] = await this.workspaceService.roots;
        const captionsUri = locatePreviewCaptions(editUri, workspaceRoot?.resource);
        const captions = await this.loadPreviewCaptions(captionsUri, editUri);
        const assetStreams = new Map<string, { id: string; url: string }>();
        const assetUris: URI[] = [];
        let sourceUri: URI | undefined;
        let sourceProxyUri: URI | undefined;
        const sourcesById = new Map<string, { uri: URI; proxyUri?: URI }>();
        try {
            const edit = JSON.parse(await this.readText(editUri));
            // edit.json は v0（単一 source）と v1（sources[] + cuts[].src）の両方が公開契約
            // （packages/schemas/edit.schema.json）。どちらも「id → URI」の表に正規化し、
            // 以降は表引きで扱う。v0 は既定 id 一つだけの表になる。
            const declaredSources: Array<{ id: string; path: unknown; proxy?: unknown }> =
                Array.isArray(edit?.sources)
                    ? edit.sources.map((value: any) => ({
                        id: typeof value?.id === 'string' ? value.id : '',
                        path: value?.path,
                        proxy: value?.proxy
                    }))
                    : [{ id: DEFAULT_SOURCE_ID, path: edit?.source?.path, proxy: edit?.source?.proxy }];
            for (const declared of declaredSources) {
                if (typeof declared.path !== 'string' || !declared.path.trim()) {
                    throw new TypeError(Array.isArray(edit?.sources)
                        ? `edit.json の sources[${declared.id || '?'}].path が不正です。`
                        : 'edit.json の source.path が不正です。');
                }
                if (!declared.id) {
                    throw new TypeError('edit.json の sources[].id が不正です。');
                }
                const uri = this.resolveEditAssetUri(declared.path, editUri);
                let proxyUri: URI | undefined;
                if (typeof declared.proxy === 'string' && declared.proxy.trim()) {
                    const candidate = this.resolveEditAssetUri(declared.proxy, editUri);
                    proxyUri = await this.fileService.exists(candidate) ? candidate : undefined;
                }
                sourcesById.set(declared.id, { uri, ...(proxyUri ? { proxyUri } : {}) });
            }
            const emphasisWords = this.normalizeEmphasisWords(edit?.emphasis_words);
            // 代表ソース（字幕の探索・ファイル監視・タイトル・単一ソース時の従来経路）は
            // 先頭カットが参照するソース。無ければ宣言順の先頭。
            const firstCutSourceId = Array.isArray(edit?.cuts)
                ? edit.cuts.map((cut: any) => cut?.src).find((id: unknown) => typeof id === 'string' && sourcesById.has(id))
                : undefined;
            const primaryId = firstCutSourceId ?? [...sourcesById.keys()][0];
            sourceUri = sourcesById.get(primaryId)?.uri;
            // 宣言済み proxy（v0 sourceV0 / v1 sourceV1 の source.proxy）は上のソース表構築時に
            // 解決済み。存在するときだけ HEVC 検出（refreshPreview）より優先される（読み取り専用・
            // 書き戻さない）。ファイルが無ければ HEVC 検出へ落ちる（baked レイヤーの preview
            // サイドカーが無いときと同じ扱い）。
            sourceProxyUri = sourcesById.get(primaryId)?.proxyUri;
            const isTruthyObject = (value: unknown): boolean => Boolean(value)
                && typeof value === 'object' && !Array.isArray(value);
            const width = this.positiveNumber(edit?.output?.width, EMPTY_SUMMARY.output.width);
            const height = this.positiveNumber(edit?.output?.height, EMPTY_SUMMARY.output.height);
            const cuts: EditSummaryCut[] = [];
            for (const value of Array.isArray(edit?.cuts) ? edit.cuts : []) {
                const inSeconds = this.finiteNumber(value?.in, NaN);
                const outSeconds = this.finiteNumber(value?.out, NaN);
                if (Number.isFinite(inSeconds) && Number.isFinite(outSeconds) && outSeconds > inSeconds) {
                    let speed: number | undefined;
                    if (value?.speed !== undefined) {
                        if (typeof value.speed === 'number' && Number.isFinite(value.speed) && value.speed > 0) {
                            speed = value.speed;
                        } else {
                            console.warn('[akari-preview] cut.speed を無視しました（正の有限 number ではありません）', value.speed);
                        }
                    }
                    let transitionOut: EditSummaryCut['transitionOut'];
                    if (value?.transition_out !== undefined && value.transition_out !== null) {
                        const transition = value.transition_out;
                        const validType = transition?.type === 'dissolve'
                            || transition?.type === 'fade-black'
                            || transition?.type === 'fade-white';
                        const validDuration = typeof transition?.duration === 'number'
                            && Number.isFinite(transition.duration) && transition.duration > 0;
                        if (transition && typeof transition === 'object' && !Array.isArray(transition)
                            && validType && validDuration) {
                            transitionOut = { type: transition.type, duration: transition.duration };
                        } else {
                            console.warn('[akari-preview] cut.transition_out を無視しました（type/duration 不正）', transition);
                        }
                    }
                    const at = typeof value?.at === 'number' && Number.isFinite(value.at) && value.at >= 0
                        ? value.at : undefined;
                    const track = Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0;
                    // v1 は cuts[].src がソース id。未知 id / 未指定（v0）は代表ソースへ寄せる
                    const cutSourceId = typeof value?.src === 'string' && sourcesById.has(value.src)
                        ? value.src : primaryId;
                    if (typeof value?.src === 'string' && !sourcesById.has(value.src)) {
                        console.warn('[akari-preview] cut.src が sources[] に見つかりません。代表ソースで代用します', value.src);
                    }
                    cuts.push({
                        src: cutSourceId,
                        in: inSeconds,
                        out: outSeconds,
                        ...(value?.transform && typeof value.transform === 'object' && !Array.isArray(value.transform)
                            ? { transform: this.transform(value.transform) } : {}),
                        ...(typeof value?.opacity === 'number' && Number.isFinite(value.opacity)
                            && value.opacity >= 0 && value.opacity <= 1 ? { opacity: value.opacity } : {}),
                        ...(speed !== undefined ? { speed } : {}),
                        ...(transitionOut ? { transitionOut } : {}),
                        ...(at !== undefined ? { at } : {}),
                        ...(isTruthyObject(value?.framing) ? { framing: value.framing as CutFraming } : {}),
                        ...(isTruthyObject(value?.freeze) ? { freeze: value.freeze as CutFreeze } : {}),
                        track
                    });
                } else {
                    console.warn('[akari-preview] cuts entry を無視しました（in/out 不正）', value);
                }
            }
            const overlays: EditSummaryOverlay[] = [];
            const overlayUris: URI[] = [];
            for (const value of Array.isArray(edit?.overlays) ? edit.overlays : []) {
                if (value?.track !== undefined && (!Number.isInteger(value.track) || value.track < 0)) {
                    console.warn('[akari-preview] overlay track が不正なため track 0 として表示します', value?.id);
                }
                const rawHtml = typeof value?.html === 'string' ? value.html : '';
                let html = rawHtml;
                if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
                    const fragmentUri = editUri.parent.resolve(rawHtml);
                    overlayUris.push(fragmentUri);
                    try {
                        html = await this.readText(fragmentUri);
                    } catch (error) {
                        html = '';
                        console.warn(`[akari-preview] failed to read overlay fragment ${fragmentUri.toString()}`, error);
                    }
                }
                html = await this.resolveThreeSceneAssets(html, editUri, assetStreams, assetUris);
                overlays.push({
                    id: String(value?.id ?? ''),
                    html,
                    start: this.finiteNumber(value?.start, 0),
                    duration: this.finiteNumber(value?.duration, 0),
                    track: Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0,
                    transform: this.transform(value?.transform),
                    vars: this.stringRecord(value?.vars)
                });
            }
            const layers: EditSummaryLayer[] = [];
            let unsupportedBlendCount = 0;
            for (let index = 0; index < (Array.isArray(edit?.layers) ? edit.layers.length : 0); index += 1) {
                const value = edit.layers[index];
                const label = `layers[${index}]`;
                const validObject = value && typeof value === 'object' && !Array.isArray(value);
                const validId = typeof value?.id === 'string' && Boolean(value.id.trim());
                const validT = typeof value?.t === 'number' && Number.isFinite(value.t) && value.t >= 0;
                const validDuration = typeof value?.duration === 'number'
                    && Number.isFinite(value.duration) && value.duration > 0;
                const validKind = value?.kind === 'baked' || value?.kind === 'video';
                const validSrc = typeof value?.src === 'string' && Boolean(value.src.trim());
                if (!validObject || !validId || !validT || !validDuration || !validKind || !validSrc) {
                    console.warn(`[akari-preview] ${label} を無視しました（id/t/duration/kind/src 不正）`, value);
                    continue;
                }

                let opacity = 1;
                if (value.opacity !== undefined) {
                    if (typeof value.opacity === 'number' && Number.isFinite(value.opacity)
                        && value.opacity >= 0 && value.opacity <= 1) {
                        opacity = value.opacity;
                    } else {
                        console.warn(`[akari-preview] ${label}.opacity は 1 で近似します（0〜1 の有限 number ではありません）`, value.opacity);
                    }
                }
                let blend = 'normal';
                if (value.blend !== undefined) {
                    const mapped = typeof value.blend === 'string'
                        ? LAYER_BLEND_TO_CSS.get(value.blend)
                        : undefined;
                    if (mapped) {
                        blend = mapped;
                    } else {
                        unsupportedBlendCount += 1;
                        console.warn(`[akari-preview] ${label}.blend は normal で近似します（未対応値）`, value.blend);
                    }
                }

                const base: Omit<EditSummaryLayer, 'src' | 'proxyMissing'> = {
                    id: value.id,
                    t: value.t,
                    duration: value.duration,
                    kind: value.kind,
                    track: Number.isInteger(value.track) && value.track >= 0 ? value.track : 0,
                    transform: this.transform(value.transform),
                    opacity,
                    blend,
                    chromaKey: value.kind === 'video' && isTruthyObject(value.chroma_key)
                };
                let sourceUri: URI;
                try {
                    sourceUri = this.resolveEditAssetUri(value.src, editUri);
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（src を解決できません）`, error);
                    continue;
                }
                if (value.kind === 'baked') {
                    const sidecarUri = this.previewProxyUri(sourceUri);
                    if (!assetUris.some(uri => uri.toString() === sidecarUri.toString())) {
                        assetUris.push(sidecarUri);
                    }
                    let src: string | undefined;
                    try {
                        if (await this.fileService.exists(sidecarUri)) {
                            const key = sidecarUri.toString();
                            let stream = assetStreams.get(key);
                            if (!stream) {
                                stream = await this.previewService.createAssetStream({ assetUri: key });
                                assetStreams.set(key, stream);
                            }
                            src = stream.url;
                        }
                    } catch (error) {
                        console.warn(`[akari-preview] ${label} の preview proxy を配信できません`, error);
                    }
                    layers.push({ ...base, ...(src ? { src } : {}), proxyMissing: !src });
                    continue;
                }

                try {
                    const key = sourceUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(sourceUri);
                    }
                    layers.push({ ...base, src: stream.url, proxyMissing: false });
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（video レイヤーを配信できません）`, error);
                }
            }
            const normalizeTrackStates = (value: unknown): EditSummaryTrackState[] | undefined => {
                if (!Array.isArray(value)) {
                    return undefined;
                }
                return value.map(item => {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        return {};
                    }
                    const state = item as { muted?: unknown; hidden?: unknown };
                    return {
                        ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
                        ...(typeof state.hidden === 'boolean' ? { hidden: state.hidden } : {})
                    };
                });
            };
            const rawTracks = edit?.tracks && typeof edit.tracks === 'object' && !Array.isArray(edit.tracks)
                ? edit.tracks : undefined;
            const cutTracks = normalizeTrackStates(rawTracks?.cuts);
            const layerTracks = normalizeTrackStates(rawTracks?.layers);
            const audioTracks = normalizeTrackStates(rawTracks?.audio);
            const tracks: EditSummaryTracks | undefined = cutTracks || layerTracks || audioTracks ? {
                ...(cutTracks ? { cuts: cutTracks } : {}),
                ...(layerTracks ? { layers: layerTracks } : {}),
                ...(audioTracks ? { audio: audioTracks } : {})
            } : undefined;
            const timelineTracks: EditSummaryTimelineTrack[] | undefined = Array.isArray(edit?.timeline?.tracks)
                ? edit.timeline.tracks.flatMap((value: unknown) => {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) {
                        return [];
                    }
                    const track = value as { kind?: unknown; ref?: unknown };
                    const validKind = track.kind === 'cuts' || track.kind === 'layers'
                        || track.kind === 'overlays' || track.kind === 'captions' || track.kind === 'audio';
                    if (!validKind) {
                        return [];
                    }
                    return [{
                        kind: track.kind,
                        ...(Number.isInteger(track.ref) && Number(track.ref) >= 0
                            ? { ref: Number(track.ref) } : {})
                    }];
                })
                : undefined;
            const audio = await this.resolveAudioAssets(edit?.audio, editUri, assetStreams, assetUris);
            const indicators: string[] = [];
            if (isTruthyObject(edit?.output?.look)) indicators.push('LUT');
            if (isTruthyObject(edit?.source?.chroma_key)
                || (Array.isArray(edit?.sources) && edit.sources.some((source: unknown) =>
                    isTruthyObject((source as { chroma_key?: unknown } | null)?.chroma_key)))
                || (Array.isArray(edit?.layers) && edit.layers.some((layer: unknown) =>
                    isTruthyObject((layer as { chroma_key?: unknown } | null)?.chroma_key)))) {
                indicators.push('クロマキー');
            }
            const missingProxyCount = layers.filter(layer => layer.kind === 'baked' && layer.proxyMissing).length;
            if (missingProxyCount > 0) {
                indicators.push(`テロップ ${missingProxyCount}枚（プレビュー用プロキシ未生成）`);
            }
            if (unsupportedBlendCount > 0) {
                indicators.push(`素材合成モードが未対応（${unsupportedBlendCount}件、normal で近似）`);
            }
            if (isTruthyObject(edit?.audio?.master)) indicators.push('音声マスター処理');
            if (Array.isArray(edit?.cuts) && edit.cuts.some((cut: unknown) =>
                (cut as { transition_out?: { type?: unknown } } | null)?.transition_out?.type === 'dissolve')) {
                indicators.push('ディゾルブ切り替え');
            }
            return {
                editUri,
                sourceUri,
                sourceProxyUri,
                sourcesById,
                overlayUris,
                assetUris,
                assetStreamIds: [...assetStreams.values()].map(stream => stream.id),
                captionsUri,
                captions,
                emphasisWords,
                summary: {
                    output: { width, height, fps: this.positiveNumber(edit?.output?.fps, 30) },
                    overlays,
                    layers,
                    cuts,
                    indicators,
                    ...(audio ? { audio } : {}),
                    ...(tracks ? { tracks } : {}),
                    ...(timelineTracks ? { timelineTracks } : {}),
                    ...(Array.isArray(edit?.captions) && edit.captions.length > 0
                        ? { hasInlineCaptions: true } : {})
                }
            };
        } catch (error) {
            await this.disposeAssetStreams([...assetStreams.values()].map(stream => stream.id));
            if (!sourceUri) {
                throw error;
            }
            console.warn(`[akari-preview] failed to load composite data from ${editUri.toString()}; opening source only`, error);
            return {
                editUri,
                sourceUri,
                sourceProxyUri,
                sourcesById,
                summary: EMPTY_SUMMARY,
                overlayUris: [],
                assetUris: [],
                assetStreamIds: [],
                captionsUri,
                captions
            };
        }
    }

    protected async resolveAudioAssets(
        value: unknown,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[]
    ): Promise<EditSummaryAudio | undefined> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            if (value !== undefined) {
                console.warn('[akari-preview] audio セクションを無視しました（object ではありません）');
            }
            return undefined;
        }
        const audio = value as { bgm?: unknown; sfx?: unknown; narration?: unknown };
        const resolveSource = async (pathValue: unknown, label: string): Promise<string | undefined> => {
            if (typeof pathValue !== 'string' || !pathValue.trim()) {
                console.warn(`[akari-preview] ${label} を無視しました（path 不正）`);
                return undefined;
            }
            const assetUri = this.resolveEditAssetUri(pathValue, editUri);
            const key = assetUri.toString();
            try {
                let stream = assetStreams.get(key);
                if (!stream) {
                    stream = await this.previewService.createAssetStream({ assetUri: key });
                    assetStreams.set(key, stream);
                    assetUris.push(assetUri);
                }
                return stream.url;
            } catch (error) {
                console.warn(`[akari-preview] ${label} を無視しました（音声ファイルを配信できません）`, error);
                return undefined;
            }
        };
        const gainDb = (gainValue: unknown, label: string): number | undefined => {
            if (gainValue === undefined) {
                return 0;
            }
            if (typeof gainValue !== 'number' || !Number.isFinite(gainValue)) {
                console.warn(`[akari-preview] ${label} を無視しました（gain_db が非有限または number ではありません）`);
                return undefined;
            }
            const clamped = Math.max(-60, Math.min(12, gainValue));
            if (clamped !== gainValue) {
                console.warn(`[akari-preview] ${label}.gain_db を [-60, 12] にクランプしました`, gainValue);
            }
            return clamped;
        };
        const timed = async (items: unknown, kind: 'sfx' | 'narration'): Promise<EditSummaryTimedAudio[]> => {
            if (items === undefined) {
                return [];
            }
            if (!Array.isArray(items)) {
                console.warn(`[akari-preview] audio.${kind} を無視しました（array ではありません）`);
                return [];
            }
            const resolved: EditSummaryTimedAudio[] = [];
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index] as {
                    id?: unknown;
                    path?: unknown;
                    t?: unknown;
                    gain_db?: unknown;
                    track?: unknown;
                    in?: unknown;
                    out?: unknown;
                } | undefined;
                const label = kind === 'narration' && typeof item?.id === 'string' && item.id
                    ? `audio.narration ${item.id}`
                    : `audio.${kind}[${index}]`;
                if (!item || typeof item !== 'object') {
                    console.warn(`[akari-preview] ${label} を無視しました（object ではありません）`);
                    continue;
                }
                if (kind === 'narration' && (typeof item.id !== 'string' || !item.id)) {
                    console.warn(`[akari-preview] ${label} を無視しました（id 不正）`);
                    continue;
                }
                if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) {
                    console.warn(`[akari-preview] ${label} を無視しました（t が非有限・負値・number ではありません）`);
                    continue;
                }
                const normalizedGain = gainDb(item.gain_db, label);
                if (normalizedGain === undefined) {
                    continue;
                }
                const src = await resolveSource(item.path, label);
                if (!src) {
                    continue;
                }
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx-only playback window
                // (material's [in, out)). Malformed values are warned-and-ignored (treated as
                // omitted) rather than dropping the whole item, matching gain_db/fadeIn/fadeOut's
                // existing tolerance pattern in this function. Real-duration clamping (実尺越え) can
                // only happen once the buffer is decoded, so it happens later in decodeOne.
                let trimIn: number | undefined;
                let trimOut: number | undefined;
                if (kind === 'sfx') {
                    if (item.in !== undefined) {
                        if (typeof item.in === 'number' && Number.isFinite(item.in) && item.in >= 0) {
                            trimIn = item.in;
                        } else {
                            console.warn(`[akari-preview] ${label}.in を無視しました（0以上の有限 number ではありません）`, item.in);
                        }
                    }
                    if (item.out !== undefined) {
                        if (typeof item.out === 'number' && Number.isFinite(item.out) && item.out > 0) {
                            trimOut = item.out;
                        } else {
                            console.warn(`[akari-preview] ${label}.out を無視しました（0より大きい有限 number ではありません）`, item.out);
                        }
                    }
                }
                resolved.push({
                    id: kind === 'narration' ? String(item.id) : `sfx-${index + 1}`,
                    src,
                    t: item.t,
                    gainDb: normalizedGain,
                    ...(kind === 'sfx'
                        ? {
                            track: Number.isInteger(item.track) && (item.track as number) >= 0 ? item.track as number : 0,
                            ...(trimIn !== undefined ? { in: trimIn } : {}),
                            ...(trimOut !== undefined ? { out: trimOut } : {})
                        }
                        : {})
                });
            }
            return resolved;
        };

        let bgm: EditSummaryBgm | undefined;
        if (audio.bgm !== undefined) {
            const rawBgm = audio.bgm as {
                path?: unknown;
                gain_db?: unknown;
                ducking?: unknown;
                fadeIn?: unknown;
                fadeOut?: unknown;
                in?: unknown;
            } | undefined;
            if (!rawBgm || typeof rawBgm !== 'object' || Array.isArray(rawBgm)) {
                console.warn('[akari-preview] audio.bgm を無視しました（object ではありません）');
            } else {
                const normalizedGain = gainDb(rawBgm.gain_db, 'audio.bgm');
                if (normalizedGain !== undefined) {
                    const fades: Pick<EditSummaryBgm, 'fadeIn' | 'fadeOut'> = {};
                    for (const [field, raw] of [['fadeIn', rawBgm.fadeIn], ['fadeOut', rawBgm.fadeOut]] as const) {
                        if (raw === undefined) {
                            continue;
                        }
                        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
                            fades[field] = raw;
                        } else {
                            console.warn(`[akari-preview] audio.bgm.${field} を無視しました（0以上の有限 number ではありません）`, raw);
                        }
                    }
                    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: file-internal start
                    // offset (素材秒). 実尺越え (in >= real duration) can only be checked once the
                    // buffer is decoded, so that clamp happens later in decodeOne.
                    let bgmIn: number | undefined;
                    if (rawBgm.in !== undefined) {
                        if (typeof rawBgm.in === 'number' && Number.isFinite(rawBgm.in) && rawBgm.in >= 0) {
                            bgmIn = rawBgm.in;
                        } else {
                            console.warn('[akari-preview] audio.bgm.in を無視しました（0以上の有限 number ではありません）', rawBgm.in);
                        }
                    }
                    const src = await resolveSource(rawBgm.path, 'audio.bgm');
                    if (src) {
                        bgm = {
                            src,
                            gainDb: normalizedGain,
                            ducking: rawBgm.ducking === true,
                            ...fades,
                            ...(bgmIn !== undefined ? { in: bgmIn } : {})
                        };
                    }
                }
            }
        }
        const sfx = await timed(audio.sfx, 'sfx');
        const narration = await timed(audio.narration, 'narration');
        if (!bgm && sfx.length === 0 && narration.length === 0) {
            return undefined;
        }
        return { bgm, sfx, narration };
    }

    protected async resolveThreeSceneAssets(
        html: string,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[]
    ): Promise<string> {
        if (!html.includes('data-akari-3d-scene')) {
            return html;
        }
        const document = new DOMParser().parseFromString(html, 'text/html');
        const declarations = document.body.querySelectorAll(
            'script[type="application/json"][data-akari-3d-scene]'
        );
        if (declarations.length === 0) {
            return html;
        }
        if (declarations.length !== 1) {
            for (const declaration of Array.from(declarations)) {
                declaration.textContent = JSON.stringify({ model: '' });
            }
            console.warn('[akari-preview] 3D overlay には data-akari-3d-scene 宣言が 1 個必要です');
            return document.body.innerHTML;
        }
        for (const declaration of Array.from(declarations)) {
            try {
                const descriptor = JSON.parse(declaration.textContent || '{}');
                if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
                    || typeof descriptor.model !== 'string' || !descriptor.model) {
                    throw new TypeError('data-akari-3d-scene.model は edit.json 相対の .glb パスである必要があります');
                }
                if (Object.keys(descriptor).some(key => !THREE_SCENE_KEYS.has(key))) {
                    throw new TypeError('data-akari-3d-scene に未対応の top-level key があります');
                }
                const resolveAsset = async (relativePath: string, field: string): Promise<string> => {
                    if (relativePath.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relativePath)) {
                        throw new TypeError(`${field} に絶対パスや URL は指定できません`);
                    }
                    const assetUri = editUri.parent.resolve(relativePath);
                    const key = assetUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(assetUri);
                    }
                    return stream.url;
                };
                descriptor.model = await resolveAsset(descriptor.model, 'data-akari-3d-scene.model');
                if (descriptor.environment?.map !== undefined) {
                    if (typeof descriptor.environment.map !== 'string' || !descriptor.environment.map) {
                        throw new TypeError('environment.map は正距円筒画像の相対パスである必要があります');
                    }
                    descriptor.environment.map = await resolveAsset(
                        descriptor.environment.map,
                        'data-akari-3d-scene.environment.map'
                    );
                }
                if (descriptor.materialOverrides !== undefined) {
                    if (!descriptor.materialOverrides
                        || typeof descriptor.materialOverrides !== 'object'
                        || Array.isArray(descriptor.materialOverrides)) {
                        throw new TypeError('materialOverrides は object である必要があります');
                    }
                    for (const [materialName, override] of Object.entries(descriptor.materialOverrides)) {
                        if (!materialName
                            || !override
                            || typeof override !== 'object'
                            || Array.isArray(override)
                            || Object.keys(override).some(key => key !== 'texture')
                            || typeof (override as { texture?: unknown }).texture !== 'string'
                            || !(override as { texture: string }).texture) {
                            throw new TypeError('materialOverrides は material 名ごとに texture 相対パスを指定してください');
                        }
                        const typedOverride = override as { texture: string };
                        typedOverride.texture = await resolveAsset(
                            typedOverride.texture,
                            `materialOverrides.${materialName}.texture`
                        );
                    }
                }
                declaration.textContent = JSON.stringify(descriptor).replace(/</g, '\\u003c');
            } catch (error) {
                declaration.textContent = JSON.stringify({ model: '' });
                console.warn('[akari-preview] failed to resolve declarative 3D scene asset', error);
            }
        }
        return document.body.innerHTML;
    }

    protected async loadPreviewCaptions(captionsUri: URI | undefined, editUri?: URI): Promise<PreviewCaption[]> {
        if (!captionsUri) {
            return [];
        }
        try {
            if (editUri) {
                const resolved = await this.previewService.resolveCaptionDisplay({
                    captionsUri: captionsUri.toString(),
                    editUri: editUri.toString()
                });
                if (resolved) return parseResolvedPreviewCaptions(resolved);
            }
            return parsePreviewCaptions(await this.readText(captionsUri));
        } catch (error) {
            if (await this.fileService.exists(captionsUri)) {
                console.warn(`[akari-preview] failed to load ${captionsUri.toString()}; hiding captions`, error);
            }
            return [];
        }
    }

    protected async findEditJson(videoUri: URI): Promise<URI | undefined> {
        const adjacent = videoUri.parent.resolve('edit.json');
        if (await this.fileService.exists(adjacent)) {
            return adjacent;
        }

        for (const root of await this.workspaceService.roots) {
            const candidates = await this.findNamedFiles(root.resource, 'edit.json');
            for (const candidate of candidates) {
                try {
                    const parsed = JSON.parse(await this.readText(candidate));
                    if (typeof parsed?.source?.path === 'string'
                        && this.pathBase(parsed.source.path) === videoUri.path.base) {
                        return candidate;
                    }
                } catch {
                    // Invalid candidates do not prevent later edit.json files from matching.
                }
            }
        }
        return undefined;
    }

    protected async findNamedFiles(directory: URI, name: string): Promise<URI[]> {
        const found: URI[] = [];
        const visit = async (uri: URI): Promise<void> => {
            let stat: FileStat;
            try {
                stat = await this.fileService.resolve(uri);
            } catch {
                return;
            }
            if (stat.isFile) {
                if (stat.resource.path.base === name) {
                    found.push(stat.resource);
                }
                return;
            }
            const children = [...(stat.children ?? [])]
                // ドット始まりは一律飛ばす（isSkippedSearchDirectory = ドット始まり + node_modules）。
                // 実害 2 系統（いずれも 2026-08-04 実機）: (1) .claude のスキル同梱フィクスチャの
                // edit.json を拾って謎タイムラインが開く (2) .backups / .pretest-* 等の
                // バックアップ置き場を拾ってタイムラインとプレビューが別ファイルに割れる
                .filter(child => !isSkippedSearchDirectory(child.resource.path.base))
                .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
            for (const child of children) {
                await visit(child.resource);
            }
        };
        await visit(directory);
        return found;
    }

    protected async handleOverlayWrite(widget: PreviewWidgetMarker, request: OverlayWriteRequest): Promise<void> {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: '編集中の edit.json がありません'
            });
            return;
        }
        try {
            const edit = JSON.parse(await this.readText(editUri));
            if (!Array.isArray(edit?.overlays)) {
                throw new Error('edit.json の overlays が配列ではありません');
            }
            const overlay = edit.overlays.find((value: any) => String(value?.id) === request.overlayId);
            if (!overlay) {
                throw new Error(`オーバーレイが見つかりません: ${request.overlayId}`);
            }
            // 断片テキスト編集の html patch は overlays[].html が指す断片ファイルへ書く。
            // 旧実装はここで html を黙って捨てて ok を返しており、contenteditable の編集が
            // どのサーフェスでも一度も永続化されていなかった（edit.json へマージすると
            // lint「html does not resolve to a regular file」で弾かれる — 契約上ファイル参照）
            if (typeof request.patch.html === 'string') {
                if (!request.patch.html.trim()) {
                    throw new Error('html が空です');
                }
                if (typeof overlay.html !== 'string' || !overlay.html) {
                    throw new Error(`overlays[].html がファイル参照ではありません: ${request.overlayId}`);
                }
                const projectRoot = editUri.parent;
                const htmlPath = String(overlay.html);
                // URI.resolve は '..' を正規化しない可能性があるため、セグメント検査で先に弾く
                if (htmlPath.startsWith('/') || htmlPath.split(/[\\/]/).some(segment => segment === '..')) {
                    throw new Error('プロジェクト外への書き込みは拒否しました');
                }
                const target = projectRoot.resolve(htmlPath);
                if (!`${target.toString()}/`.startsWith(`${projectRoot.toString()}/`)) {
                    throw new Error('プロジェクト外への書き込みは拒否しました');
                }
                if (!(await this.fileService.exists(target))) {
                    throw new Error(`断片ファイルがありません: ${overlay.html}`);
                }
                this.recentWrites.set(target.toString(), Date.now());
                await this.fileService.writeFile(target, BinaryBuffer.fromString(request.patch.html));
            }
            if (request.patch.vars) {
                overlay.vars = { ...this.objectRecord(overlay.vars), ...request.patch.vars };
            }
            if (request.patch.transform) {
                overlay.transform = { ...this.objectRecord(overlay.transform), ...request.patch.transform };
            }
            if (request.patch.vars || request.patch.transform) {
                const candidateText = `${JSON.stringify(edit, undefined, 2)}\n`;
                const lintResult = await this.previewService.lintEditCandidate({
                    editUri: editUri.toString(),
                    candidateText
                });
                if (!lintResult.pass) {
                    widget.sendMessage({
                        type: 'akari-preview-overlay-write-response',
                        requestId: request.requestId,
                        ok: false,
                        error: lintResult.errors[0] ?? 'edit-lint が変更を拒否しました'
                    });
                    return;
                }
                this.recentWrites.set(editUri.toString(), Date.now());
                await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            }
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: true
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isOverlayWriteRequest(message: any): message is OverlayWriteRequest {
        return message?.type === 'akari-preview-overlay-write'
            && typeof message.requestId === 'string'
            && typeof message.overlayId === 'string'
            && message.patch
            && typeof message.patch === 'object';
    }

    // CF-write: layerTransform の schema 定義（edit.schema.json #layerTransform — x/y/rotate は数値・
    // scale は正の数）と同じ制約をここで先に弾く。edit-lint（呼び出しのみ）は layers[].transform の
    // 数値レンジまでは検証しないため、この事前チェックが実質的な「不正値は書き込まない」の担保になる。
    protected validateLayerTransformPatch(patch: OverlayTransform | undefined): string | undefined {
        if (!patch) {
            return undefined;
        }
        for (const field of ['x', 'y', 'rotate'] as const) {
            if (field in patch && !Number.isFinite(patch[field])) {
                return `transform.${field} は有限数値である必要があります。`;
            }
        }
        if ('scale' in patch && !(Number.isFinite(patch.scale) && (patch.scale as number) > 0)) {
            return 'transform.scale は正の数である必要があります。';
        }
        return undefined;
    }

    // ㉔ layers[].crop の schema 定義（edit.schema.json #layerCrop — 0..1 正規化・x+w<=1・y+h<=1）と
    // 同じ制約をここで先に弾く（validateLayerTransformPatch と同じ「不正値は書き込まない」の担保）。
    protected validateLayerCropPatch(patch: LayerCropPatch | undefined): string | undefined {
        if (!patch) {
            return undefined;
        }
        for (const field of ['x', 'y'] as const) {
            if (!Number.isFinite(patch[field]) || patch[field] < 0 || patch[field] > 1) {
                return `crop.${field} は 0 から 1 の範囲の有限数である必要があります。`;
            }
        }
        for (const field of ['w', 'h'] as const) {
            if (!Number.isFinite(patch[field]) || patch[field] <= 0 || patch[field] > 1) {
                return `crop.${field} は 0 より大きく 1 以下の有限数である必要があります。`;
            }
        }
        if (patch.x + patch.w > 1 + 1e-9) {
            return 'crop.x + crop.w は 1 以下である必要があります。';
        }
        if (patch.y + patch.h > 1 + 1e-9) {
            return 'crop.y + crop.h は 1 以下である必要があります。';
        }
        return undefined;
    }

    // ㉖ layers[].perspective の schema 定義（edit.schema.json #layerPerspective — corners は
    // [TL,TR,BL,BR] の 4 要素・各 [x,y] は 0..1）と同じ制約をここで先に弾く。patch.perspective ===
    // null（明示的な解除）は常に有効。退化四角形（面積がほぼ 0）の拒否も
    // packages/schemas/bin/validate-edit.mjs の validateLayerPerspective と同じシューレース公式で
    // 揃える（意図的なコード重複 — 検収ゲートを edit-lint に一本化する契約どおり、ここでの拒否は
    // 「早期に分かりやすいエラーを返す」ための先弾きであり、真の正本は edit-lint 経由の schema 検証）。
    protected validateLayerPerspectivePatch(patch: LayerPerspectivePatch | null | undefined): string | undefined {
        if (patch === undefined || patch === null) {
            return undefined;
        }
        const corners = patch.corners;
        if (!Array.isArray(corners) || corners.length !== 4) {
            return 'perspective.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります。';
        }
        const names = ['TL', 'TR', 'BL', 'BR'];
        for (let i = 0; i < 4; i += 1) {
            const corner = corners[i];
            if (!Array.isArray(corner) || corner.length !== 2) {
                return `perspective.corners[${i}] (${names[i]}) は [x, y] の 2 要素配列である必要があります。`;
            }
            const [x, y] = corner;
            if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
                return `perspective.corners[${i}] (${names[i]}) は 0 から 1 の範囲の有限数である必要があります。`;
            }
        }
        const [tl, tr, bl, br] = corners;
        const ring = [tl, tr, br, bl];
        let area2 = 0;
        for (let i = 0; i < ring.length; i += 1) {
            const [x1, y1] = ring[i];
            const [x2, y2] = ring[(i + 1) % ring.length];
            area2 += x1 * y2 - x2 * y1;
        }
        if (Math.abs(area2) < 1e-4) {
            return 'perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。';
        }
        return undefined;
    }

    protected async handleLayerWrite(widget: PreviewWidgetMarker, request: LayerWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-layer-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            respond(false, '編集中の edit.json がありません');
            return;
        }
        const validationError = this.validateLayerTransformPatch(request.patch.transform)
            ?? this.validateLayerCropPatch(request.patch.crop)
            ?? this.validateLayerPerspectivePatch(request.patch.perspective);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const edit = JSON.parse(originalText);
            if (!Array.isArray(edit?.layers)) {
                throw new Error('edit.json の layers が配列ではありません');
            }
            const layer = edit.layers.find((value: any) => String(value?.id) === request.layerId);
            if (!layer) {
                throw new Error(`素材が見つかりません: ${request.layerId}`);
            }
            if (request.patch.transform) {
                layer.transform = { ...this.objectRecord(layer.transform), ...request.patch.transform };
            }
            if (request.patch.crop) {
                layer.crop = { ...request.patch.crop };
            }
            if (request.patch.perspective !== undefined) {
                // null = explicit clear (removes layer.perspective entirely, matching the
                // schema's "absent = no perspective, byte-identical render" default).
                if (request.patch.perspective === null) {
                    delete layer.perspective;
                } else {
                    layer.perspective = { corners: request.patch.perspective.corners.map(([x, y]) => [x, y]) };
                }
            }
            const candidateText = `${JSON.stringify(edit, undefined, 2)}\n`;
            const lintResult = await this.previewService.lintEditCandidate({
                editUri: editUri.toString(),
                candidateText
            });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.recentWrites.set(editUri.toString(), Date.now());
            await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    // ㉓ layerWrite（上）と同型。cutIndex は segments[].cutIndex（cuts[] の実インデックス）を
    // クリック時点でプレビュー側が dataset に記録したもの（webview 側 applyCutVisual 参照）。
    protected async handleCutWrite(widget: PreviewWidgetMarker, request: CutWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-cut-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            respond(false, '編集中の edit.json がありません');
            return;
        }
        const validationError = this.validateLayerTransformPatch(request.patch.transform);
        if (validationError) {
            respond(false, validationError);
            return;
        }
        try {
            const originalText = await this.readText(editUri);
            const edit = JSON.parse(originalText);
            if (!Array.isArray(edit?.cuts)) {
                throw new Error('edit.json の cuts が配列ではありません');
            }
            const cut = edit.cuts[request.cutIndex];
            if (!cut || typeof cut !== 'object') {
                throw new Error(`カットが見つかりません: index ${request.cutIndex}`);
            }
            if (request.patch.transform) {
                cut.transform = { ...this.objectRecord(cut.transform), ...request.patch.transform };
            }
            const candidateText = `${JSON.stringify(edit, undefined, 2)}\n`;
            const lintResult = await this.previewService.lintEditCandidate({
                editUri: editUri.toString(),
                candidateText
            });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.recentWrites.set(editUri.toString(), Date.now());
            await this.fileService.writeFile(editUri, BinaryBuffer.fromString(candidateText));
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected isCutWriteRequest(message: any): message is CutWriteRequest {
        return message?.type === 'akari-preview-cut-write'
            && typeof message.requestId === 'string'
            && Number.isInteger(message.cutIndex)
            && message.cutIndex >= 0
            && message.patch
            && typeof message.patch === 'object';
    }

    // ㉓ layerWrite/cutWrite と同型だが対象ファイルは captions.json（edit.json ではない）。
    // text_style.zone のみをフィールド単位で上書き（他フィールド・他キャプションは無傷）。
    // captions.json は array ルート / {captions:[...], default_text_style} object ルートの
    // どちらも許容（schemas/captions.schema.json oneOf）ため両形を読む。
    protected async handleCaptionWrite(widget: PreviewWidgetMarker, request: CaptionWriteRequest): Promise<void> {
        const respond = (ok: boolean, error?: string): void => {
            widget.sendMessage({
                type: 'akari-preview-caption-write-response',
                requestId: request.requestId,
                ok,
                ...(error ? { error } : {})
            });
        };
        const captionsUri = widget.akariPreviewCaptionsUri;
        if (!captionsUri) {
            respond(false, '字幕ファイル（captions.json）がありません');
            return;
        }
        if (!(CAPTION_ZONES as readonly string[]).includes(request.patch.zone)) {
            respond(false, `不正な zone です: ${request.patch.zone}`);
            return;
        }
        try {
            const originalText = await this.readText(captionsUri);
            const root = JSON.parse(originalText);
            const list = Array.isArray(root)
                ? root
                : (root && typeof root === 'object' && Array.isArray(root.captions) ? root.captions : undefined);
            if (!list) {
                throw new Error('captions.json の形式が不正です（配列、または captions[] を持つオブジェクトである必要があります）');
            }
            const caption = list.find((value: any) => value && value.id === request.captionId);
            if (!caption) {
                throw new Error(`字幕が見つかりません: ${request.captionId}`);
            }
            caption.text_style = { ...this.objectRecord(caption.text_style), zone: request.patch.zone };
            const candidateText = `${JSON.stringify(root, undefined, 2)}\n`;
            // layerWrite / cutWrite と同型の書き込み前ゲート（パリティ契約 §2.7）。
            // captions.json 候補も lintEditCandidate で検証できる（URI の basename が候補名）。
            const lintResult = await this.previewService.lintEditCandidate({
                editUri: captionsUri.toString(),
                candidateText
            });
            if (!lintResult.pass) {
                respond(false, lintResult.errors[0] ?? 'edit-lint が変更を拒否しました');
                return;
            }
            this.recentWrites.set(captionsUri.toString(), Date.now());
            await this.fileService.writeFile(captionsUri, BinaryBuffer.fromString(candidateText));
            respond(true);
        } catch (error) {
            respond(false, error instanceof Error ? error.message : String(error));
        }
    }

    protected isCaptionWriteRequest(message: any): message is CaptionWriteRequest {
        return message?.type === 'akari-preview-caption-write'
            && typeof message.requestId === 'string'
            && typeof message.captionId === 'string'
            && message.patch
            && typeof message.patch === 'object'
            && typeof message.patch.zone === 'string';
    }

    protected isLayerWriteRequest(message: any): message is LayerWriteRequest {
        return message?.type === 'akari-preview-layer-write'
            && typeof message.requestId === 'string'
            && typeof message.layerId === 'string'
            && message.patch
            && typeof message.patch === 'object';
    }

    protected async handleWaveformFetch(widget: PreviewWidgetMarker, request: WaveformFetchRequest): Promise<void> {
        try {
            const videoUri = widget.akariPreviewVideoUri;
            if (!videoUri) {
                throw new Error('波形を生成する動画がありません');
            }
            const content = await this.fileService.readFile(videoUri);
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: true,
                dataBase64: this.toBase64(content.value.buffer)
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isWaveformFetchRequest(message: any): message is WaveformFetchRequest {
        return message?.type === 'akari-preview-waveform-fetch'
            && typeof message.requestId === 'string';
    }

    protected isOpenOutputRequest(message: any): message is OpenOutputRequest {
        return message?.type === 'akari-preview-open-output-request';
    }

    protected async handleOpenOutputRequest(widget: PreviewWidgetMarker): Promise<void> {
        const editUri = widget.akariPreviewRelatedEditUri;
        if (!editUri) {
            return;
        }
        try {
            const output = await this.getOrOpenPreview(editUri.normalizePath(), { area: 'main' }, 'output');
            this.attachTimelinePassively();
            await this.shell.activateWidget(output.id);
        } catch (error) {
            this.reportOpenFailure(editUri, error);
        }
    }

    protected prepareHtml(
        videoUri: URI,
        videoSource: string,
        model: PreviewModel,
        assets: OverlayRuntimeAssets,
        initialSeekTime?: number,
        sourceUrlById: Record<string, string> = {}
    ): string {
        const { width, height } = model.summary.output;
        // render-cut captions.mjs の既定とパリティ（stage は出力 px 論理空間）:
        // 縦長 = 出力幅 6% / 横長 = 38px。従来の height*0.05 は焼き込みよりも大きく表示される乖離だった。
        const captionFontSize = height > width ? Math.round(width * 0.06) : 38;
        const initialState = this.safeJson({
            summary: model.summary,
            captions: model.captions,
            emphasisWords: model.emphasisWords ?? [],
            editPath: model.editUri?.toString() ?? null,
            relatedEditUri: model.relatedEditUri?.toString() ?? null,
            videoUri: videoUri.toString(),
            // v1 マルチソース: ソース id → ストリーム URL。webview は cuts[].src が
            // 変わる継ぎ目で <video> をこの表から差し替える（v0 は 1 件のみの表）
            videoSources: sourceUrlById,
            initialSeekTime: Number.isFinite(initialSeekTime) ? initialSeekTime : null,
            muted: model.session?.muted ?? false,
            captionsVisible: model.session?.captionsVisible ?? true,
            hiddenTracks: model.session?.hiddenTracks ?? [],
            hiddenTracksByScope: model.session?.hiddenTracksByScope ?? { cuts: [], layers: [], audio: [] },
            mutedTracksByScope: model.session?.mutedTracksByScope ?? { cuts: [], audio: [], layers: [] },
            allTracksHiddenScopes: model.session?.allTracksHiddenScopes ?? [],
            allTracksMutedScopes: model.session?.allTracksMutedScopes ?? []
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(this.streamOrigin(videoSource))}; connect-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob:; img-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:">
<style>
${this.inlineStyle(assets.interactionCss)}
${captionFontFaceCss(assets.captionFontDataUri)}
:root { color-scheme: dark; font-family: "${CAPTION_FONT_FAMILY}", sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #141414; color: #eee; }
body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.preview-pane { min-width: 0; min-height: 0; padding: 16px; display: grid; place-items: center; background: #090909; }
#preview-wrapper { position: relative; width: 100%; max-height: 100%; aspect-ratio: ${width} / ${height}; overflow: hidden; background: #000; }
#preview-wrapper.is-draggable { cursor: grab; touch-action: none; }
#preview-wrapper.is-dragging { cursor: grabbing; }
#zoom-layer { position: absolute; inset: 0; overflow: hidden; will-change: transform; }
#preview-video { position: absolute; top: 0; left: 0; object-fit: contain; }
#preview-layers { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: hidden; pointer-events: none; }
#preview-layers > video { position: absolute; display: none; max-width: none; max-height: none; transform-origin: 50% 50%; pointer-events: auto; cursor: pointer; }
#layer-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#layer-select-box.is-active { display: block; }
#layer-select-box .akari-layer-handle { position: absolute; width: 12px; height: 12px; margin: -6px; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#layer-select-box .akari-layer-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
#layer-select-box .akari-layer-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
#layer-select-box .akari-layer-handle-rotate { top: 0; left: 50%; margin-top: -34px; border-radius: 50%; cursor: grab; }
#layer-select-box .akari-layer-rotate-stem { position: absolute; top: -28px; left: 50%; width: 1.5px; height: 28px; background: #4da3ff; transform: translateX(-50%); pointer-events: none; }
/* クロップモード: 移動/リサイズ/回転ハンドルと衝突しないよう select box 側の操作系だけ隠す
   （枠自体は #layer-crop-box が別枠として表示する）。 */
#layer-select-box.akari-crop-mode-hide-handles .akari-layer-handle,
#layer-select-box.akari-crop-mode-hide-handles .akari-layer-rotate-stem { display: none; }
/* クロップ編集オーバーレイ: 外枠はレイヤーの「クロップ無しなら見えていたはずの」全面フレーム
   （transform.rotate を outer 自身の中心まわりに適用 — pivot はソースフレーム中心固定。crop の
   現在値による pivot ドリフトを避け、常に自分の中心で回る素直な参照系にする＝編集時だけの近似）。
   overflow:hidden で box-shadow スプレッドを外枠内に閉じ込め、クロップ窓の外側だけを暗くする。 */
#layer-crop-box { position: absolute; z-index: 1950; overflow: hidden; outline: 1px dashed rgba(255,255,255,0.5); pointer-events: none; display: none; }
#layer-crop-box.is-active { display: block; }
#layer-crop-box .akari-layer-crop-rect { position: absolute; box-sizing: border-box; outline: 1.5px solid #4da3ff; box-shadow: 0 0 0 2000px rgba(0,0,0,0.45); pointer-events: none; }
#layer-crop-box .akari-layer-crop-handle { position: absolute; width: 12px; height: 12px; margin: -6px; box-sizing: border-box; border: 1.5px solid #4da3ff; border-radius: 2px; background: #fff; pointer-events: auto; }
#layer-crop-box .akari-layer-crop-handle-n, #layer-crop-box .akari-layer-crop-handle-s { left: 50%; cursor: ns-resize; }
#layer-crop-box .akari-layer-crop-handle-e, #layer-crop-box .akari-layer-crop-handle-w { top: 50%; cursor: ew-resize; }
#layer-crop-box .akari-layer-crop-handle-nw, #layer-crop-box .akari-layer-crop-handle-se { cursor: nwse-resize; }
#layer-crop-box .akari-layer-crop-handle-ne, #layer-crop-box .akari-layer-crop-handle-sw { cursor: nesw-resize; }
#layer-crop-box .akari-layer-crop-handle-nw { top: 0; left: 0; }
#layer-crop-box .akari-layer-crop-handle-n { top: 0; }
#layer-crop-box .akari-layer-crop-handle-ne { top: 0; left: 100%; }
#layer-crop-box .akari-layer-crop-handle-e { left: 100%; }
#layer-crop-box .akari-layer-crop-handle-se { top: 100%; left: 100%; }
#layer-crop-box .akari-layer-crop-handle-s { top: 100%; }
#layer-crop-box .akari-layer-crop-handle-sw { top: 100%; left: 0; }
#layer-crop-box .akari-layer-crop-handle-w { top: 0; }
#layer-crop-toggle { position: absolute; z-index: 1960; display: none; width: 22px; height: 22px; box-sizing: border-box; border-radius: 4px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.85); color: #cfe6ff; font-size: 13px; line-height: 20px; text-align: center; cursor: pointer; pointer-events: auto; user-select: none; }
#layer-crop-toggle.is-target-active { display: flex; align-items: center; justify-content: center; }
#layer-crop-toggle.is-crop-mode { background: #4da3ff; color: #0b1a2a; }
/* ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ（4隅の直接
   ドラッグハンドルは次段）。トグルはクロップトグルの隣（左）に並べ、常に同じ場所に留まる。 */
#layer-perspective-toggle { position: absolute; z-index: 1960; display: none; width: 22px; height: 22px; box-sizing: border-box; border-radius: 4px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.85); color: #cfe6ff; font-size: 13px; line-height: 20px; text-align: center; cursor: pointer; pointer-events: auto; user-select: none; }
#layer-perspective-toggle.is-target-active { display: flex; align-items: center; justify-content: center; }
#layer-perspective-toggle.is-panel-open { background: #4da3ff; color: #0b1a2a; }
#layer-perspective-toggle.is-declared { border-color: #ffb84d; }
#layer-perspective-panel { position: absolute; z-index: 1970; display: none; flex-direction: column; gap: 6px; padding: 8px; width: 168px; box-sizing: border-box; border-radius: 6px; border: 1px solid #4da3ff; background: rgba(20,20,20,0.92); color: #cfe6ff; font-size: 11px; pointer-events: auto; user-select: none; }
#layer-perspective-panel.is-open { display: flex; }
#layer-perspective-panel .akari-perspective-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#layer-perspective-panel .akari-perspective-preset { border: 1px solid #4da3ff; border-radius: 4px; background: rgba(255,255,255,0.06); color: #cfe6ff; font-size: 11px; padding: 4px 2px; cursor: pointer; }
#layer-perspective-panel .akari-perspective-preset.is-active { background: #4da3ff; color: #0b1a2a; }
#layer-perspective-panel .akari-perspective-angle-row { display: flex; align-items: center; gap: 6px; }
#layer-perspective-panel .akari-perspective-angle-row input[type=range] { flex: 1; }
#layer-perspective-panel .akari-perspective-clear { align-self: flex-end; border: none; background: none; color: #ff8a8a; font-size: 11px; cursor: pointer; padding: 2px 4px; }
#cut-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px solid #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#cut-select-box.is-active { display: block; }
#cut-select-box .akari-cut-handle { position: absolute; width: 12px; height: 12px; margin: -6px; border: 1.5px solid #4da3ff; border-radius: 3px; background: #fff; pointer-events: auto; }
#cut-select-box .akari-cut-handle-nw { top: 0; left: 0; cursor: nwse-resize; }
#cut-select-box .akari-cut-handle-ne { top: 0; left: 100%; cursor: nesw-resize; }
#cut-select-box .akari-cut-handle-sw { top: 100%; left: 0; cursor: nesw-resize; }
#cut-select-box .akari-cut-handle-se { top: 100%; left: 100%; cursor: nwse-resize; }
#caption-select-box { position: absolute; z-index: 1900; box-sizing: border-box; border: 1.5px dashed #4da3ff; box-shadow: 0 0 0 1px rgba(0,0,0,0.35); pointer-events: none; display: none; }
#caption-select-box.is-active { display: block; }
#overlay-stage { position: absolute; top: 0; left: 0; z-index: 1; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: hidden; }
#pen-layer { position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
#pen-layer.is-active { pointer-events: auto; cursor: crosshair; touch-action: none; }
#transition-plate { position: absolute; inset: 0; z-index: 2147483646; opacity: 0; pointer-events: none; }
/* プレーン字幕 host の見た目は焼き込み既定（captions.mjs）とパリティ: 透明座布団 + 実ストローク縁取り。
   shrink-to-fit の形状と cursor: move はドラッグ当たり判定のため維持する。 */
#caption-plate { position: absolute; left: 50%; bottom: 7%; z-index: 2147483647; max-width: 92%; transform: translateX(-50%); padding: 0.08em 0.42em; border-radius: 10px; background: transparent; color: #fff; font-size: ${captionFontSize}px; font-weight: 700; line-height: 1.42; text-align: center; -webkit-text-stroke: 0.14em rgba(0,0,0,.9); paint-order: stroke fill; text-shadow: 0 2px 8px rgba(0,0,0,.35); white-space: pre-wrap; pointer-events: auto; cursor: move; user-select: none; }
#caption-plate:empty { display: none; }
#caption-plate.akari-caption-host--styled { inset: 0; max-width: none; transform: none; padding: 0; border-radius: 0; background: none; text-shadow: none; white-space: normal; --caption-font-size: ${captionFontSize}px; }
.output-preview-link { position: absolute; top: 8px; left: 8px; z-index: 5; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; padding: 5px 9px; background: rgba(20,20,20,0.78); color: #d8e9ff; font-size: 11px; line-height: 1.35; cursor: pointer; }
.output-preview-link:hover { color: #fff; background: rgba(45,45,45,0.9); }
.output-preview-link[hidden] { display: none; }
#zoom-minimap { position: absolute; right: 8px; bottom: 8px; z-index: 3; overflow: hidden; border: 1px solid rgba(255,255,255,0.25); border-radius: 2px; background: rgba(0,0,0,0.55); pointer-events: none; }
#zoom-minimap[hidden] { display: none; }
#zoom-minimap-viewport { position: absolute; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.85); background: rgba(255,255,255,0.55); }
.message-card { position: absolute; inset: 0; z-index: 10; display: grid; gap: 16px; place-items: center; padding: 32px; background: #111; }
.message-card[hidden] { display: none; }
.message-card p { max-width: 520px; margin: 0; color: #e5e5e5; font-size: 15px; line-height: 1.7; text-align: center; }
.message-card-reload { border: 1px solid #505050; border-radius: 4px; padding: 8px 18px; background: #303030; color: #fff; font-size: 13px; cursor: pointer; }
.message-card-reload[hidden] { display: none; }
.audio-notice { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 10px; max-width: 92%; padding: 8px 12px; border-radius: 6px; background: rgba(20, 20, 20, 0.78); color: #f1f1f1; font-size: 12.5px; line-height: 1.5; }
.audio-notice[hidden] { display: none; }
.audio-notice button { flex: none; border: none; background: transparent; color: #ccc; font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.transport { display: grid; gap: 8px; padding: 9px 14px 10px; border-top: 1px solid #303030; background: #202020; }
.transport-waveform { position: relative; width: 100%; height: 56px; overflow: hidden; border-top: 1px solid #303030; background: #181818; cursor: pointer; touch-action: none; }
.transport-waveform[hidden] { display: none; }
#waveform-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.transport-waveform-playhead { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: rgba(255, 255, 255, 0.9); pointer-events: none; }
.transport-seek { display: flex; width: 100%; }
.transport-seek input { width: 100%; }
.transport-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-width: 0; }
.transport-left, .transport-center, .transport-right { display: flex; align-items: center; gap: 8px; }
.transport-left { position: relative; min-width: 0; justify-self: start; }
.transport-center { justify-self: center; }
.transport-right { position: relative; justify-self: end; }
.icon-button { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; cursor: pointer; }
.icon-button[hidden] { display: none; }
.icon-button[aria-pressed="true"] { border-color: #f2f4fa; background: #555b67; box-shadow: 0 0 8px rgba(236,242,255,0.48); }
.icon-button:disabled, .zoom-preset:disabled { opacity: 0.45; cursor: default; }
.icon-button svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; }
#time-label { min-width: 104px; color: #d0d0d0; font-variant-numeric: tabular-nums; text-align: left; }
.zoom-popup { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20; width: 224px; border: 1px solid #505050; border-radius: 6px; padding: 10px; background: #202020; box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
.zoom-popup[hidden] { display: none; }
.zoom-popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #d8d8d8; font-size: 12px; }
#zoom-value { color: #fff; font-variant-numeric: tabular-nums; }
#zoom-slider { width: 100%; }
.zoom-presets { display: grid; grid-template-columns: repeat(4, 32px); justify-content: space-between; gap: 5px; margin-top: 8px; }
.zoom-preset { width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; font-size: 10px; cursor: pointer; }
</style>
</head>
<body>
<main class="workspace">
  <section class="preview-pane" aria-label="動画プレビュー">
    <div id="preview-wrapper">
      <div id="zoom-layer">
        <video id="preview-video" src="${this.escapeHtml(videoSource)}" preload="auto"></video>
        <div id="preview-layers"></div>
        <div id="overlay-stage"><div id="transition-plate"></div><div id="caption-plate"></div></div>
        <div id="layer-select-box"><div class="akari-layer-rotate-stem"></div><div class="akari-layer-handle akari-layer-handle-nw" data-akari-handle="nw"></div><div class="akari-layer-handle akari-layer-handle-ne" data-akari-handle="ne"></div><div class="akari-layer-handle akari-layer-handle-sw" data-akari-handle="sw"></div><div class="akari-layer-handle akari-layer-handle-se" data-akari-handle="se"></div><div class="akari-layer-handle akari-layer-handle-rotate" data-akari-handle="rotate"></div></div>
        <div id="layer-crop-box"><div class="akari-layer-crop-rect"><div class="akari-layer-crop-handle akari-layer-crop-handle-nw" data-akari-crop-handle="nw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-n" data-akari-crop-handle="n"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-ne" data-akari-crop-handle="ne"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-e" data-akari-crop-handle="e"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-se" data-akari-crop-handle="se"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-s" data-akari-crop-handle="s"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-sw" data-akari-crop-handle="sw"></div><div class="akari-layer-crop-handle akari-layer-crop-handle-w" data-akari-crop-handle="w"></div></div></div>
        <div id="layer-crop-toggle" title="クロップモード切替 (Esc で終了)">⛶</div>
        <div id="layer-perspective-toggle" title="パース変形パネル">◈</div>
        <div id="layer-perspective-panel">
          <div class="akari-perspective-presets">
            <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="right">右奥</button>
            <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="left">左奥</button>
            <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="top">上奥</button>
            <button type="button" class="akari-perspective-preset" data-akari-perspective-preset="bottom">下奥</button>
          </div>
          <div class="akari-perspective-angle-row">
            <span>角度</span>
            <input type="range" min="0" max="75" step="1" value="30" data-akari-perspective-angle />
            <span data-akari-perspective-angle-value>30°</span>
          </div>
          <button type="button" class="akari-perspective-clear" data-akari-perspective-clear>パースを解除</button>
        </div>
        <div id="cut-select-box"><div class="akari-cut-handle akari-cut-handle-nw" data-akari-handle="nw"></div><div class="akari-cut-handle akari-cut-handle-ne" data-akari-handle="ne"></div><div class="akari-cut-handle akari-cut-handle-sw" data-akari-handle="sw"></div><div class="akari-cut-handle akari-cut-handle-se" data-akari-handle="se"></div></div>
        <div id="caption-select-box"></div>
        <canvas id="pen-layer" aria-hidden="true"></canvas>
      </div>
      <div id="zoom-minimap" hidden aria-hidden="true"><div id="zoom-minimap-viewport"></div></div>
      <button id="output-preview-link" class="output-preview-link" type="button"${model.relatedEditUri ? '' : ' hidden'}>合成は出力プレビューで確認（開く）</button>
      <div id="audio-notice" class="audio-notice" hidden role="status">
        <span>音声が検出されていません。無音の素材か、音声形式がプレビュー非対応の可能性があります（書き出しには影響しません）。</span>
        <button id="audio-notice-dismiss" type="button" aria-label="閉じる" title="閉じる">×</button>
      </div>
      <div id="preview-message" class="message-card" hidden role="status">
        <p id="preview-message-text">${UNSUPPORTED_FORMAT_MESSAGE}</p>
        <button id="preview-message-reload" class="message-card-reload" type="button" hidden>再読み込み</button>
      </div>
    </div>
  </section>
</main>
<div class="transport">
  <div class="transport-waveform" hidden>
    <canvas id="waveform-canvas" aria-label="音声波形"></canvas>
    <div class="transport-waveform-playhead" aria-hidden="true"></div>
  </div>
  <div class="transport-seek">
    <input id="seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置">
  </div>
  <div class="transport-controls">
    <div class="transport-left">
      <button id="waveform-toggle" class="icon-button" type="button" aria-label="波形" title="波形" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2m2-4v8m3-12v16m3-13v10m3-7v4m3-2h2" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="indicator-toggle" class="icon-button" type="button" aria-label="プレビュー未対応の項目" title="プレビュー未対応の項目" aria-expanded="false" hidden>ⓘ</button>
      <div id="indicator-popup" class="zoom-popup" hidden></div>
      <span id="time-label">0:00 / 0:00</span>
    </div>
    <div class="transport-center">
      <button id="skip-back" class="icon-button" type="button" aria-label="10秒戻る" title="10秒戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5V2L6.5 6 11 10V7a6 6 0 1 1-5.65 8H3.26A8 8 0 1 0 11 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
      <button id="frame-back" class="icon-button" type="button" aria-label="1コマ戻る" title="1コマ戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14l-9-7z"/></svg></button>
      <button id="play-toggle" class="icon-button" type="button" aria-label="再生" title="再生"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
      <button id="frame-forward" class="icon-button" type="button" aria-label="1コマ進む" title="1コマ進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5v14l9-7z"/></svg></button>
      <button id="skip-forward" class="icon-button" type="button" aria-label="10秒進む" title="10秒進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5V2l4.5 4-4.5 4V7a6 6 0 1 0 5.65 8h2.09A8 8 0 1 1 13 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
    </div>
    <div class="transport-right">
      <button id="pen-toggle" class="icon-button" type="button" aria-label="ペン" title="ペン" aria-pressed="false" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19.5 8.5a2.12 2.12 0 0 0-3-3zM14.8 7.2l2 2M4 16l4 4"/></svg></button>
      <button id="zoom-toggle" class="icon-button" type="button" aria-label="ズーム" title="ズーム" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke-width="2"/><path d="m15.5 15.5 5 5" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="fullscreen-toggle" class="icon-button" type="button" aria-label="全画面" title="全画面" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"/></svg></button>
      <div id="zoom-popup" class="zoom-popup" hidden>
        <div class="zoom-popup-header"><span>ズーム</span><span id="zoom-value">100%</span></div>
        <input id="zoom-slider" type="range" min="0" max="1" step="0.001" aria-label="ズーム倍率" title="ダブルクリックで100%">
        <div class="zoom-presets">
          <button class="zoom-preset" type="button" data-zoom="0.5" aria-label="50%にズーム" title="50%にズーム">50%</button>
          <button class="zoom-preset" type="button" data-zoom="1" aria-label="100%にズーム" title="100%にズーム">100%</button>
          <button class="zoom-preset" type="button" data-zoom="2" aria-label="200%にズーム" title="200%にズーム">200%</button>
          <button class="zoom-preset" type="button" data-zoom="4" aria-label="400%にズーム" title="400%にズーム">400%</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>window.__akariPreview = ${initialState};</script>
<script>window.__akariCaptionFontReady = (async () => { await document.fonts.load(${JSON.stringify(CAPTION_FONT_LOAD_DESCRIPTOR)}); await document.fonts.ready; if (!document.fonts.check(${JSON.stringify(CAPTION_FONT_LOAD_DESCRIPTOR)})) throw new Error('AKARI caption font did not load'); return true; })();</script>
<script>${this.hostAdapterScript()}</script>
<script>${this.inlineScript(assets.threeJavaScript)}</script>
<script>${this.inlineScript(assets.threeRuntimeJavaScript)}</script>
<script>${this.inlineScript(assets.runtimeJavaScript)}</script>
<script>${this.inlineScript(assets.interactionJavaScript)}</script>
<script>${this.inlineScript(assets.webviewKernelJavaScript)}</script>
<script>${this.previewBootstrapScript()}</script>
</body>
</html>`;
    }

    protected prepareMessageHtml(message: string): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { display: grid; place-items: center; padding: 32px; }
.message-card { width: min(100%, 560px); border: 1px solid #353535; border-radius: 8px; padding: 28px; background: #1b1b1b; }
.message-card p { margin: 0; font-size: 15px; line-height: 1.7; text-align: center; }
</style>
</head>
<body>
<main class="message-card" role="status"><p>${this.escapeHtml(message)}</p></main>
</body>
</html>`;
    }

    protected hostAdapterScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const vscode = acquireVsCodeApi();
            const pending = new Map();
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）: updateStageScale
            // (below, in this same IIFE) needs this at layout time, which runs before
            // previewBootstrapScript's own copy of this function is ever reached -- so this script
            // block injects its own copy rather than relying on cross-<script>-tag scope.
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            let sequence = 0;
            let displayScale = 1;
            // frameScale: 出力キャンバス(output.width/height)を wrapper 内の出力フレーム矩形へ
            // 写像する CSS px / 出力 px 比。wrapper は利用可能領域によって出力アスペクト比より横長に
            // なるため、wrapper 全体を出力フレームとして扱わない。base/layers/captions/overlays は
            // 同じ出力フレーム矩形、#pen-layer はその中の実映像矩形へ写像する。
            let frameScale = 1;
            let lastPlaybackTickAt = -Infinity;
            const wrapper = document.getElementById('preview-wrapper');
            const video = document.getElementById('preview-video');
            const outputPreviewLink = document.getElementById('output-preview-link');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const penLayer = document.getElementById('pen-layer');
            const output = initial.summary.output;

            window.akari = window.akari || {};
            window.akari.state = { editPath: initial.editPath, summary: initial.summary };
            window.akari.engine = {
                overlayWrite: (_editPath, overlayId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'overlay-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write', requestId, overlayId, patch });
                }),
                layerWrite: (layerId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'layer-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-layer-write', requestId, layerId, patch });
                }),
                cutWrite: (cutIndex, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'cut-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-cut-write', requestId, cutIndex, patch });
                }),
                captionWrite: (captionId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'caption-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-caption-write', requestId, captionId, patch });
                }),
                readWaveformBytes: () => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-waveform-' + (++sequence);
                    pending.set(requestId, { kind: 'waveform-fetch', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-waveform-fetch', requestId });
                })
            };
            const createPreviewAudio = () => {
                const config = initial.summary && initial.summary.audio;
                const hasAudio = config && (config.bgm
                    || (Array.isArray(config.sfx) && config.sfx.length > 0)
                    || (Array.isArray(config.narration) && config.narration.length > 0));
                if (!hasAudio) return null;

                const video = document.getElementById('preview-video');
                let context;
                try {
                    context = new AudioContext();
                } catch (error) {
                    console.warn('[akari-preview] audio graph unavailable; continuing with video only', error);
                    return null;
                }
                const masterGain = context.createGain();
                masterGain.connect(context.destination);
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: sfx/bgm trim + schedule
                // math, shared with this same module's node:test unit tests
                // (test/audio-schedule.test.mjs) via src/common/audio-schedule.ts -- see that file's
                // header comment (same pattern as preview-composite-layout.ts's fitCompositeRect
                // below).
                const resolveSfxTrimWindowFn = (${resolveSfxTrimWindow.toString()});
                const resolveBgmSourceOffsetFn = (${resolveBgmSourceOffset.toString()});
                const bgmLoopOffsetSecondsFn = (${bgmLoopOffsetSeconds.toString()});
                const resolveTimedScheduleWindowFn = (${resolveTimedScheduleWindow.toString()});
                const decoded = { bgm: null, sfx: [], narration: [] };
                let timelineDuration = 0;
                let loadPromise = null;
                let generation = 0;
                let active = [];
                let bgmGain = null;
                let lastDuckGainDb = null;
                let mutedSfxTracks = new Set();
                let allSfxMuted = false;

                const dbToLinear = gainDb => Math.pow(10, gainDb / 20);
                // クリップ全体ミュート（akariGlobalMuted。クリップ帯のスピーカートグルが送る旧 setMuted
                // イベント由来）は video.muted のみに効かせる。BGM/SFX/narration の audibility は
                // audio scope の個別ミュート（allSfxMuted/mutedSfxTracks）で独立制御する
                // （クリップのスピーカーを OFF にしても BGM/SFX は継続する契約要求のため）。
                const syncMasterGain = () => {
                    const volume = Number.isFinite(video.volume) ? Math.max(0, Math.min(1, video.volume)) : 1;
                    masterGain.gain.value = volume;
                };
                const warnUnavailable = (kind, id, error) => {
                    console.warn('[akari-preview] ' + kind + ' ' + id
                        + ' unavailable (fetch/decode failed); skipping element', error);
                };
                // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 (consumption side): 実尺
                // (the real decoded duration) is only known post-decode, so in/out clamping happens
                // here, via the shared resolveSfxTrimWindowFn/resolveBgmSourceOffsetFn -- mirrors
                // packages/render-cut/src/plan.mjs's resolveSfxTrim/resolveBgmInSeconds.
                const decodeOne = async (kind, spec) => {
                    try {
                        const response = await fetch(spec.src);
                        if (!response.ok) throw new Error('fetch status=' + response.status);
                        const buffer = await context.decodeAudioData(await response.arrayBuffer());
                        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
                            throw new Error('decoded audio duration is invalid');
                        }
                        if (kind === 'sfx' && (spec.in !== undefined || spec.out !== undefined)) {
                            const trimWindow = resolveSfxTrimWindowFn(spec.in, spec.out, buffer.duration, 'sfx ' + spec.id);
                            if (trimWindow.warning) console.warn('[akari-preview] ' + trimWindow.warning);
                            if (trimWindow.skip) return null;
                            return { ...spec, buffer, durationSec: trimWindow.durationSec, sourceOffset: trimWindow.sourceOffset };
                        }
                        if (kind === 'bgm' && spec.in !== undefined) {
                            const resolved = resolveBgmSourceOffsetFn(spec.in, buffer.duration);
                            if (resolved.warning) console.warn('[akari-preview] ' + resolved.warning);
                            return { ...spec, buffer, durationSec: buffer.duration, sourceOffset: resolved.sourceOffset };
                        }
                        return { ...spec, buffer, durationSec: buffer.duration };
                    } catch (error) {
                        if (context.state !== 'closed') {
                            warnUnavailable(kind, spec.id || kind, error);
                        }
                        return null;
                    }
                };
                const load = duration => {
                    if (Number.isFinite(duration) && duration > 0) timelineDuration = duration;
                    if (loadPromise || timelineDuration <= 0) return loadPromise || Promise.resolve();
                    loadPromise = (async () => {
                        const timed = async (kind, specs) => {
                            const valid = [];
                            for (const spec of Array.isArray(specs) ? specs : []) {
                                if (!Number.isFinite(spec.t) || spec.t < 0 || spec.t >= timelineDuration) {
                                    console.warn('[akari-preview] ' + kind + ' ' + spec.id
                                        + ' skipped: t is outside timeline duration');
                                    continue;
                                }
                                valid.push(spec);
                            }
                            return (await Promise.all(valid.map(spec => decodeOne(kind, spec)))).filter(Boolean);
                        };
                        const [bgm, sfx, narration] = await Promise.all([
                            config.bgm ? decodeOne('bgm', { ...config.bgm, id: 'bgm' }) : Promise.resolve(null),
                            timed('sfx', config.sfx),
                            timed('narration', config.narration)
                        ]);
                        decoded.bgm = bgm;
                        decoded.sfx = sfx;
                        decoded.narration = narration;
                        if (context.state !== 'closed') {
                            console.info('[akari-preview] audio graph ready', {
                                contextState: context.state,
                                timelineDuration,
                                decoded: {
                                    bgm: Boolean(decoded.bgm),
                                    sfx: decoded.sfx.map(item => item.id),
                                    narration: decoded.narration.map(item => item.id)
                                }
                            });
                        }
                    })();
                    return loadPromise;
                };
                const detachActive = item => {
                    active = active.filter(candidate => candidate !== item);
                    try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                    try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                };
                const stopSources = () => {
                    const sources = active;
                    active = [];
                    bgmGain = null;
                    lastDuckGainDb = null;
                    for (const item of sources) {
                        item.source.onended = null;
                        try { item.source.stop(); } catch (_error) { /* already stopped */ }
                        try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                        try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                    }
                };
                const registerSource = (source, gain, kind, id, track, baseGainLinear) => {
                    const item = { source, gain, kind, id, track, baseGainLinear };
                    active.push(item);
                    source.onended = () => detachActive(item);
                    return item;
                };
                const duckGainDbAt = timelineTime => {
                    if (!decoded.bgm || decoded.bgm.ducking !== true) return 0;
                    return decoded.narration.some(item => timelineTime >= item.t
                        && timelineTime < item.t + item.durationSec) ? -12 : 0;
                };
                const fadeMultiplierAt = timelineTime => {
                    if (!decoded.bgm) return 1;
                    const total = timelineDuration;
                    const rawIn = decoded.bgm.fadeIn;
                    const rawOut = decoded.bgm.fadeOut;
                    const fadeIn = Number.isFinite(rawIn) && rawIn > 0 ? Math.min(rawIn, total / 2) : 0;
                    const fadeOut = Number.isFinite(rawOut) && rawOut > 0 ? Math.min(rawOut, total / 2) : 0;
                    let multiplier = 1;
                    if (fadeIn > 0 && timelineTime < fadeIn) multiplier = Math.min(multiplier, timelineTime / fadeIn);
                    if (fadeOut > 0 && timelineTime > total - fadeOut) {
                        multiplier = Math.min(multiplier, (total - timelineTime) / fadeOut);
                    }
                    return Math.max(0, Math.min(1, multiplier));
                };
                const applyBgmDuck = timelineTime => {
                    if (!decoded.bgm) return;
                    const duckGainDb = duckGainDbAt(timelineTime);
                    const fadeMultiplier = fadeMultiplierAt(timelineTime);
                    if (bgmGain) {
                        bgmGain.gain.value = allSfxMuted
                            ? 0 : dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier;
                    }
                    if (duckGainDb !== lastDuckGainDb) {
                        lastDuckGainDb = duckGainDb;
                        console.info('[akari-preview] bgm duck gain', {
                            timelineTime,
                            baseGainDb: decoded.bgm ? decoded.bgm.gainDb : null,
                            duckGainDb,
                            appliedGainDb: decoded.bgm ? decoded.bgm.gainDb + duckGainDb : null,
                            fadeMultiplier,
                            appliedLinear: decoded.bgm
                                ? dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier
                                : null
                        });
                    }
                };
                const scheduleFrom = async timelineTime => {
                    const scheduleGeneration = ++generation;
                    stopSources();
                    await load(timelineDuration);
                    if (scheduleGeneration !== generation || timelineDuration <= 0) return;
                    const startAt = Math.max(0, Math.min(timelineDuration, timelineTime));
                    const contextStart = context.currentTime + 0.015;
                    const remaining = timelineDuration - startAt;
                    let scheduledBgm = false;
                    let scheduledSfx = 0;
                    let scheduledNarration = 0;
                    if (decoded.bgm && remaining > 0) {
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            source.buffer = decoded.bgm.buffer;
                            source.loop = true;
                            source.connect(gain);
                            gain.connect(masterGain);
                            bgmGain = gain;
                            applyBgmDuck(startAt);
                            registerSource(source, gain, 'bgm', 'bgm');
                            // audio.bgm.in: file-internal start offset, composed with the existing
                            // timeline-position-to-source-position mapping via bgmLoopOffsetSecondsFn.
                            // loop=true means once playback reaches the buffer's own end it wraps to
                            // source position 0 (not back to in) -- the existing loop semantics are
                            // otherwise untouched; this only computes where playback begins.
                            const bgmOffset = bgmLoopOffsetSecondsFn(decoded.bgm.sourceOffset || 0, startAt, decoded.bgm.durationSec);
                            source.start(contextStart, bgmOffset);
                            source.stop(contextStart + remaining);
                            scheduledBgm = true;
                        } catch (error) {
                            warnUnavailable('bgm', 'bgm', error);
                            bgmGain = null;
                        }
                    }
                    const scheduleTimed = (kind, item) => {
                        // audio.sfx.in: material source offset, composed via resolveTimedScheduleWindowFn
                        // with the existing resume-from-mid-playback offset -- when item.sourceOffset is
                        // absent (narration; sfx without in/out) this reduces to the original schedule math.
                        const scheduleWindow = resolveTimedScheduleWindowFn(item.t, item.durationSec, item.sourceOffset || 0, startAt, timelineDuration, remaining);
                        if (!scheduleWindow.shouldSchedule) return false;
                        const delay = scheduleWindow.delaySec;
                        const offset = scheduleWindow.sourceOffsetSec;
                        const available = scheduleWindow.availableSec;
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            const baseGainLinear = dbToLinear(item.gainDb);
                            source.buffer = item.buffer;
                            gain.gain.value = baseGainLinear;
                            source.connect(gain);
                            gain.connect(masterGain);
                            registerSource(source, gain, kind, item.id, item.track, baseGainLinear);
                            source.start(contextStart + delay, offset, available);
                            return true;
                        } catch (error) {
                            warnUnavailable(kind, item.id, error);
                            return false;
                        }
                    };
                    for (const item of decoded.sfx) {
                        if (scheduleTimed('sfx', item)) scheduledSfx += 1;
                    }
                    for (const item of decoded.narration) {
                        if (scheduleTimed('narration', item)) scheduledNarration += 1;
                    }
                    console.info('[akari-preview] audio scheduled', {
                        timelineTime: startAt,
                        bgm: scheduledBgm,
                        sfx: scheduledSfx,
                        narration: scheduledNarration
                    });
                };
                const controller = {
                    setTimelineDuration: duration => load(duration),
                    setMutedTracks: (trackSet, allMuted) => {
                        mutedSfxTracks = new Set(trackSet);
                        allSfxMuted = allMuted === true;
                    },
                    resume: () => context.resume().catch(error => {
                        console.warn('[akari-preview] AudioContext resume failed; continuing with video only', error);
                    }),
                    playFrom: timelineTime => controller.resume().then(() => scheduleFrom(timelineTime)),
                    pause: () => {
                        generation += 1;
                        stopSources();
                    },
                    tick: (timelineTime, playing) => {
                        syncMasterGain();
                        for (const item of active.filter(candidate => candidate.kind === 'sfx')) {
                            item.gain.gain.value = allSfxMuted || mutedSfxTracks.has(item.track)
                                ? 0 : item.baseGainLinear;
                        }
                        if (playing) applyBgmDuck(timelineTime);
                    },
                    debugState: () => ({
                        contextState: context.state,
                        timelineDuration,
                        decoded: {
                            bgm: Boolean(decoded.bgm),
                            bgmSourceOffset: decoded.bgm ? decoded.bgm.sourceOffset || 0 : null,
                            sfx: decoded.sfx.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec, sourceOffset: item.sourceOffset || 0 })),
                            narration: decoded.narration.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec }))
                        },
                        active: {
                            bgm: active.filter(item => item.kind === 'bgm').length,
                            sfx: active.filter(item => item.kind === 'sfx').length,
                            narration: active.filter(item => item.kind === 'narration').length
                        },
                        masterGainLinear: masterGain.gain.value,
                        bgmGainLinear: bgmGain ? bgmGain.gain.value : null,
                        duckGainDb: lastDuckGainDb
                    })
                };
                syncMasterGain();
                video.addEventListener('volumechange', syncMasterGain);
                window.addEventListener('pagehide', () => {
                    controller.pause();
                    void context.close().catch(() => undefined);
                }, { once: true });
                return controller;
            };
            window.akari.previewAudio = createPreviewAudio();
            window.akari.previewAudioDebug = () => window.akari.previewAudio
                ? window.akari.previewAudio.debugState()
                : { disabled: true };
            window.akari.stageScale = () => frameScale;
            window.akari.playbackTick = (time, playing, immediate = false) => {
                const now = performance.now();
                if (!immediate && now - lastPlaybackTickAt < 50) return;
                lastPlaybackTickAt = now;
                vscode.postMessage({ type: 'akari-preview-playback-tick', time, playing, rate: video.playbackRate || 1 });
            };
            window.akari.reviewTransport = event => {
                vscode.postMessage({ type: 'akari-preview-review-transport-event', event });
            };
            window.akari.reviewStrokeStart = frame => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-start', frame });
            };
            window.akari.reviewStrokeEnd = points => {
                vscode.postMessage({ type: 'akari-preview-review-stroke-end', points });
            };
            window.akari.reportOverlaySelection = overlayId => {
                vscode.postMessage({ type: 'akari-preview-overlay-selected', overlayId });
            };
            window.akari.reportLayerSelection = layerId => {
                vscode.postMessage({ type: 'akari-preview-layer-selected', layerId });
            };
            window.akari.reportCutSelection = selected => {
                vscode.postMessage({ type: 'akari-preview-cut-selected', selected });
            };
            window.akari.reportCaptionSelection = captionId => {
                vscode.postMessage({ type: 'akari-preview-caption-selected', captionId });
            };
            if (outputPreviewLink && initial.relatedEditUri) {
                outputPreviewLink.addEventListener('click', () => {
                    vscode.postMessage({ type: 'akari-preview-open-output-request' });
                });
            }
            window.akari.toggleFullscreen = () => {
                if (document.fullscreenElement) {
                    return document.exitFullscreen();
                }
                try {
                    return Promise.resolve(document.documentElement.requestFullscreen()).catch(() => {
                        vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    });
                } catch (_error) {
                    vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    return Promise.resolve();
                }
            };

            const PENDING_RESPONSE_TYPES = {
                'overlay-write': 'akari-preview-overlay-write-response',
                'layer-write': 'akari-preview-layer-write-response',
                'cut-write': 'akari-preview-cut-write-response',
                'caption-write': 'akari-preview-caption-write-response',
                'waveform-fetch': 'akari-preview-waveform-fetch-response'
            };
            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || !Object.values(PENDING_RESPONSE_TYPES).includes(message.type)) return;
                const request = pending.get(message.requestId);
                if (!request) return;
                const expectedType = PENDING_RESPONSE_TYPES[request.kind];
                if (message.type !== expectedType) return;
                pending.delete(message.requestId);
                if (!message.ok) {
                    const fallback = request.kind === 'waveform-fetch'
                        ? '動画データの読み込みに失敗しました'
                        : request.kind === 'caption-write'
                            ? 'captions.json の書き込みに失敗しました'
                            : 'edit.json の書き込みに失敗しました';
                    request.reject(new Error(message.error || fallback));
                    return;
                }
                if (request.kind !== 'waveform-fetch') {
                    request.resolve(undefined);
                    return;
                }
                try {
                    const binary = atob(String(message.dataBase64 || ''));
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index += 1) {
                        bytes[index] = binary.charCodeAt(index);
                    }
                    request.resolve(bytes.buffer);
                } catch (error) {
                    request.reject(error);
                }
            });

            const fitCompositeRect = (${fitPreviewCompositeRect.toString()});
            const computeOutputFrameRect = () => fitCompositeRect(
                wrapper.clientWidth,
                wrapper.clientHeight,
                Number(output.width || 1280),
                Number(output.height || 720)
            );
            const computeContentRect = () => {
                const frameRect = computeOutputFrameRect();
                const boxWidth = wrapper.clientWidth;
                const boxHeight = wrapper.clientHeight;
                const videoWidth = video.videoWidth;
                const videoHeight = video.videoHeight;
                if (!(boxWidth > 0) || !(boxHeight > 0) || !(videoWidth > 0) || !(videoHeight > 0)) {
                    return frameRect;
                }
                const contentRect = fitCompositeRect(frameRect.width, frameRect.height, videoWidth, videoHeight);
                return {
                    x: frameRect.x + contentRect.x,
                    y: frameRect.y + contentRect.y,
                    width: contentRect.width,
                    height: contentRect.height
                };
            };
            const updateStageScale = () => {
                const frameRect = computeOutputFrameRect();
                const rect = computeContentRect();
                const next = rect.width / Number(output.width || 1280);
                displayScale = Number.isFinite(next) && next > 0 ? next : 1;
                const outputWidth = Number(output.width || 1280);
                const outputHeight = Number(output.height || 720);
                const nextFrameScale = frameRect.width / outputWidth;
                frameScale = Number.isFinite(nextFrameScale) && nextFrameScale > 0 ? nextFrameScale : 1;
                const stageTransform = 'translate(0px, 0px) scale(' + frameScale + ')';
                video.style.left = frameRect.x + 'px';
                video.style.top = frameRect.y + 'px';
                video.style.width = frameRect.width + 'px';
                video.style.height = frameRect.height + 'px';
                layersStage.style.left = frameRect.x + 'px';
                layersStage.style.top = frameRect.y + 'px';
                layersStage.style.width = outputWidth + 'px';
                layersStage.style.height = outputHeight + 'px';
                layersStage.style.transform = stageTransform;
                for (const layerVideo of layersStage.querySelectorAll('video')) {
                    if (!(layerVideo.videoWidth > 0) || !(layerVideo.videoHeight > 0)) continue;
                    const x = Number(layerVideo.dataset.akariTransformX) || 0;
                    const y = Number(layerVideo.dataset.akariTransformY) || 0;
                    const scale = Number(layerVideo.dataset.akariTransformScale) || 1;
                    const rotate = Number(layerVideo.dataset.akariTransformRotate) || 0;
                    // ㉔ layers[].crop（contract-2026-08-02-preview-parity.md）: render-cut は
                    // crop→scale→rotate→opacity→overlay の順で合成する。プレビューは同じ最終見た目を、
                    // 要素を1枚のまま clip-path: inset() で切り抜き、pivot（transform-origin と
                    // translate の基準点）をクロップ矩形の中心へ動かすことで再現する（wrapper 要素の
                    // 追加なし = 既存のヒットテスト/アルファ実測コードへの影響を最小化）。
                    // crop 無し（既定 0,0,1,1）では pivot=50%/50% となり、既存の挙動と完全一致する。
                    const cropX = Number(layerVideo.dataset.akariCropX) || 0;
                    const cropY = Number(layerVideo.dataset.akariCropY) || 0;
                    const cropWRaw = Number(layerVideo.dataset.akariCropW);
                    const cropHRaw = Number(layerVideo.dataset.akariCropH);
                    const cropW = Number.isFinite(cropWRaw) && cropWRaw > 0 ? cropWRaw : 1;
                    const cropH = Number.isFinite(cropHRaw) && cropHRaw > 0 ? cropHRaw : 1;
                    const pivotXPct = (cropX + cropW / 2) * 100;
                    const pivotYPct = (cropY + cropH / 2) * 100;
                    layerVideo.style.width = (layerVideo.videoWidth * scale) + 'px';
                    layerVideo.style.height = (layerVideo.videoHeight * scale) + 'px';
                    layerVideo.style.left = (outputWidth / 2 + x) + 'px';
                    layerVideo.style.top = (outputHeight / 2 + y) + 'px';
                    layerVideo.style.transformOrigin = pivotXPct + '% ' + pivotYPct + '%';
                    // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）: applies
                    // after scale, before rotate (crop → scale → perspective → rotate). Appended as
                    // the innermost (rightmost) transform function -- since transform-origin already
                    // wraps the whole chain at the crop pivot, matrix3d receives pivot-relative
                    // coordinates and composes correctly under the *existing* translate/rotate without
                    // any extra bookkeeping (computeLayerPerspectiveVisualFn is built specifically for
                    // this). The box it operates on is the crop rect's own *rendered* (already scaled)
                    // pixel size, matching layer-perspective-visual.ts's box-size contract.
                    let perspectiveFn = '';
                    const perspectiveRaw = layerVideo.dataset.akariPerspectiveCorners;
                    if (perspectiveRaw) {
                        let corners = null;
                        try { corners = JSON.parse(perspectiveRaw); } catch (_error) { corners = null; }
                        const boxWidthPx = layerVideo.videoWidth * cropW * scale;
                        const boxHeightPx = layerVideo.videoHeight * cropH * scale;
                        const visual = corners ? computeLayerPerspectiveVisualFn({ corners }, boxWidthPx, boxHeightPx) : null;
                        if (visual) perspectiveFn = ' ' + visual.transformFunction;
                    }
                    layerVideo.style.transform = 'translate(-' + pivotXPct + '%, -' + pivotYPct + '%) rotate(' + rotate + 'deg)' + perspectiveFn;
                    layerVideo.style.clipPath = (cropX > 0 || cropY > 0 || cropW < 1 || cropH < 1)
                        ? 'inset(' + (cropY * 100) + '% ' + (Math.max(0, (1 - cropX - cropW)) * 100) + '% '
                            + (Math.max(0, (1 - cropY - cropH)) * 100) + '% ' + (cropX * 100) + '%)'
                        : '';
                }
                // ㉕ cuts[].framing（contract-2026-08-02-preview-parity.md §2.4.2）: この cut.transform
                // 部分（PIP 位置決め）は video.style.transform の一部にすぎず、時間で変化する framing
                // ズームは previewBootstrapScript 側（tick() 毎フレーム）が別途書き込む。二つの書き手が
                // 競合しないよう、ここでは「cut.transform だけの文字列」を dataset に置くに留め、実際の
                // video.style.transform への反映は window.akari.applyCutFramingVisual に委譲する
                // （bootstrap 未初期化の最初の呼び出しだけ、フォールバックとして自分で直接書く）。
                const baseTransform = video.dataset.akariCutTransformActive === 'true'
                    ? (() => {
                        const x = Number(video.dataset.akariTransformX) || 0;
                        const y = Number(video.dataset.akariTransformY) || 0;
                        const scale = Number(video.dataset.akariTransformScale) || 1;
                        const rotate = Number(video.dataset.akariTransformRotate) || 0;
                        return 'translate(' + (x * frameScale) + 'px, '
                            + (y * frameScale) + 'px) scale(' + scale + ') rotate(' + rotate + 'deg)';
                    })()
                    : '';
                video.dataset.akariBaseTransform = baseTransform;
                if (window.akari.applyCutFramingVisual) {
                    window.akari.applyCutFramingVisual();
                } else {
                    video.style.transform = baseTransform;
                }
                stage.style.left = frameRect.x + 'px';
                stage.style.top = frameRect.y + 'px';
                stage.style.transform = stageTransform;
                penLayer.style.left = rect.x + 'px';
                penLayer.style.top = rect.y + 'px';
                penLayer.style.width = rect.width + 'px';
                penLayer.style.height = rect.height + 'px';
            };
            window.akari.computeOutputFrameRect = computeOutputFrameRect;
            window.akari.computeContentRect = computeContentRect;
            window.akari.updateLayerLayout = updateStageScale;
            new ResizeObserver(updateStageScale).observe(wrapper);
            video.addEventListener('loadedmetadata', updateStageScale);
            updateStageScale();
        })();`;
    }

    protected previewBootstrapScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const summary = initial.summary;
            const video = document.getElementById('preview-video');
            const playToggle = document.getElementById('play-toggle');
            const frameBack = document.getElementById('frame-back');
            const frameForward = document.getElementById('frame-forward');
            const skipBack = document.getElementById('skip-back');
            const skipForward = document.getElementById('skip-forward');
            const waveformToggle = document.getElementById('waveform-toggle');
            const waveformRow = document.querySelector('.transport-waveform');
            const waveformCanvas = document.getElementById('waveform-canvas');
            const waveformPlayhead = document.querySelector('.transport-waveform-playhead');
            const indicatorToggle = document.getElementById('indicator-toggle');
            const indicatorPopup = document.getElementById('indicator-popup');
            const penToggle = document.getElementById('pen-toggle');
            const zoomToggle = document.getElementById('zoom-toggle');
            const fullscreenToggle = document.getElementById('fullscreen-toggle');
            const seek = document.getElementById('seek');
            const timeLabel = document.getElementById('time-label');
            const previewPane = document.querySelector('.preview-pane');
            const wrapper = document.getElementById('preview-wrapper');
            const zoomLayer = document.getElementById('zoom-layer');
            const zoomPopup = document.getElementById('zoom-popup');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            const zoomMinimap = document.getElementById('zoom-minimap');
            const zoomMinimapViewport = document.getElementById('zoom-minimap-viewport');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const penLayer = document.getElementById('pen-layer');
            const transitionPlate = document.getElementById('transition-plate');
            const captionPlate = document.getElementById('caption-plate');
            const previewMessage = document.getElementById('preview-message');
            const previewMessageText = document.getElementById('preview-message-text');
            const previewMessageReload = document.getElementById('preview-message-reload');
            const audioNotice = document.getElementById('audio-notice');
            const audioNoticeDismiss = document.getElementById('audio-notice-dismiss');
            const fps = Number(summary.output && summary.output.fps) > 0 ? Number(summary.output.fps) : 30;
            const ZOOM_MIN = 0.25;
            const ZOOM_MAX = 8;
            const SNAP_TOLERANCE = 0.025;
            const CLICK_THRESHOLD_PX = 4;
            // ペン描画のチューニング定数（密度・グロー・フェード等）。画像注釈ポップアップ
            // （akari-annotations）の静的プラチナ描画と単一の正本（../common/pen-canvas-visuals.ts
            // の PEN_TUNING）を共有する — webview はサンドボックスのためモジュール import が
            // できず、値を JSON として埋め込む形でのみ共有できる（統合点調査・report.md 参照）。
            // 実際の描画ロジック（グロー/スパークル/フェード）はここに残したまま無変更。
            const PEN_TUNING = ${JSON.stringify(PEN_TUNING)};
            const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
            const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>';
            const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"></path></svg>';
            const restoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm16 0v2h-3v3h-2v-5z"></path></svg>';
            let captions = Array.isArray(initial.captions) ? initial.captions : [];
            const emphasisWords = Array.isArray(initial.emphasisWords) ? initial.emphasisWords : [];
            let hiddenTracks = new Set(Array.isArray(initial.hiddenTracks) ? initial.hiddenTracks : []);
            const initialHiddenTracksByScope = initial.hiddenTracksByScope || {};
            const initialMutedTracksByScope = initial.mutedTracksByScope || {};
            const initialAllTracksHiddenScopes = Array.isArray(initial.allTracksHiddenScopes)
                ? initial.allTracksHiddenScopes : [];
            const initialAllTracksMutedScopes = Array.isArray(initial.allTracksMutedScopes)
                ? initial.allTracksMutedScopes : [];
            const hiddenTracksByScope = {
                cuts: new Set(Array.isArray(initialHiddenTracksByScope.cuts) ? initialHiddenTracksByScope.cuts : []),
                layers: new Set(Array.isArray(initialHiddenTracksByScope.layers) ? initialHiddenTracksByScope.layers : []),
                audio: new Set(Array.isArray(initialHiddenTracksByScope.audio) ? initialHiddenTracksByScope.audio : [])
            };
            const mutedTracksByScope = {
                cuts: new Set(Array.isArray(initialMutedTracksByScope.cuts) ? initialMutedTracksByScope.cuts : []),
                audio: new Set(Array.isArray(initialMutedTracksByScope.audio) ? initialMutedTracksByScope.audio : []),
                layers: new Set(Array.isArray(initialMutedTracksByScope.layers) ? initialMutedTracksByScope.layers : [])
            };
            const allTracksHiddenByScope = {
                cuts: initialAllTracksHiddenScopes.includes('cuts'),
                layers: initialAllTracksHiddenScopes.includes('layers'),
                audio: initialAllTracksHiddenScopes.includes('audio')
            };
            const allTracksMutedByScope = {
                cuts: initialAllTracksMutedScopes.includes('cuts'),
                audio: initialAllTracksMutedScopes.includes('audio'),
                layers: initialAllTracksMutedScopes.includes('layers')
            };
            let globalMuted = initial.muted === true;
            video.dataset.akariGlobalMuted = String(globalMuted);
            video.muted = globalMuted;
            captionPlate.style.visibility = initial.captionsVisible === false ? 'hidden' : 'visible';
            let animationFrame = 0;
            let animationWatchdogTimer = 0;
            let lastTickAtMs = 0;
            let transitionPlates = [];
            let totalTimelineDuration = 0;
            let segments = [];
            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md §2.4.2/2.4.3）。
            const computeCutFramingVisualFn = (${computeCutFramingVisual.toString()});
            const checkCutFreezeCrossingFn = (${checkCutFreezeCrossing.toString()});
            // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。
            const computeLayerPerspectiveVisualFn = (${computeLayerPerspectiveVisual.toString()});
            // freeze の一時停止ホールド（近似実装。尺は伸ばさない — 詳細はコメント参照）。
            let freezeHoldUntilMs = 0;
            let freezeHoldConsumedForSegmentIndex = null;
            const probeMediaDurationSeconds = src => new Promise(resolve => {
                const probe = new Audio();
                probe.preload = 'metadata';
                const cleanup = () => {
                    probe.removeEventListener('loadedmetadata', onLoaded);
                    probe.removeEventListener('error', onError);
                };
                const onLoaded = () => {
                    cleanup();
                    resolve(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
                };
                const onError = () => { cleanup(); resolve(null); };
                probe.addEventListener('loadedmetadata', onLoaded, { once: true });
                probe.addEventListener('error', onError, { once: true });
                probe.src = src;
            });
            let resolvedSfxTails = [];
            const probeSfxDurations = async () => {
                const items = Array.isArray(summary.audio && summary.audio.sfx) ? summary.audio.sfx : [];
                const results = await Promise.all(items.map(async item => {
                    if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) return null;
                    if (typeof item.src !== 'string' || !item.src) return null;
                    const materialDuration = await probeMediaDurationSeconds(item.src);
                    if (materialDuration === null) return null;
                    // docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2: the audible span is
                    // [in, out), not the whole material -- mirrors createPreviewAudio's decodeOne /
                    // render-cut's content-duration.mjs so a trimmed sfx only extends the predicted
                    // content duration by what actually plays.
                    const inSeconds = typeof item.in === 'number' && item.in >= 0 ? item.in : 0;
                    const rawOut = typeof item.out === 'number' && item.out > 0 ? item.out : materialDuration;
                    const outSeconds = Math.min(rawOut, materialDuration);
                    if (inSeconds >= materialDuration || outSeconds <= inSeconds) return null;
                    return item.t + (outSeconds - inSeconds);
                }));
                resolvedSfxTails = results.filter(value => typeof value === 'number');
            };
            const sfxDurationsReady = probeSfxDurations();
            const computeContentDurationSeconds = cutsEndSeconds => {
                let sfxEnd = 0;
                for (const tail of resolvedSfxTails) sfxEnd = Math.max(sfxEnd, tail);
                let layersEnd = 0;
                for (const layer of Array.isArray(summary.layers) ? summary.layers : []) {
                    const t = Number(layer && layer.t);
                    const duration = Number(layer && layer.duration);
                    if (Number.isFinite(t) && Number.isFinite(duration)) layersEnd = Math.max(layersEnd, t + duration);
                }
                return Math.max(cutsEndSeconds, sfxEnd, layersEnd);
            };
            let activeSegmentIndex = 0;
            let gapWallClockOriginMs = 0;
            let gapOutputOrigin = 0;
            let outputTime = 0;
            let isPlaying = false;
            let playToggleRenderedIsPlaying = null;
            let pausedForGapEntry = false;
            let initialPositionApplied = false;
            let zoom = 1;
            let pan = { x: 0, y: 0 };
            let drag = null;
            let suppressClick = false;
            let waveformState = 'idle';
            let waveformAudioBuffer = null;
            let waveformPeaks = null;
            let waveformResizeTimer = 0;
            let waveformDragPointer = null;
            let playbackErrored = false;
            let audioNoticeShown = false;
            let activeCaption = null;
            let styledCaptionActive = false;
            let reviewRecordingActive = false;
            let penModeActive = false;
            let currentStroke = null;
            let fadingStrokes = [];
            let sparkles = [];
            let lastStaticStrokePoints = null;
            let activeDrawRect = null;
            let penCanvasWidth = 0;
            let penCanvasHeight = 0;
            let penCanvasDpr = 1;
            let penAnimationHandle = 0;
            let platinumGradient = null;
            let staticBitmap = null;

            const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
            const penCtx = penLayer.getContext('2d');
            const createGlowSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
                gradient.addColorStop(0.4, 'rgba(226,234,255,0.55)');
                gradient.addColorStop(1, 'rgba(226,234,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                return canvas;
            };
            const createSparkleSprite = size => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                const center = size / 2;
                const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
                gradient.addColorStop(0, 'rgba(255,255,255,1)');
                gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
                gradient.addColorStop(1, 'rgba(255,255,255,0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(0, 0, size, size);
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = Math.max(1, size * 0.06);
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(center, center - size * 0.42);
                ctx.lineTo(center, center + size * 0.42);
                ctx.moveTo(center - size * 0.42, center);
                ctx.lineTo(center + size * 0.42, center);
                ctx.stroke();
                return canvas;
            };
            const glowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
            const sparkleSprite = createSparkleSprite(Math.max(48, PEN_TUNING.sparkleSpritePx * 3));
            const allocPenCanvas = () => {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                const ctx = canvas.getContext('2d');
                ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                return { canvas, ctx };
            };
            const rebuildPlatinumGradient = () => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) { platinumGradient = null; return; }
                const gradient = penCtx.createLinearGradient(0, 0, penCanvasWidth, penCanvasHeight);
                gradient.addColorStop(0, '#ffffff');
                gradient.addColorStop(0.48, '#d9deea');
                gradient.addColorStop(0.72, '#ffffff');
                gradient.addColorStop(1, '#c8cfdd');
                platinumGradient = gradient;
            };
            const drawSegment = (ctx, from, to, options) => {
                const width = (options && options.coreWidthPx) || PEN_TUNING.coreWidthPx;
                const fromPx = [from[0] * penCanvasWidth, from[1] * penCanvasHeight];
                const toPx = [to[0] * penCanvasWidth, to[1] * penCanvasHeight];
                const glowSize = PEN_TUNING.glowSizePx;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = PEN_TUNING.glowAlpha;
                ctx.drawImage(glowSprite, toPx[0] - glowSize / 2, toPx[1] - glowSize / 2, glowSize, glowSize);
                ctx.restore();
                ctx.save();
                ctx.globalAlpha = PEN_TUNING.coreAlpha;
                ctx.strokeStyle = platinumGradient || '#eef2fb';
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(fromPx[0], fromPx[1]);
                ctx.lineTo(toPx[0], toPx[1]);
                ctx.stroke();
                ctx.restore();
            };
            const paintStaticStroke = points => {
                if (!staticBitmap) return;
                for (let index = 0; index < points.length - 1; index += 1) {
                    drawSegment(staticBitmap.ctx, points[index], points[index + 1], { coreWidthPx: PEN_TUNING.staticCoreWidthPx });
                }
            };
            const redrawStrokeFull = stroke => {
                stroke.canvas.width = Math.max(1, Math.round(penCanvasWidth * penCanvasDpr));
                stroke.canvas.height = Math.max(1, Math.round(penCanvasHeight * penCanvasDpr));
                stroke.ctx.setTransform(penCanvasDpr, 0, 0, penCanvasDpr, 0, 0);
                for (let index = 0; index < stroke.points.length - 1; index += 1) {
                    drawSegment(stroke.ctx, stroke.points[index], stroke.points[index + 1]);
                }
                stroke.drawnIndex = Math.max(0, stroke.points.length - 1);
            };
            const resizePenCanvases = () => {
                const cssWidth = Math.max(1, Math.round(penLayer.clientWidth || 1));
                const cssHeight = Math.max(1, Math.round(penLayer.clientHeight || 1));
                const dpr = Math.min(PEN_TUNING.maxDevicePixelRatio, window.devicePixelRatio || 1);
                if (cssWidth === penCanvasWidth && cssHeight === penCanvasHeight && dpr === penCanvasDpr) return;
                penCanvasWidth = cssWidth;
                penCanvasHeight = cssHeight;
                penCanvasDpr = dpr;
                penLayer.width = Math.round(cssWidth * dpr);
                penLayer.height = Math.round(cssHeight * dpr);
                penCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                rebuildPlatinumGradient();
                staticBitmap = allocPenCanvas();
                if (Array.isArray(lastStaticStrokePoints)) {
                    for (const points of lastStaticStrokePoints) paintStaticStroke(points);
                }
                if (currentStroke) redrawStrokeFull(currentStroke);
                for (const fading of fadingStrokes) redrawStrokeFull(fading);
                recomposite();
            };
            const penFadeAlpha = (fading, timestamp) => {
                const now = timestamp || performance.now();
                return clamp(1 - (now - fading.fadeStartedAt) / PEN_TUNING.fadeDurationMs, 0, 1);
            };
            const updateAndDrawSparkles = (ctx, timestamp) => {
                if (sparkles.length === 0) return;
                const alive = [];
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (const sparkle of sparkles) {
                    const age = timestamp - sparkle.bornAt;
                    if (age >= sparkle.lifetimeMs) continue;
                    const fade = 1 - age / sparkle.lifetimeMs;
                    const twinkle = 0.6 + 0.4 * Math.sin((timestamp / 1000) * PEN_TUNING.sparkleTwinkleHz * Math.PI * 2 + sparkle.phase);
                    ctx.globalAlpha = clamp(fade * twinkle, 0, 1);
                    const size = sparkle.size * (0.7 + 0.3 * fade);
                    ctx.drawImage(sparkleSprite, sparkle.x - size / 2, sparkle.y - size / 2, size, size);
                    alive.push(sparkle);
                }
                ctx.restore();
                sparkles = alive;
            };
            const maybeSpawnSparkle = point => {
                for (let index = 0; index < PEN_TUNING.sparklesPerSegment; index += 1) {
                    if (sparkles.length >= PEN_TUNING.sparkleMaxPoolSize) sparkles.shift();
                    const angle = Math.random() * Math.PI * 2;
                    const jitter = Math.random() * PEN_TUNING.sparkleJitterPx;
                    sparkles.push({
                        x: point[0] * penCanvasWidth + Math.cos(angle) * jitter,
                        y: point[1] * penCanvasHeight + Math.sin(angle) * jitter,
                        bornAt: performance.now(),
                        lifetimeMs: PEN_TUNING.sparkleLifetimeMs * (0.6 + Math.random() * 0.8),
                        size: PEN_TUNING.sparkleMinSizePx + Math.random() * (PEN_TUNING.sparkleMaxSizePx - PEN_TUNING.sparkleMinSizePx),
                        phase: Math.random() * Math.PI * 2
                    });
                }
            };
            const recomposite = timestamp => {
                if (!(penCanvasWidth > 0) || !(penCanvasHeight > 0)) return;
                penCtx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                if (staticBitmap) penCtx.drawImage(staticBitmap.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                for (const fading of fadingStrokes) {
                    penCtx.globalAlpha = penFadeAlpha(fading, timestamp);
                    penCtx.drawImage(fading.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                }
                penCtx.globalAlpha = 1;
                if (currentStroke) penCtx.drawImage(currentStroke.canvas, 0, 0, penCanvasWidth, penCanvasHeight);
                updateAndDrawSparkles(penCtx, timestamp || performance.now());
            };
            const drawPendingSegments = stroke => {
                const points = stroke.points;
                while (stroke.drawnIndex < points.length - 1) {
                    const from = points[stroke.drawnIndex];
                    const to = points[stroke.drawnIndex + 1];
                    drawSegment(stroke.ctx, from, to);
                    maybeSpawnSparkle(to);
                    stroke.drawnIndex += 1;
                }
            };
            const penTick = timestamp => {
                if (currentStroke) drawPendingSegments(currentStroke);
                fadingStrokes = fadingStrokes.filter(fading => penFadeAlpha(fading, timestamp) > 0);
                recomposite(timestamp);
                const stillActive = currentStroke !== null || fadingStrokes.length > 0 || sparkles.length > 0;
                penAnimationHandle = stillActive ? requestAnimationFrame(penTick) : 0;
            };
            const ensurePenLoopRunning = () => {
                if (!penAnimationHandle) penAnimationHandle = requestAnimationFrame(penTick);
            };
            new ResizeObserver(resizePenCanvases).observe(penLayer);
            resizePenCanvases();
            const clearStaticAnnotationStrokes = () => {
                lastStaticStrokePoints = null;
                if (staticBitmap) staticBitmap.ctx.clearRect(0, 0, penCanvasWidth, penCanvasHeight);
                recomposite();
            };
            const setPenModeActive = active => {
                penModeActive = active === true && reviewRecordingActive && !isPlaying;
                penToggle.setAttribute('aria-pressed', String(penModeActive));
                penLayer.classList.toggle('is-active', penModeActive);
            };
            const abortCurrentStroke = () => {
                if (!currentStroke) return;
                const pointerId = currentStroke.pointerId;
                currentStroke = null;
                if (penLayer.hasPointerCapture(pointerId)) {
                    penLayer.releasePointerCapture(pointerId);
                }
            };
            const captureDrawRect = () => {
                const contentRect = penLayer.getBoundingClientRect();
                activeDrawRect = {
                    left: contentRect.left,
                    top: contentRect.top,
                    width: Math.max(contentRect.width, 1),
                    height: Math.max(contentRect.height, 1)
                };
            };
            const normalizedPenPoint = event => {
                const rect = activeDrawRect || (captureDrawRect(), activeDrawRect);
                return [
                    clamp((event.clientX - rect.left) / rect.width, 0, 1),
                    clamp((event.clientY - rect.top) / rect.height, 0, 1)
                ];
            };
            const createActiveStroke = (pointerId, firstPoint) => {
                const bitmap = allocPenCanvas();
                return { pointerId, points: [firstPoint], drawnIndex: 0, canvas: bitmap.canvas, ctx: bitmap.ctx };
            };
            const showStaticAnnotationStrokes = strokeSets => {
                clearStaticAnnotationStrokes();
                if (!Array.isArray(strokeSets)) return;
                const valid = [];
                for (const points of strokeSets) {
                    if (!Array.isArray(points) || points.length < 2) continue;
                    const filtered = points.filter(point => Array.isArray(point) && point.length === 2
                        && Number.isFinite(point[0]) && Number.isFinite(point[1]));
                    if (filtered.length < 2) continue;
                    valid.push(filtered);
                    paintStaticStroke(filtered);
                }
                lastStaticStrokePoints = valid.length > 0 ? valid : null;
                recomposite();
            };
            const canDraw = () => penModeActive && reviewRecordingActive && !isPlaying;
            penToggle.addEventListener('click', () => {
                if (!reviewRecordingActive || isPlaying) return;
                setPenModeActive(!penModeActive);
            });
            penLayer.addEventListener('pointerdown', event => {
                if (!canDraw() || event.button !== 0 || currentStroke) return;
                event.preventDefault();
                clearStaticAnnotationStrokes();
                penLayer.setPointerCapture(event.pointerId);
                captureDrawRect();
                const point = normalizedPenPoint(event);
                const segment = segments[activeSegmentIndex];
                const frame = {
                    timelineT: outputTime,
                    sourceT: video.currentTime,
                    cutIndex: segment && segment.kind === 'src' && Number.isInteger(segment.cutIndex)
                        ? segment.cutIndex : null
                };
                currentStroke = createActiveStroke(event.pointerId, point);
                window.akari.reviewStrokeStart(frame);
                ensurePenLoopRunning();
            });
            penLayer.addEventListener('pointermove', event => {
                if (!currentStroke || currentStroke.pointerId !== event.pointerId || !canDraw()) return;
                event.preventDefault();
                const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : null;
                const events = coalesced && coalesced.length > 0 ? coalesced : [event];
                for (const raw of events) {
                    currentStroke.points.push(normalizedPenPoint(raw));
                }
            });
            const finishPenStroke = event => {
                if (!currentStroke || currentStroke.pointerId !== event.pointerId) return;
                event.preventDefault();
                const completed = currentStroke;
                currentStroke = null;
                if (penLayer.hasPointerCapture(event.pointerId)) {
                    penLayer.releasePointerCapture(event.pointerId);
                }
                if (completed.points.length < 2) return;
                window.akari.reviewStrokeEnd(completed.points);
                completed.fadeStartedAt = performance.now();
                fadingStrokes.push(completed);
                ensurePenLoopRunning();
            };
            penLayer.addEventListener('pointerup', finishPenStroke);
            penLayer.addEventListener('pointercancel', finishPenStroke);
            // Browser webviews cannot import packages/edit-lint/src/derive-tracks.mjs. Keep this
            // copy behavior-identical to that shared function: kind groups in fixed order, each
            // ref sorted ascending, followed by singleton captions/audio tracks.
            const collectTrackNumbers = items => {
                const tracks = new Set();
                for (const item of Array.isArray(items) ? items : []) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
                    if (!Object.prototype.hasOwnProperty.call(item, 'track')) {
                        tracks.add(0);
                    } else if (Number.isInteger(item.track) && item.track >= 0) {
                        tracks.add(item.track);
                    }
                }
                return Array.from(tracks).sort((left, right) => left - right);
            };
            const deriveTracks = () => {
                const derived = [];
                const append = (kind, ref) => derived.push({
                    kind,
                    ...(ref === undefined ? {} : { ref })
                });
                for (const kind of ['cuts', 'layers', 'overlays']) {
                    for (const track of collectTrackNumbers(summary[kind])) append(kind, track);
                }
                if (summary.hasInlineCaptions) append('captions');
                if (Array.isArray(summary.audio && summary.audio.sfx)
                    && summary.audio.sfx.length > 0) append('audio', 0);
                return derived;
            };
            const resolvedTracks = Array.isArray(summary.timelineTracks)
                ? summary.timelineTracks : deriveTracks();
            const visualTrackZ = new Map();
            resolvedTracks.forEach((track, index) => {
                if ((track.kind === 'cuts' || track.kind === 'layers') && Number.isInteger(track.ref)) {
                    // Keep every cuts/layers element below #overlay-stage (z-index: 1) while
                    // retaining timeline.tracks' bottom-to-top relative order.
                    visualTrackZ.set(track.kind + ':' + track.ref, index - resolvedTracks.length);
                }
            });
            const zForTrack = (kind, track) => {
                const declared = visualTrackZ.get(kind + ':' + track);
                return declared === undefined ? -resolvedTracks.length - track - 1 : declared;
            };
            const applyCutsZIndex = segment => {
                if (segment && segment.kind === 'src') {
                    video.style.zIndex = String(zForTrack('cuts', segment.track));
                }
            };
            const applyCutVisual = segment => {
                if (!segment || segment.kind !== 'src') {
                    video.dataset.akariCutTransformActive = 'false';
                    video.style.transform = '';
                    video.style.opacity = '';
                    video.dataset.akariCutIndex = '';
                    // ㉓ ギャップ等クリック選択の対象外へ移った場合は選択を外す
                    // （deselectCut は後段で定義される const だが、実際の呼び出しは
                    // 常にトップレベルスクリプト完了後の非同期経路のため安全）。
                    if (typeof deselectCut === 'function') deselectCut({ report: true });
                    return;
                }
                const transform = segment.transform;
                if (transform) {
                    const x = Number.isFinite(transform.x) ? transform.x : 0;
                    const y = Number.isFinite(transform.y) ? transform.y : 0;
                    const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                    const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                    video.dataset.akariCutTransformActive = 'true';
                    video.dataset.akariTransformX = String(x);
                    video.dataset.akariTransformY = String(y);
                    video.dataset.akariTransformScale = String(scale);
                    video.dataset.akariTransformRotate = String(rotate);
                } else {
                    video.dataset.akariCutTransformActive = 'false';
                }
                video.style.opacity = Number.isFinite(segment.opacity) ? String(segment.opacity) : '';
                video.dataset.akariCutIndex = Number.isInteger(segment.cutIndex) ? String(segment.cutIndex) : '';
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (typeof updateCutSelectBox === 'function') updateCutSelectBox();
            };
            const layerEntries = (Array.isArray(summary.layers) ? summary.layers : []).map((layer, index) => {
                const layerVideo = document.createElement('video');
                layerVideo.muted = true;
                layerVideo.playsInline = true;
                layerVideo.preload = 'auto';
                layerVideo.tabIndex = -1;
                layerVideo.disablePictureInPicture = true;
                // アルファ実測（選択枠のコンテンツフィット・透明素通し）で canvas に描くため。
                // ストリームサーバは Access-Control-Allow-Origin: * を返す
                layerVideo.crossOrigin = 'anonymous';
                layerVideo.dataset.akariLayerId = String(layer.id);
                layerVideo.dataset.akariLayerIndex = String(index);
                layerVideo.dataset.akariLayerKind = String(layer.kind);
                layerVideo.style.opacity = String(layer.opacity);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                layerVideo.style.zIndex = String(zForTrack('layers', layer.track));
                const transform = layer.transform || {};
                const x = Number.isFinite(transform.x) ? transform.x : 0;
                const y = Number.isFinite(transform.y) ? transform.y : 0;
                const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                layerVideo.dataset.akariTransformX = String(x);
                layerVideo.dataset.akariTransformY = String(y);
                layerVideo.dataset.akariTransformScale = String(scale);
                layerVideo.dataset.akariTransformRotate = String(rotate);
                const crop = layer.crop;
                const cropW = crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1;
                const cropH = crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1;
                layerVideo.dataset.akariCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
                layerVideo.dataset.akariCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
                layerVideo.dataset.akariCropW = String(cropW);
                layerVideo.dataset.akariCropH = String(cropH);
                // ㉖ layers[].perspective（contract-2026-08-02-preview-parity.md §2.4.4）。absent/invalid
                // (schema-invalid corners, etc.) is represented as an empty dataset value --
                // updateStageScale's computeLayerPerspectiveVisualFn call already treats a falsy/
                // unparseable value as "no perspective", so no separate validity flag is needed here.
                const perspectiveCorners = layer.perspective && Array.isArray(layer.perspective.corners) ? layer.perspective.corners : null;
                if (perspectiveCorners) layerVideo.dataset.akariPerspectiveCorners = JSON.stringify(perspectiveCorners);
                else delete layerVideo.dataset.akariPerspectiveCorners;
                const position = () => {
                    if (!(layerVideo.videoWidth > 0) || !(layerVideo.videoHeight > 0)) return;
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                };
                layerVideo.addEventListener('loadedmetadata', () => {
                    position();
                    tick(true);
                });
                layerVideo.addEventListener('error', () => {
                    layerVideo.style.display = 'none';
                    console.warn('[akari-preview] layer media failed to load', layer.id);
                });
                if (typeof layer.src === 'string' && layer.src) {
                    layerVideo.src = layer.src;
                }
                layersStage.appendChild(layerVideo);
                return { spec: layer, video: layerVideo };
            });
            // CF-select + transform ハンドル: レイヤー実体のクリック選択・タイムラインとの双方向同期・
            // プレビュー内ドラッグ移動/リサイズ(=scale)/回転。確定(pointerup)時のみ layerWrite で
            // 書き戻す（既存 overlay ドラッグ編集と同じ確定タイミング）。
            let selectedLayerId = null;
            // ㉔ クロップモード（2026-08-06 オーナー裁定: shell/Web 両面）。移動/リサイズ/回転と
            // 操作が衝突しないための排他モード切替。選択が変わったら自動的に抜ける。
            let cropModeActive = false;
            const layerCropBox = document.getElementById('layer-crop-box');
            const layerCropRect = layerCropBox.querySelector('.akari-layer-crop-rect');
            const layerCropHandleElements = Array.from(layerCropBox.querySelectorAll('[data-akari-crop-handle]'));
            const layerCropToggle = document.getElementById('layer-crop-toggle');
            // ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ。4隅の
            // 直接ドラッグハンドルは次段のため、クロップのようなハンドル/モードの仕組みは持たない。
            let perspectivePanelOpen = false;
            let activePerspectivePreset = null;
            const layerPerspectiveToggle = document.getElementById('layer-perspective-toggle');
            const layerPerspectivePanel = document.getElementById('layer-perspective-panel');
            const layerPerspectivePresetButtons = Array.from(layerPerspectivePanel.querySelectorAll('[data-akari-perspective-preset]'));
            const layerPerspectiveAngleInput = layerPerspectivePanel.querySelector('[data-akari-perspective-angle]');
            const layerPerspectiveAngleValueEl = layerPerspectivePanel.querySelector('[data-akari-perspective-angle-value]');
            const layerPerspectiveClearButton = layerPerspectivePanel.querySelector('[data-akari-perspective-clear]');
            const layerSelectBox = document.getElementById('layer-select-box');
            const layerHandleElements = Array.from(layerSelectBox.querySelectorAll('[data-akari-handle]'));
            const findLayerEntry = id => layerEntries.find(entry => String(entry.spec.id) === String(id));
            const layerTransformNow = entry => ({
                x: Number(entry.video.dataset.akariTransformX) || 0,
                y: Number(entry.video.dataset.akariTransformY) || 0,
                scale: Number(entry.video.dataset.akariTransformScale) || 1,
                rotate: Number(entry.video.dataset.akariTransformRotate) || 0
            });
            const applyLayerTransformNow = (entry, transform) => {
                entry.video.dataset.akariTransformX = String(transform.x);
                entry.video.dataset.akariTransformY = String(transform.y);
                entry.video.dataset.akariTransformScale = String(transform.scale);
                entry.video.dataset.akariTransformRotate = String(transform.rotate);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                updateLayerSelectBox();
            };
            // ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的）。CROP_MIN は空クロップ化を防ぐ
            // 下限（ハンドルが操作不能になる縮退を避ける）。clampCrop は render-cut/src/layers.mjs の
            // クランプと同じ意味論をプレビュー側で独立実装したもの（パリティ契約が明記する意図的な
            // コード重複の方針に倣う — 2.2 節の描画既定などと同型）。
            const CROP_MIN = 0.02;
            const clampCrop = (x, y, w, h) => {
                const cw = Math.min(1, Math.max(CROP_MIN, Number.isFinite(w) ? w : 1));
                const ch = Math.min(1, Math.max(CROP_MIN, Number.isFinite(h) ? h : 1));
                const cx = Math.min(1 - cw, Math.max(0, Number.isFinite(x) ? x : 0));
                const cy = Math.min(1 - ch, Math.max(0, Number.isFinite(y) ? y : 0));
                return { x: cx, y: cy, w: cw, h: ch };
            };
            const layerCropNow = entry => clampCrop(
                Number(entry.video.dataset.akariCropX),
                Number(entry.video.dataset.akariCropY),
                Number(entry.video.dataset.akariCropW),
                Number(entry.video.dataset.akariCropH)
            );
            const applyLayerCropNow = (entry, crop) => {
                const c = clampCrop(crop.x, crop.y, crop.w, crop.h);
                entry.video.dataset.akariCropX = String(c.x);
                entry.video.dataset.akariCropY = String(c.y);
                entry.video.dataset.akariCropW = String(c.w);
                entry.video.dataset.akariCropH = String(c.h);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                if (cropModeActive) updateLayerCropBox();
                else updateLayerSelectBox();
            };
            // ベイクテロップは全面サイズの透明動画なので、要素の箱で選択枠を描くと画面いっぱいに
            // なり分かりにくい。現フレームのアルファを実測し、不透明領域（コンテンツ）へ枠を
            // フィットさせ、透明部分のクリックは下へ素通しする。計測不能（CORS 等）時は従来挙動
            const layerAlphaCanvasEl = document.createElement('canvas');
            // 画面クライアント座標 → ソース動画のネイティブ px 座標への逆写像。pivot（回転・平行移動の
            // 基準点、ソース px 空間）を外から渡せるようにし、通常のヒットテスト（pivot=クロップ中心 =
            // 実際の合成基準点）とクロップモードの編集（pivot=全面中心 = 常に自分の中心で回る素直な
            // 参照系）の両方から共有する。
            const layerVideoPointForPivot = (entry, transform, pivotPx, clientX, clientY) => {
                const p = window.akari.interaction && window.akari.interaction.stageLocalPoint
                    ? window.akari.interaction.stageLocalPoint(clientX, clientY) : null;
                if (!p) return null;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const dx = p.x - (outputWidth / 2 + transform.x);
                const dy = p.y - (outputHeight / 2 + transform.y);
                const rad = -transform.rotate * Math.PI / 180;
                const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
                return { x: rx / (transform.scale || 1) + pivotPx.x, y: ry / (transform.scale || 1) + pivotPx.y };
            };
            const layerVideoPointFor = (entry, clientX, clientY) => {
                const t = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * entry.video.videoWidth,
                    y: (crop.y + crop.h / 2) * entry.video.videoHeight
                };
                const point = layerVideoPointForPivot(entry, t, pivotPx, clientX, clientY);
                if (!point) return null;
                const { x: vx, y: vy } = point;
                if (!(vx >= 0) || !(vy >= 0) || vx >= entry.video.videoWidth || vy >= entry.video.videoHeight) return null;
                return { x: Math.floor(vx), y: Math.floor(vy) };
            };
            // 画面座標への正写像（layerVideoPointForPivot の逆）。videoRect はソース px 空間の矩形
            // （全面フレーム or クロップ矩形）、pivotPx は回転・平行移動の基準点（同じくソース px）。
            // updateLayerSelectBox（pivot=クロップ中心）とクロップモードの外枠/内枠描画
            // （pivot=全面中心）の両方から共有する。
            const layerScreenRectForVideoRect = (entry, transform, videoRect, pivotPx) => {
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const outputW = videoRect.w * transform.scale;
                const outputH = videoRect.h * transform.scale;
                const offX = (videoRect.x + videoRect.w / 2 - pivotPx.x) * transform.scale;
                const offY = (videoRect.y + videoRect.h / 2 - pivotPx.y) * transform.scale;
                const rad = transform.rotate * Math.PI / 180;
                const rotOffX = offX * Math.cos(rad) - offY * Math.sin(rad);
                const rotOffY = offX * Math.sin(rad) + offY * Math.cos(rad);
                const outputCenterX = outputWidth / 2 + transform.x + rotOffX;
                const outputCenterY = outputHeight / 2 + transform.y + rotOffY;
                const screenW = outputW * frameScale;
                const screenH = outputH * frameScale;
                const screenCenterX = frameRect.x + outputCenterX * frameScale;
                const screenCenterY = frameRect.y + outputCenterY * frameScale;
                return { left: screenCenterX - screenW / 2, top: screenCenterY - screenH / 2, width: screenW, height: screenH, rotOffX, rotOffY };
            };
            const layerAlphaAtPoint = (entry, clientX, clientY) => {
                try {
                    if (!(entry.video.videoWidth > 0) || entry.video.readyState < 2) return 255;
                    const vp = layerVideoPointFor(entry, clientX, clientY);
                    if (!vp) return 0;
                    layerAlphaCanvasEl.width = 1;
                    layerAlphaCanvasEl.height = 1;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, 1, 1);
                    ctx.drawImage(entry.video, vp.x, vp.y, 1, 1, 0, 0, 1, 1);
                    return ctx.getImageData(0, 0, 1, 1).data[3];
                } catch (_error) {
                    return 255;
                }
            };
            const measureLayerOpaqueBox = entry => {
                try {
                    const vw = entry.video.videoWidth;
                    const vh = entry.video.videoHeight;
                    if (!(vw > 0) || !(vh > 0) || entry.video.readyState < 2) return null;
                    const shrink = Math.min(1, 320 / Math.max(vw, vh));
                    const w = Math.max(1, Math.round(vw * shrink));
                    const h = Math.max(1, Math.round(vh * shrink));
                    layerAlphaCanvasEl.width = w;
                    layerAlphaCanvasEl.height = h;
                    const ctx = layerAlphaCanvasEl.getContext('2d', { willReadFrequently: true });
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(entry.video, 0, 0, w, h);
                    const data = ctx.getImageData(0, 0, w, h).data;
                    let minX = w, minY = h, maxX = -1, maxY = -1;
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            if (data[(y * w + x) * 4 + 3] > 16) {
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    if (maxX < 0) return null;
                    const sx = vw / w;
                    const sy = vh / h;
                    const pad = Math.max(4, sx * 1.5);
                    return {
                        x: Math.max(0, minX * sx - pad),
                        y: Math.max(0, minY * sy - pad),
                        w: Math.min(vw, (maxX - minX + 1) * sx + pad * 2),
                        h: Math.min(vh, (maxY - minY + 1) * sy + pad * 2)
                    };
                } catch (_error) {
                    return null;
                }
            };
            const updateLayerSelectBox = () => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                if (!entry || entry.video.style.display === 'none' || !(entry.video.videoWidth > 0)) {
                    layerSelectBox.classList.remove('is-active');
                    positionLayerCropToggle(null);
                    positionLayerPerspectiveToggle(null);
                    return;
                }
                const transform = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                // 枠は要素の箱ではなく不透明領域（コンテンツ）にフィットさせる（未計測なら計測）。
                // フレーム未着で測れないうちは全面フォールバック枠を一瞬見せず、届いてから出す
                if (entry.opaqueBox === undefined) {
                    if (entry.video.readyState >= 2) {
                        entry.opaqueBox = measureLayerOpaqueBox(entry);
                    } else {
                        layerSelectBox.classList.remove('is-active');
                        entry.video.addEventListener('loadeddata', () => updateLayerSelectBox(), { once: true });
                        return;
                    }
                }
                const naturalBox = entry.opaqueBox || { x: 0, y: 0, w: entry.video.videoWidth, h: entry.video.videoHeight };
                // ㉔ クロップ窓（ソース px 空間）と不透明領域の交差 = 実際に見えている範囲。交差が無い
                // （クロップが不透明領域を完全に外した）場合はクロップ窓そのものへフォールバックする。
                const cropBoxPx = {
                    x: crop.x * entry.video.videoWidth,
                    y: crop.y * entry.video.videoHeight,
                    w: crop.w * entry.video.videoWidth,
                    h: crop.h * entry.video.videoHeight
                };
                const ix0 = Math.max(naturalBox.x, cropBoxPx.x);
                const iy0 = Math.max(naturalBox.y, cropBoxPx.y);
                const ix1 = Math.min(naturalBox.x + naturalBox.w, cropBoxPx.x + cropBoxPx.w);
                const iy1 = Math.min(naturalBox.y + naturalBox.h, cropBoxPx.y + cropBoxPx.h);
                const cb = (ix1 > ix0 && iy1 > iy0) ? { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 } : cropBoxPx;
                // ピボット（拡縮・回転の基準点）は実際の合成と同じくクロップ矩形の中心
                // （render-cut は crop→scale→rotate→overlay の順で合成し、overlay の中心合わせは
                // crop 後の frame 基準になるため — layers.mjs 参照）。
                const pivotPx = {
                    x: (crop.x + crop.w / 2) * entry.video.videoWidth,
                    y: (crop.y + crop.h / 2) * entry.video.videoHeight
                };
                const box = layerScreenRectForVideoRect(entry, transform, cb, pivotPx);
                layerSelectBox.style.left = box.left + 'px';
                layerSelectBox.style.top = box.top + 'px';
                layerSelectBox.style.width = box.width + 'px';
                layerSelectBox.style.height = box.height + 'px';
                layerSelectBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                // ハンドルの拡縮・回転ピボット（= クロップ矩形の中心）を箱から逆算するためのオフセット
                layerSelectBox.dataset.akariPivotOffX = String(box.rotOffX);
                layerSelectBox.dataset.akariPivotOffY = String(box.rotOffY);
                layerSelectBox.classList.add('is-active');
                if (!cropModeActive) positionLayerCropToggle(box);
                if (!cropModeActive) positionLayerPerspectiveToggle(box);
                layerPerspectiveToggle.classList.toggle('is-declared', !!layerPerspectiveNow(entry));
            };
            // クロップトグルボタンは通常枠/クロップ枠のどちらが出ていても常に同じ場所（右上角の外側）
            // に留まり続ける（モード切替のたびに探し直させない）。box=null でレイヤー未選択として隠す。
            const positionLayerCropToggle = box => {
                if (!box) {
                    layerCropToggle.classList.remove('is-target-active');
                    return;
                }
                // 箱の上端が画面上端に近いと「箱の外側・上」が画面外へはみ出す。0 未満にはせず、
                // 収まらないときは箱の内側上端へフォールバックする。
                layerCropToggle.style.left = (box.left + box.width + 4) + 'px';
                layerCropToggle.style.top = Math.max(4, box.top - 26) + 'px';
                layerCropToggle.classList.add('is-target-active');
            };
            // クロップモードのオーバーレイ: 外枠はソースフレーム全体（クロップ無しなら見えていたはずの
            // 範囲）、内枠が現在のクロップ窓。pivot は意図的に全面中心固定（クロップ現在値による
            // ピボットのドリフトを避け、常に自分の中心で回る素直な参照系にする — 実合成の pivot とは
            // 異なるが、これは編集中だけの近似で書き出し自体には影響しない）。
            const updateLayerCropBox = () => {
                const entry = selectedLayerId ? findLayerEntry(selectedLayerId) : undefined;
                if (!cropModeActive || !entry || entry.video.style.display === 'none' || !(entry.video.videoWidth > 0)) {
                    layerCropBox.classList.remove('is-active');
                    return;
                }
                const transform = layerTransformNow(entry);
                const crop = layerCropNow(entry);
                const vw = entry.video.videoWidth;
                const vh = entry.video.videoHeight;
                const pivotPx = { x: vw / 2, y: vh / 2 };
                const outer = layerScreenRectForVideoRect(entry, transform, { x: 0, y: 0, w: vw, h: vh }, pivotPx);
                const inner = layerScreenRectForVideoRect(entry, transform, { x: crop.x * vw, y: crop.y * vh, w: crop.w * vw, h: crop.h * vh }, pivotPx);
                layerCropBox.style.left = outer.left + 'px';
                layerCropBox.style.top = outer.top + 'px';
                layerCropBox.style.width = outer.width + 'px';
                layerCropBox.style.height = outer.height + 'px';
                layerCropBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                layerCropRect.style.left = (inner.left - outer.left) + 'px';
                layerCropRect.style.top = (inner.top - outer.top) + 'px';
                layerCropRect.style.width = inner.width + 'px';
                layerCropRect.style.height = inner.height + 'px';
                layerCropBox.classList.add('is-active');
                positionLayerCropToggle(outer);
            };
            const setCropMode = active => {
                cropModeActive = !!(active && selectedLayerId);
                // ㉖ クロップモードとパースパネルは排他（ハンドル/操作の衝突を避ける）。
                if (cropModeActive && perspectivePanelOpen) setPerspectivePanelOpen(false);
                layerCropToggle.classList.toggle('is-crop-mode', cropModeActive);
                layerSelectBox.classList.toggle('akari-crop-mode-hide-handles', cropModeActive);
                if (cropModeActive) {
                    updateLayerCropBox();
                } else {
                    layerCropBox.classList.remove('is-active');
                    updateLayerSelectBox();
                }
            };
            // click ではなく pointerdown+pointerup（setPointerCapture 付き）で拾う — 再生中は毎フレーム
            // positionLayerCropToggle が呼ばれてボタンが数 px 動くため、down/up の間にボタンが動くと
            // click イベントの合成対象がズレて発火しなくなることがある（実マウス操作で再現・
            // 実測確認済み）。ドラッグハンドルと同じ pointer capture 方式にして確実に拾う。
            layerCropToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerCropToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerCropToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setCropMode(!cropModeActive);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && cropModeActive) setCropMode(false);
            });
            // ㉖ layers[].perspective（v0）: 常に同じ場所（クロップトグルの下）に留まるトグル + パネル。
            // box=null でレイヤー未選択として隠す（クロップトグルと同じ規律）。
            const positionLayerPerspectiveToggle = box => {
                if (!box) {
                    layerPerspectiveToggle.classList.remove('is-target-active');
                    if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                    return;
                }
                layerPerspectiveToggle.style.left = (box.left + box.width + 4) + 'px';
                layerPerspectiveToggle.style.top = Math.max(4, box.top - 26) + 26 + 4 + 'px';
                layerPerspectiveToggle.classList.add('is-target-active');
                if (perspectivePanelOpen) {
                    layerPerspectivePanel.style.left = layerPerspectiveToggle.style.left;
                    layerPerspectivePanel.style.top = (parseFloat(layerPerspectiveToggle.style.top) + 26 + 4) + 'px';
                }
            };
            const layerPerspectiveNow = entry => {
                const raw = entry.video.dataset.akariPerspectiveCorners;
                if (!raw) return null;
                try {
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
                } catch (_error) {
                    return null;
                }
            };
            const applyLayerPerspectiveNow = (entry, corners) => {
                if (corners) entry.video.dataset.akariPerspectiveCorners = JSON.stringify(corners);
                else delete entry.video.dataset.akariPerspectiveCorners;
                layerPerspectiveToggle.classList.toggle('is-declared', !!corners);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
            };
            // プリセット→4隅の展開（v0）。SSOT は保存される4隅のみ — このツマミはオーサリング側の
            // 便宜であり、schema には「プリセット」「角度」という概念自体は存在しない
            // (contract-2026-08-02-preview-parity.md §2.4.4)。奥行き感は sin(角度) で圧縮量を決め、
            // 該当する辺の中点方向へ両端点を寄せる（角度0=無変形、角度が大きいほど強い台形）。
            const perspectivePresetCorners = (preset, angleDeg) => {
                const compression = Math.max(0, Math.min(0.9, Math.sin((Number(angleDeg) || 0) * Math.PI / 180)));
                const half = compression / 2;
                if (preset === 'right') return [[0, 0], [1, half], [0, 1], [1, 1 - half]];
                if (preset === 'left') return [[0, half], [1, 0], [0, 1 - half], [1, 1]];
                if (preset === 'top') return [[half, 0], [1 - half, 0], [0, 1], [1, 1]];
                if (preset === 'bottom') return [[0, 0], [1, 0], [half, 1], [1 - half, 1]];
                return null;
            };
            const commitLayerPerspective = async (entry, corners) => {
                const original = layerPerspectiveNow(entry);
                applyLayerPerspectiveNow(entry, corners);
                try {
                    await window.akari.engine.layerWrite(entry.spec.id, { perspective: corners ? { corners } : null });
                } catch (error) {
                    console.warn('[akari-preview] layer perspective write rejected; reverting', error);
                    applyLayerPerspectiveNow(entry, original);
                }
            };
            const setPerspectivePanelOpen = open => {
                perspectivePanelOpen = !!(open && selectedLayerId);
                layerPerspectiveToggle.classList.toggle('is-panel-open', perspectivePanelOpen);
                layerPerspectivePanel.classList.toggle('is-open', perspectivePanelOpen);
                if (perspectivePanelOpen) {
                    if (cropModeActive) setCropMode(false);
                    updateLayerSelectBox();
                }
            };
            layerPerspectiveToggle.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveToggle.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveToggle.addEventListener('pointerup', event => {
                event.stopPropagation();
                setPerspectivePanelOpen(!perspectivePanelOpen);
            });
            for (const button of layerPerspectivePresetButtons) {
                button.addEventListener('pointerdown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try { button.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
                });
                button.addEventListener('pointerup', event => {
                    event.stopPropagation();
                    if (!selectedLayerId) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const preset = button.getAttribute('data-akari-perspective-preset');
                    activePerspectivePreset = preset;
                    for (const other of layerPerspectivePresetButtons) other.classList.toggle('is-active', other === button);
                    const corners = perspectivePresetCorners(preset, layerPerspectiveAngleInput.value);
                    void commitLayerPerspective(entry, corners);
                });
            }
            layerPerspectiveAngleInput.addEventListener('input', () => {
                layerPerspectiveAngleValueEl.textContent = layerPerspectiveAngleInput.value + '°';
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                // ライブプレビューのみ（書き戻しはしない） -- ドラッグ中に毎回 lint/書き込みを
                // 往復させないため、既存の crop ハンドルと同じ「確定時のみ書き戻す」規律に倣う。
                applyLayerPerspectiveNow(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
            });
            layerPerspectiveAngleInput.addEventListener('change', () => {
                if (!activePerspectivePreset || !selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                void commitLayerPerspective(entry, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
            });
            layerPerspectiveClearButton.addEventListener('pointerdown', event => {
                event.preventDefault();
                event.stopPropagation();
                try { layerPerspectiveClearButton.setPointerCapture(event.pointerId); } catch (_error) { /* not capturable */ }
            });
            layerPerspectiveClearButton.addEventListener('pointerup', event => {
                event.stopPropagation();
                if (!selectedLayerId) return;
                const entry = findLayerEntry(selectedLayerId);
                if (!entry) return;
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                void commitLayerPerspective(entry, null);
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape' && perspectivePanelOpen) setPerspectivePanelOpen(false);
            });
            const selectLayer = (layerId, options) => {
                const report = !options || options.report !== false;
                const nextId = layerId && findLayerEntry(layerId) ? layerId : null;
                if (nextId === selectedLayerId) {
                    updateLayerSelectBox();
                    return;
                }
                if (cropModeActive) setCropMode(false);
                if (perspectivePanelOpen) setPerspectivePanelOpen(false);
                activePerspectivePreset = null;
                for (const button of layerPerspectivePresetButtons) button.classList.remove('is-active');
                selectedLayerId = nextId;
                // ㉓ 選択の排他制御: layer を選ぶと cut/caption 選択は外れる（逆方向はそれぞれの select 側）。
                if (nextId && typeof deselectCut === 'function') deselectCut({ report: true });
                if (nextId && typeof deselectCaption === 'function') deselectCaption({ report: true });
                if (nextId) {
                    const measured = findLayerEntry(nextId);
                    // 選択時点のフレームで測り直す（updateLayerSelectBox が遅延計測する）
                    if (measured) measured.opaqueBox = undefined;
                }
                updateLayerSelectBox();
                if (report) window.akari.reportLayerSelection(selectedLayerId);
            };
            // ㉒ スナップ統一: layers[]（この後 cut/caption も同型）の移動・拡縮を、
            // interaction.js（overlay-runtime、overlays[] 用スナップの単一正本）が公開する
            // computeSnapCorrection/stageLocalPoint/showSnapGuides/hideSnapGuides へ委譲する。
            // 出力px（video座標）系の bounds を渡すだけで、キャンバス端5%セーフマージン+
            // センター縦横・8px吸着/12px解除（表示px基準=ズーム下でも見た目8px相当）・
            // ガイド線が overlays[] と完全に同一挙動になる（旧実装は resize/layers[] とも
            // スナップ皆無だった）。
            const outputBoundsForCenteredBox = (centerX, centerY, boxWidth, boxHeight) => ({
                left: centerX - boxWidth / 2,
                right: centerX + boxWidth / 2,
                top: centerY - boxHeight / 2,
                bottom: centerY + boxHeight / 2,
                centerX,
                centerY
            });
            const layerOutputBoundsForTransform = (entry, transform) => {
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                // ㉔ crop 適用中は見えている（=スナップ対象になるべき）footprint が cropW/cropH 分
                // 小さいので、フルサイズではなくクロップ後の寸法で bounds を組む。
                const crop = layerCropNow(entry);
                return outputBoundsForCenteredBox(
                    outputWidth / 2 + transform.x,
                    outputHeight / 2 + transform.y,
                    (entry.video.videoWidth || 0) * crop.w * transform.scale,
                    (entry.video.videoHeight || 0) * crop.h * transform.scale
                );
            };
            // センターピボットの拡縮（layers[]・cut は共に中心固定で scale する）を、
            // computeSnapCorrection() の left/center/right 一致点から scale へ逆算する。
            // center（sourceIndex===1）は scale では動かせないため候補から除外し、
            // left/right（または top/bottom）のどちらか近い方だけを採用する
            // （uniform scale の制約上 overlays[] resize と同じく一度に1軸のみ）。
            const solveCenteredResizeSnap = (bounds, naturalWidth, naturalHeight, currentScale, previousSnap) => {
                const snap = window.akari.interaction.computeSnapCorrection(bounds, previousSnap);
                const halfW = (bounds.right - bounds.left) / 2;
                const halfH = (bounds.bottom - bounds.top) / 2;
                const axisCandidate = (snapEntry, half, natural) => {
                    if (!snapEntry || snapEntry.sourceIndex === 1 || !(half > 0) || !(natural > 0)) return null;
                    const sign = snapEntry.sourceIndex === 2 ? 1 : -1;
                    const nextHalf = half + sign * snapEntry.correction;
                    if (!(nextHalf > 0)) return null;
                    return { snap: snapEntry, scale: (nextHalf * 2) / natural };
                };
                const candidateX = axisCandidate(snap.x, halfW, naturalWidth);
                const candidateY = axisCandidate(snap.y, halfH, naturalHeight);
                let chosen = null;
                if (candidateX) chosen = { axis: 'x', ...candidateX };
                if (candidateY && (!chosen || Math.abs(candidateY.snap.correction) < Math.abs(chosen.snap.correction))) {
                    chosen = { axis: 'y', ...candidateY };
                }
                if (!chosen) {
                    window.akari.interaction.hideSnapGuides();
                    return { scale: currentScale, snapX: null, snapY: null };
                }
                window.akari.interaction.showSnapGuides(
                    chosen.axis === 'x' ? chosen.snap : null,
                    chosen.axis === 'y' ? chosen.snap : null
                );
                return {
                    scale: chosen.scale,
                    snapX: chosen.axis === 'x' ? chosen.snap : null,
                    snapY: chosen.axis === 'y' ? chosen.snap : null
                };
            };
            // CF-write: layerWrite 確定 → 失敗時は元の値へ視覚的に巻き戻す（既存 overlay 編集と同じ規約）。
            const beginLayerTransformDrag = (entry, startEvent, computeTransform) => {
                startEvent.preventDefault();
                startEvent.stopPropagation();
                const pointerId = startEvent.pointerId;
                const original = layerTransformNow(entry);
                const captureTarget = startEvent.currentTarget;
                let moved = false;
                let cancelled = false;
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    window.akari.interaction?.hideSnapGuides?.();
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startEvent.clientX;
                    const dy = moveEvent.clientY - startEvent.clientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    applyLayerTransformNow(entry, computeTransform(moveEvent, original));
                };
                const finish = async () => {
                    cleanup();
                    if (cancelled) {
                        applyLayerTransformNow(entry, original);
                        return;
                    }
                    if (!moved) return;
                    const finalTransform = layerTransformNow(entry);
                    try {
                        await window.akari.engine.layerWrite(entry.spec.id, { transform: finalTransform });
                    } catch (error) {
                        console.warn('[akari-preview] layer transform write rejected; reverting', error);
                        applyLayerTransformNow(entry, original);
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                window.addEventListener('keydown', onKeyDown, true);
            };
            // #overlay-stage covers the whole frame with pointer-events:auto (needed so overlays'
            // own interaction chrome stays clickable) and paints above #preview-layers, so it is
            // always the real hit-test target within the frame. A plain per-video pointerdown
            // listener would therefore never fire. Delegate from the stage instead: when the
            // click's direct target is the stage element itself (not an actual overlay or its
            // interaction chrome, which would make the target a descendant), look for a layer
            // video underneath via elementsFromPoint.
            stage.addEventListener('pointerdown', event => {
                // ㉔ クロップモード中は移動/選択切り替えと操作が衝突しないよう、選択中レイヤーの
                // ボディドラッグを含め本編ステージの通常操作を止める（ハンドルは別要素なので
                // このガードの影響を受けない）。
                if (event.button !== 0 || zoom > 1.05 || event.target !== stage || cropModeActive) return;
                // ㉓ #preview-video も #overlay-stage の裏に隠れる同じ事情のため、layer video と
                // 同じ elementsFromPoint 委譲に相乗りする（実際の z-order は zForTrack() 経由で
                // cuts/layers が混在し得るため、ヒットテスト順=画面上の重なり順をそのまま使う）。
                const hit = document.elementsFromPoint(event.clientX, event.clientY)
                    .find(candidate => {
                        if (candidate === video) return true;
                        if (!(candidate.tagName === 'VIDEO' && candidate.dataset
                            && candidate.dataset.akariLayerId && candidate.style.display !== 'none')) return false;
                        // 全面サイズの透明動画（ベイクテロップ）は箱で当てると画面全部が当たりになる。
                        // クリック地点のアルファを実測し、透明部分は下（別レイヤー / 本編）へ素通し
                        const candidateEntry = findLayerEntry(candidate.dataset.akariLayerId);
                        return !candidateEntry || layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                    });
                if (!hit) return;
                if (hit === video) {
                    if (video.dataset.akariCutIndex === '' || video.dataset.akariCutIndex === undefined) return;
                    selectCut();
                    const startPoint = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                    let dragSnap = { x: null, y: null };
                    beginCutTransformDrag(event, (moveEvent, original) => {
                        const nowPoint = window.akari.interaction?.stageLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
                        const frameScale = window.akari.stageScale() || 1;
                        let nextX = original.x;
                        let nextY = original.y;
                        if (startPoint && nowPoint) {
                            nextX = original.x + (nowPoint.x - startPoint.x);
                            nextY = original.y + (nowPoint.y - startPoint.y);
                        } else {
                            nextX = original.x + (moveEvent.clientX - event.clientX) / frameScale;
                            nextY = original.y + (moveEvent.clientY - event.clientY) / frameScale;
                        }
                        if (moveEvent.shiftKey || !window.akari.interaction) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const outputWidth = Number(summary.output && summary.output.width) || 1280;
                            const outputHeight = Number(summary.output && summary.output.height) || 720;
                            const bounds = outputBoundsForCenteredBox(
                                outputWidth / 2 + nextX, outputHeight / 2 + nextY,
                                outputWidth * original.scale, outputHeight * original.scale
                            );
                            const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap);
                            dragSnap = snap;
                            if (snap.x) nextX += snap.x.correction;
                            if (snap.y) nextY += snap.y.correction;
                            window.akari.interaction.showSnapGuides(snap.x, snap.y);
                        }
                        return { ...original, x: nextX, y: nextY };
                    });
                    return;
                }
                const entry = findLayerEntry(hit.dataset.akariLayerId);
                if (!entry) return;
                selectLayer(entry.spec.id);
                // stageLocalPoint() は #overlay-stage の getBoundingClientRect() 由来のため、
                // #zoom-layer のプレビューズーム(scale(zoom))と #overlay-stage 自身の
                // frameScale の両方を含む倍率で client px → 出力px を変換する（旧実装の
                // window.akari.stageScale()単独＝frameScaleのみだと zoom 抜け漏れでズーム下の
                // ドラッグ量が不正確になっていた）。
                const startPoint = window.akari.interaction?.stageLocalPoint?.(event.clientX, event.clientY);
                let dragSnap = { x: null, y: null };
                beginLayerTransformDrag(entry, event, (moveEvent, original) => {
                    const nowPoint = window.akari.interaction?.stageLocalPoint?.(moveEvent.clientX, moveEvent.clientY);
                    let nextX = original.x;
                    let nextY = original.y;
                    if (startPoint && nowPoint) {
                        nextX = original.x + (nowPoint.x - startPoint.x);
                        nextY = original.y + (nowPoint.y - startPoint.y);
                    } else {
                        const frameScale = window.akari.stageScale() || 1;
                        nextX = original.x + (moveEvent.clientX - event.clientX) / frameScale;
                        nextY = original.y + (moveEvent.clientY - event.clientY) / frameScale;
                    }
                    if (moveEvent.shiftKey || !window.akari.interaction) {
                        dragSnap = { x: null, y: null };
                        window.akari.interaction?.hideSnapGuides?.();
                    } else {
                        const bounds = layerOutputBoundsForTransform(entry, { ...original, x: nextX, y: nextY });
                        const snap = window.akari.interaction.computeSnapCorrection(bounds, dragSnap);
                        dragSnap = snap;
                        if (snap.x) nextX += snap.x.correction;
                        if (snap.y) nextY += snap.y.correction;
                        window.akari.interaction.showSnapGuides(snap.x, snap.y);
                    }
                    return { ...original, x: nextX, y: nextY };
                });
            });
            for (const handle of layerHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !selectedLayerId || cropModeActive) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry) return;
                    const kind = handle.getAttribute('data-akari-handle');
                    const boxRect = layerSelectBox.getBoundingClientRect();
                    // 枠はコンテンツにフィットしているが、拡縮・回転のピボットは transform モデルの
                    // 中心 = ビデオ中心のまま。箱中心からピボットオフセット（出力 px）を引き戻す
                    const pivotPerOutput = (window.akari.stageScale() || 1) * (typeof zoom === 'number' && zoom > 0 ? zoom : 1);
                    const pivotOffX = (Number(layerSelectBox.dataset.akariPivotOffX) || 0) * pivotPerOutput;
                    const pivotOffY = (Number(layerSelectBox.dataset.akariPivotOffY) || 0) * pivotPerOutput;
                    const center = {
                        x: boxRect.left + boxRect.width / 2 - pivotOffX,
                        y: boxRect.top + boxRect.height / 2 - pivotOffY
                    };
                    if (kind === 'rotate') {
                        const startAngle = Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180 / Math.PI;
                        beginLayerTransformDrag(entry, event, (moveEvent, original) => {
                            const angle = Math.atan2(moveEvent.clientY - center.y, moveEvent.clientX - center.x) * 180 / Math.PI;
                            return { ...original, rotate: original.rotate + (angle - startAngle) };
                        });
                    } else {
                        const startDistance = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
                        // ㉔ crop 適用中は見えている自然サイズが cropW/cropH 分小さいので、bounds→scale の
                        // 逆算（solveCenteredResizeSnap の naturalWidth/Height）もそれに合わせる。
                        const crop = layerCropNow(entry);
                        let dragSnap = { x: null, y: null };
                        beginLayerTransformDrag(entry, event, (moveEvent, original) => {
                            const distance = Math.hypot(moveEvent.clientX - center.x, moveEvent.clientY - center.y);
                            const factor = distance / startDistance;
                            let nextScale = Math.max(0.01, original.scale * factor);
                            if (moveEvent.shiftKey || !window.akari.interaction) {
                                dragSnap = { x: null, y: null };
                                window.akari.interaction?.hideSnapGuides?.();
                            } else {
                                const bounds = layerOutputBoundsForTransform(entry, { ...original, scale: nextScale });
                                const solved = solveCenteredResizeSnap(
                                    bounds, (entry.video.videoWidth || 0) * crop.w, (entry.video.videoHeight || 0) * crop.h,
                                    nextScale, dragSnap
                                );
                                nextScale = solved.scale;
                                dragSnap = { x: solved.snapX, y: solved.snapY };
                            }
                            return { ...original, scale: nextScale };
                        });
                    }
                });
            }
            // ㉔ クロップモードの 8 方向ハンドル（n/ne/e/se/s/sw/w/nw）。対辺（動かさない側）を
            // アンカーに固定し、ドラッグ中の点（ソースフレーム正規化座標）で動かした側の辺を
            // 更新する — CapCut 等の切り抜きハンドルと同型の挙動。確定(pointerup)時のみ
            // layerWrite({crop}) で書き戻す（既存 transform ハンドルと同じ確定タイミング）。
            for (const handle of layerCropHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !selectedLayerId || !cropModeActive) return;
                    const entry = findLayerEntry(selectedLayerId);
                    if (!entry || !(entry.video.videoWidth > 0)) return;
                    const dir = handle.getAttribute('data-akari-crop-handle');
                    const startTransform = layerTransformNow(entry);
                    const pivotPx = { x: entry.video.videoWidth / 2, y: entry.video.videoHeight / 2 };
                    const original = layerCropNow(entry);
                    const anchorRight = original.x + original.w;
                    const anchorBottom = original.y + original.h;
                    event.preventDefault();
                    event.stopPropagation();
                    const pointerId = event.pointerId;
                    const captureTarget = event.currentTarget;
                    let moved = false;
                    let cancelled = false;
                    try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                    const cleanup = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                        window.removeEventListener('pointercancel', onUp);
                        window.removeEventListener('keydown', onKeyDown, true);
                        if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                            captureTarget.releasePointerCapture(pointerId);
                        }
                    };
                    const computeNext = moveEvent => {
                        const point = layerVideoPointForPivot(entry, startTransform, pivotPx, moveEvent.clientX, moveEvent.clientY);
                        if (!point) return original;
                        const fx = point.x / entry.video.videoWidth;
                        const fy = point.y / entry.video.videoHeight;
                        let nextX = original.x;
                        let nextY = original.y;
                        let nextRight = anchorRight;
                        let nextBottom = anchorBottom;
                        if (dir.indexOf('w') >= 0) nextX = Math.min(fx, anchorRight - CROP_MIN);
                        if (dir.indexOf('e') >= 0) nextRight = Math.max(fx, original.x + CROP_MIN);
                        if (dir.indexOf('n') >= 0) nextY = Math.min(fy, anchorBottom - CROP_MIN);
                        if (dir.indexOf('s') >= 0) nextBottom = Math.max(fy, original.y + CROP_MIN);
                        return clampCrop(nextX, nextY, nextRight - nextX, nextBottom - nextY);
                    };
                    const onMove = moveEvent => {
                        if (moveEvent.pointerId !== pointerId) return;
                        moved = true;
                        applyLayerCropNow(entry, computeNext(moveEvent));
                    };
                    const finish = async () => {
                        cleanup();
                        if (cancelled) {
                            applyLayerCropNow(entry, original);
                            return;
                        }
                        if (!moved) return;
                        const finalCrop = layerCropNow(entry);
                        try {
                            await window.akari.engine.layerWrite(entry.spec.id, { crop: finalCrop });
                        } catch (error) {
                            console.warn('[akari-preview] layer crop write rejected; reverting', error);
                            applyLayerCropNow(entry, original);
                        }
                    };
                    const onUp = upEvent => {
                        if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                        void finish();
                    };
                    const onKeyDown = keyEvent => {
                        if (keyEvent.key !== 'Escape') return;
                        cancelled = true;
                        void finish();
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                    window.addEventListener('pointercancel', onUp);
                    window.addEventListener('keydown', onKeyDown, true);
                });
            }
            new ResizeObserver(() => updateLayerCropBox()).observe(wrapper);
            wrapper.addEventListener('click', event => {
                if (!selectedLayerId && !cutSelected) return;
                if (event.target.closest
                    && (event.target.closest('#layer-select-box') || event.target.closest('#cut-select-box')
                        || event.target.closest('#layer-crop-box') || event.target.closest('#layer-crop-toggle')
                        || event.target.closest('#layer-perspective-toggle') || event.target.closest('#layer-perspective-panel'))) {
                    return;
                }
                // A click that lands on the stage over a layer video/preview-video reports
                // event.target as the stage itself (see the delegated pointerdown handler above),
                // so re-check via elementsFromPoint rather than event.target.closest here.
                const hitSelectable = document.elementsFromPoint(event.clientX, event.clientY)
                    .some(candidate => {
                        if (candidate === video) return true;
                        if (!(candidate.tagName === 'VIDEO' && candidate.dataset
                            && candidate.dataset.akariLayerId && candidate.style.display !== 'none')) return false;
                        const candidateEntry = findLayerEntry(candidate.dataset.akariLayerId);
                        return !candidateEntry || layerAlphaAtPoint(candidateEntry, event.clientX, event.clientY) > 16;
                    });
                if (hitSelectable) return;
                if (selectedLayerId) selectLayer(null);
                if (cutSelected) deselectCut();
            });
            new ResizeObserver(() => updateLayerSelectBox()).observe(wrapper);

            // ㉓ 本編ビデオ（#preview-video = 現在再生中のカット）のクリック選択 + transform。
            // layers[] と同型（4隅ハンドルで移動/拡縮・center-pivot scale・確定時のみ
            // cutWrite）。box の基準サイズは layers[] の natural media size ではなく
            // 出力フレーム（outputWidth/outputHeight）— #preview-video 自身が
            // updateStageScale() で frameRect サイズに敷かれ、その上へ cut transform の
            // translate/scale/rotate がそのままかかる実装（既存 transform 消費経路）と
            // 一致させるため。
            let cutSelected = false;
            const cutSelectBox = document.getElementById('cut-select-box');
            const cutHandleElements = Array.from(cutSelectBox.querySelectorAll('[data-akari-handle]'));
            const cutTransformNow = () => ({
                x: Number(video.dataset.akariTransformX) || 0,
                y: Number(video.dataset.akariTransformY) || 0,
                scale: Number(video.dataset.akariTransformScale) || 1,
                rotate: Number(video.dataset.akariTransformRotate) || 0
            });
            const applyCutTransformNow = transform => {
                video.dataset.akariCutTransformActive = 'true';
                video.dataset.akariTransformX = String(transform.x);
                video.dataset.akariTransformY = String(transform.y);
                video.dataset.akariTransformScale = String(transform.scale);
                video.dataset.akariTransformRotate = String(transform.rotate);
                if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                updateCutSelectBox();
            };
            const updateCutSelectBox = () => {
                const hasCut = video.dataset.akariCutIndex !== '' && video.dataset.akariCutIndex !== undefined;
                if (!cutSelected || !hasCut || video.style.visibility === 'hidden') {
                    cutSelectBox.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const frameScale = window.akari.stageScale() || 1;
                const outputWidth = Number(summary.output && summary.output.width) || 1280;
                const outputHeight = Number(summary.output && summary.output.height) || 720;
                const transform = cutTransformNow();
                const outputW = outputWidth * transform.scale;
                const outputH = outputHeight * transform.scale;
                const outputCenterX = outputWidth / 2 + transform.x;
                const outputCenterY = outputHeight / 2 + transform.y;
                const screenW = outputW * frameScale;
                const screenH = outputH * frameScale;
                const screenCenterX = frameRect.x + outputCenterX * frameScale;
                const screenCenterY = frameRect.y + outputCenterY * frameScale;
                cutSelectBox.style.left = (screenCenterX - screenW / 2) + 'px';
                cutSelectBox.style.top = (screenCenterY - screenH / 2) + 'px';
                cutSelectBox.style.width = screenW + 'px';
                cutSelectBox.style.height = screenH + 'px';
                cutSelectBox.style.transform = 'rotate(' + transform.rotate + 'deg)';
                cutSelectBox.classList.add('is-active');
            };
            const selectCut = options => {
                const report = !options || options.report !== false;
                if (cutSelected) {
                    updateCutSelectBox();
                    return;
                }
                cutSelected = true;
                selectLayer(null, { report: true });
                if (typeof deselectCaption === 'function') deselectCaption({ report: true });
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(true);
            };
            const deselectCut = options => {
                const report = !options || options.report !== false;
                if (!cutSelected) {
                    updateCutSelectBox();
                    return;
                }
                cutSelected = false;
                updateCutSelectBox();
                if (report) window.akari.reportCutSelection(false);
            };
            const beginCutTransformDrag = (startEvent, computeTransform) => {
                startEvent.preventDefault();
                startEvent.stopPropagation();
                const pointerId = startEvent.pointerId;
                const original = cutTransformNow();
                const captureTarget = startEvent.currentTarget;
                let moved = false;
                let cancelled = false;
                try { captureTarget.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
                        captureTarget.releasePointerCapture(pointerId);
                    }
                    window.akari.interaction?.hideSnapGuides?.();
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startEvent.clientX;
                    const dy = moveEvent.clientY - startEvent.clientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved) return;
                    applyCutTransformNow(computeTransform(moveEvent, original));
                };
                const finish = async () => {
                    cleanup();
                    if (cancelled) {
                        applyCutTransformNow(original);
                        return;
                    }
                    if (!moved) return;
                    const cutIndex = Number(video.dataset.akariCutIndex);
                    if (!Number.isInteger(cutIndex) || cutIndex < 0) {
                        applyCutTransformNow(original);
                        return;
                    }
                    const finalTransform = cutTransformNow();
                    try {
                        await window.akari.engine.cutWrite(cutIndex, { transform: finalTransform });
                    } catch (error) {
                        console.warn('[akari-preview] cut transform write rejected; reverting', error);
                        applyCutTransformNow(original);
                    }
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish();
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    cancelled = true;
                    void finish();
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
                window.addEventListener('keydown', onKeyDown, true);
            };
            for (const handle of cutHandleElements) {
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== 0 || !cutSelected) return;
                    const boxRect = cutSelectBox.getBoundingClientRect();
                    const center = { x: boxRect.left + boxRect.width / 2, y: boxRect.top + boxRect.height / 2 };
                    const startDistance = Math.max(1, Math.hypot(event.clientX - center.x, event.clientY - center.y));
                    let dragSnap = { x: null, y: null };
                    beginCutTransformDrag(event, (moveEvent, original) => {
                        const distance = Math.hypot(moveEvent.clientX - center.x, moveEvent.clientY - center.y);
                        const factor = distance / startDistance;
                        let nextScale = Math.max(0.01, original.scale * factor);
                        if (moveEvent.shiftKey || !window.akari.interaction) {
                            dragSnap = { x: null, y: null };
                            window.akari.interaction?.hideSnapGuides?.();
                        } else {
                            const outputWidth = Number(summary.output && summary.output.width) || 1280;
                            const outputHeight = Number(summary.output && summary.output.height) || 720;
                            const bounds = outputBoundsForCenteredBox(
                                outputWidth / 2 + original.x,
                                outputHeight / 2 + original.y,
                                outputWidth * nextScale,
                                outputHeight * nextScale
                            );
                            const solved = solveCenteredResizeSnap(
                                bounds, outputWidth, outputHeight, nextScale, dragSnap
                            );
                            nextScale = solved.scale;
                            dragSnap = { x: solved.snapX, y: solved.snapY };
                        }
                        return { ...original, scale: nextScale };
                    });
                });
            }
            new ResizeObserver(() => updateCutSelectBox()).observe(wrapper);

            // ㉓ 字幕クリック選択+移動（v0: 選択+位置移動の最小）。captions.json の zone は
            // 3x3 固定 enum（schemas/captions.schema.json、自由座標なし・schema 追加禁止）
            // のため、ドラッグ位置は最近傍 zone へ量子化し pointerup 確定時のみ
            // captionWrite で書き戻す（overlay/layer/cut と同じ「確定時のみ書き込み」規約）。
            // captionZoneVars() は akari-preview-captions.ts の zoneVars()（render-cut/src/
            // captions.mjs にも同型の複製が既にある——このファイル間ミラー方式が既存の
            // 設計判断）を webview 内 JS として最小限に複製したもの。
            // 制約: プレーン字幕（text_style 無し）は #caption-plate 自体が bottom-center に
            // ハードコードされ zone を無視する。zone を書き込むと次の captions.json リロード
            // （既存の handleFilesChanged → queueCaptionsUpdate 経路）で「styled」扱いに昇格し
            // 新位置に反映される——ドラッグ中のリアルタイム追従はスキーマの都合上できない
            // （#caption-select-box の概算矩形でドロップ先ゾーンだけ示す）。report に明記する。
            let selectedCaptionId = null;
            let selectedCaptionZone = 'bottom';
            const captionSelectBox = document.getElementById('caption-select-box');
            const ZONE_ROW_RANGES = { top: [0, 1 / 3], middle: [1 / 3, 2 / 3], bottom: [2 / 3, 1] };
            const ZONE_COL_RANGES = { left: [0, 1 / 3], center: [1 / 3, 2 / 3], right: [2 / 3, 1] };
            const zoneParts = zone => {
                if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
                if (zone === 'center') return { row: 'middle', col: 'center' };
                if (zone === 'top') return { row: 'top', col: 'center' };
                if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
                const [row, col] = zone.split('-');
                return { row, col };
            };
            const zoneFromFraction = (fx, fy) => {
                const col = fx < 1 / 3 ? 'left' : fx < 2 / 3 ? 'center' : 'right';
                const row = fy < 1 / 3 ? 'top' : fy < 2 / 3 ? 'middle' : 'bottom';
                if (row === 'middle' && col === 'center') return 'center';
                if (row === 'middle') return col;
                if (col === 'center') return row;
                return row + '-' + col;
            };
            const updateCaptionSelectBoxForZone = zone => {
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                const frameRect = window.akari.computeOutputFrameRect();
                const { row, col } = zoneParts(zone);
                const rowRange = ZONE_ROW_RANGES[row] || ZONE_ROW_RANGES.bottom;
                const colRange = ZONE_COL_RANGES[col] || ZONE_COL_RANGES.center;
                captionSelectBox.style.left = (frameRect.x + frameRect.width * colRange[0]) + 'px';
                captionSelectBox.style.top = (frameRect.y + frameRect.height * rowRange[0]) + 'px';
                captionSelectBox.style.width = (frameRect.width * (colRange[1] - colRange[0])) + 'px';
                captionSelectBox.style.height = (frameRect.height * (rowRange[1] - rowRange[0])) + 'px';
                captionSelectBox.classList.add('is-active');
            };
            const updateCaptionSelectBox = () => {
                if (!selectedCaptionId) {
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                const caption = captions.find(candidate => (candidate.sourceCueId || candidate.id) === selectedCaptionId);
                if (!caption) {
                    selectedCaptionId = null;
                    captionSelectBox.classList.remove('is-active');
                    return;
                }
                selectedCaptionZone = (caption.textStyle && caption.textStyle.zone) || 'bottom';
                updateCaptionSelectBoxForZone(selectedCaptionZone);
            };
            const selectCaption = (captionId, options) => {
                const report = !options || options.report !== false;
                if (captionId === selectedCaptionId) {
                    updateCaptionSelectBox();
                    return;
                }
                selectedCaptionId = captionId;
                if (captionId) {
                    selectLayer(null, { report: true });
                    deselectCut({ report: true });
                }
                updateCaptionSelectBox();
                if (report) window.akari.reportCaptionSelection(selectedCaptionId);
            };
            const deselectCaption = options => selectCaption(null, options);
            captionPlate.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                const time = video.currentTime || 0;
                // 字幕ウィンドウ判定は共有カーネル（webview-kernel.js / caption-window.ts）
                const resolvedTimeline = captions.some(candidate => candidate.resolvedTimeline);
                const caption = window.AkariEditKernel.findActiveCaption(captions, resolvedTimeline ? outputTime : time);
                if (!caption || !caption.id) return;
                event.preventDefault();
                event.stopPropagation();
                selectCaption(caption.sourceCueId || caption.id);
                const pointerId = event.pointerId;
                const startClientX = event.clientX;
                const startClientY = event.clientY;
                const originalZone = selectedCaptionZone;
                let candidateZone = originalZone;
                let moved = false;
                try { captionPlate.setPointerCapture(pointerId); } catch (_error) { /* not capturable */ }
                const frameRect = window.akari.computeOutputFrameRect();
                const cleanup = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onCancel);
                    window.removeEventListener('keydown', onKeyDown, true);
                    if (captionPlate.hasPointerCapture && captionPlate.hasPointerCapture(pointerId)) {
                        captionPlate.releasePointerCapture(pointerId);
                    }
                };
                const onMove = moveEvent => {
                    if (moveEvent.pointerId !== pointerId) return;
                    const dx = moveEvent.clientX - startClientX;
                    const dy = moveEvent.clientY - startClientY;
                    if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) moved = true;
                    if (!moved || !(frameRect.width > 0) || !(frameRect.height > 0)) return;
                    const fx = (moveEvent.clientX - frameRect.x) / frameRect.width;
                    const fy = (moveEvent.clientY - frameRect.y) / frameRect.height;
                    candidateZone = zoneFromFraction(fx, fy);
                    updateCaptionSelectBoxForZone(candidateZone);
                };
                const finish = async cancelled => {
                    cleanup();
                    if (cancelled || !moved || candidateZone === originalZone) {
                        updateCaptionSelectBox();
                        return;
                    }
                    try {
                        await window.akari.engine.captionWrite(caption.sourceCueId || caption.id, { zone: candidateZone });
                        selectedCaptionZone = candidateZone;
                    } catch (error) {
                        console.warn('[akari-preview] caption zone write rejected; reverting', error);
                    }
                    updateCaptionSelectBoxForZone(selectedCaptionZone);
                };
                const onUp = upEvent => {
                    if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
                    void finish(false);
                };
                const onCancel = cancelEvent => {
                    if (cancelEvent.pointerId !== undefined && cancelEvent.pointerId !== pointerId) return;
                    void finish(true);
                };
                const onKeyDown = keyEvent => {
                    if (keyEvent.key !== 'Escape') return;
                    void finish(true);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onCancel);
                window.addEventListener('keydown', onKeyDown, true);
            });
            wrapper.addEventListener('click', event => {
                if (!selectedCaptionId) return;
                if (event.target.closest
                    && (event.target.closest('#caption-plate') || event.target.closest('#caption-select-box'))) {
                    return;
                }
                deselectCaption();
            });
            new ResizeObserver(() => updateCaptionSelectBox()).observe(wrapper);

            const applyTrackVisibility = track => {
                for (const container of stage.querySelectorAll('[data-akari-track]')) {
                    if (Number(container.getAttribute('data-akari-track')) === track) {
                        container.style.display = hiddenTracks.has(track) ? 'none' : '';
                    }
                }
            };
            const applyOverlayTracks = () => {
                for (const container of stage.querySelectorAll('[data-overlay-id]')) {
                    const id = container.getAttribute('data-overlay-id') || '';
                    const overlay = summary.overlays.find(candidate => String(candidate.id) === id);
                    const track = Number.isInteger(overlay?.track) && overlay.track >= 0 ? overlay.track : 0;
                    container.setAttribute('data-akari-track', String(track));
                    container.style.zIndex = String(10 + track);
                    container.style.display = hiddenTracks.has(track) ? 'none' : '';
                }
            };
            // source↔output 写像の正本は packages/edit-store/src/timeline-map.ts。webview は
            // sandbox 制約で import できないため、共有カーネル webview-kernel.js（IIFE バンドル、
            // global: AkariEditKernel）をインライン注入して共有する（overlay-runtime と同経路）。
            // 旧インライン複製（rebuildKeepRanges / computeVideoRuns 等）は撤去済み。旧複製との
            // 意味論差: gaps/tracks モードの暗黙 at にもトランジション重なりが載る（書き込み側
            // computeCutTrackSegments と同じ = 正本挙動へ収斂）。
            const rebuildSegments = () => {
                const rawCuts = Array.isArray(summary.cuts) ? summary.cuts : [];
                const map = window.AkariEditKernel.buildTimelineMap(rawCuts, {
                    trackZ: track => zForTrack('cuts', track)
                });
                if (map.segments.length > 0) {
                    // transform / opacity は再生時の見た目情報で写像には関与しないため、
                    // 共有カーネルの segment には無い。元 cuts から補う。
                    segments = map.segments.map(segment => {
                        if (segment.kind !== 'src' || !Number.isInteger(segment.cutIndex)) {
                            return segment;
                        }
                        const cut = rawCuts[segment.cutIndex];
                        return {
                            ...segment,
                            transform: cut ? cut.transform : undefined,
                            opacity: cut ? cut.opacity : undefined,
                            // ㉕ cuts[].framing / cuts[].freeze（contract-2026-08-02-preview-parity.md）:
                            // 同じ理由（写像には関与しない見た目/再生情報）で元 cuts から補う。
                            framing: cut ? cut.framing : undefined,
                            freeze: cut ? cut.freeze : undefined
                        };
                    });
                    transitionPlates = map.transitionPlates;
                    totalTimelineDuration = map.totalDuration;
                } else {
                    // cuts 無し（または全て不正）: 全編を 1 セグメントとして扱う（従来挙動）
                    const duration = videoDuration();
                    segments = duration > 0
                        ? [{
                            kind: 'src', outStart: 0, outEnd: duration, cutIndex: null,
                            in: 0, out: duration, speed: 1, track: 0, transitionOut: null
                        }]
                        : [];
                    transitionPlates = [];
                    totalTimelineDuration = duration > 0 ? duration : 0;
                }
                const cutsEndSeconds = totalTimelineDuration;
                const contentDurationSeconds = computeContentDurationSeconds(cutsEndSeconds);
                if (contentDurationSeconds > cutsEndSeconds + 0.001) {
                    segments.push({ outStart: cutsEndSeconds, outEnd: contentDurationSeconds, kind: 'gap' });
                    totalTimelineDuration = contentDurationSeconds;
                }
                if (window.akari.previewAudio && totalTimelineDuration > 0) {
                    void window.akari.previewAudio.setTimelineDuration(totalTimelineDuration);
                }
                if (activeSegmentIndex >= segments.length) {
                    activeSegmentIndex = Math.max(0, segments.length - 1);
                }
                outputTime = clamp(outputTime, 0, totalTimelineDuration);
                syncSegmentPlaybackRate();
            };
            const syncSegmentPlaybackRate = () => {
                const segment = segments[activeSegmentIndex];
                const speed = segment && segment.kind === 'src'
                    && Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                if (video.playbackRate !== speed) {
                    video.playbackRate = speed;
                    window.akari.reviewTransport({ type: 'rate', value: speed, timelineT: outputTime });
                }
            };
            const findSegmentForSource = sourceTime => segments.findIndex(
                segment => segment.kind === 'src' && sourceTime >= segment.in && sourceTime < segment.out
            );
            // v1 マルチソース（edit.json sources[] + cuts[].src）。id → ストリーム URL の表を
            // ホストから受け取り、カットの継ぎ目でソースが変わるときだけ <video> を差し替える。
            // v0 / 単一ソースの案件は表が 1 件なので一度も差し替えが起きない。
            const videoSources = initial.videoSources || {};
            let currentVideoSourceId = null;
            for (const [id, url] of Object.entries(videoSources)) {
                if (url === video.getAttribute('src')) currentVideoSourceId = id;
            }
            // 差し替えたときだけ true を返す（呼び出し側は false なら即座に続行する）
            const applySegmentSource = (segment, onReady) => {
                const nextId = segment && segment.src;
                if (!nextId || nextId === currentVideoSourceId) return false;
                const nextUrl = videoSources[nextId];
                if (!nextUrl) return false;
                currentVideoSourceId = nextId;
                video.addEventListener('loadedmetadata', () => onReady(), { once: true });
                video.src = nextUrl;
                video.load();
                return true;
            };
            const clampSourceTime = (sourceTime, preferredIndex) => {
                const preferred = segments[preferredIndex];
                if (preferred && preferred.kind === 'src'
                    && sourceTime >= preferred.in && sourceTime < preferred.out) {
                    return { index: preferredIndex, time: sourceTime, ended: false };
                }
                const hit = findSegmentForSource(sourceTime);
                if (hit !== -1) {
                    return { index: hit, time: sourceTime, ended: false };
                }
                if (preferred && preferred.kind === 'src' && sourceTime >= preferred.out) {
                    const nextIndex = preferredIndex + 1;
                    if (nextIndex < segments.length) {
                        const next = segments[nextIndex];
                        return next.kind === 'src'
                            ? { index: nextIndex, time: next.in, ended: false }
                            : { index: nextIndex, time: sourceTime, ended: false };
                    }
                    return { index: preferredIndex, time: preferred.out, ended: true };
                }
                if (preferred && preferred.kind === 'src' && sourceTime < preferred.in) {
                    return { index: preferredIndex, time: preferred.in, ended: false };
                }
                let fallback = segments.findIndex(segment => segment.kind === 'src' && segment.in >= sourceTime);
                if (fallback === -1) {
                    fallback = segments.length - 1;
                }
                const fallbackSegment = segments[fallback];
                return {
                    index: fallback,
                    time: fallbackSegment && fallbackSegment.kind === 'src' ? fallbackSegment.in : sourceTime,
                    ended: false
                };
            };
            // segment.freeze / framing.keyframes[].t の座標系（カット内・速度適用後の再生秒）に
            // 合わせる。gap セグメントには意味がないため 0 を返す（呼び出し側はどのみち framing/freeze
            // が無いことを先にガードするが、defensive に安全な既定値を返しておく）。
            const playedCutLocalSeconds = segment => {
                if (!segment || segment.kind !== 'src') return 0;
                const speed = Number.isFinite(segment.speed) && segment.speed > 0 ? segment.speed : 1;
                return ((video.currentTime || 0) - segment.in) / speed;
            };
            // ㉕ cuts[].framing の毎フレーム反映。hostAdapterScript 側の updateStageScale が書く
            // cut.transform（PIP 位置決め）部分を dataset.akariBaseTransform 経由で受け取り、その
            // 手前（内側）に framing のズーム/クロップを合成する。framing 無しの既存プロジェクトは
            // baseTransform をそのまま書くだけなので見た目・回帰は無い。
            const applyCutFramingVisual = () => {
                const segment = segments[activeSegmentIndex];
                const framing = segment && segment.kind === 'src' ? segment.framing : null;
                const visual = computeCutFramingVisualFn(framing, playedCutLocalSeconds(segment));
                const baseTransform = video.dataset.akariBaseTransform || '';
                if (visual) {
                    video.style.transformOrigin = visual.transformOrigin;
                    video.style.transform = (baseTransform ? baseTransform + ' ' : '') + visual.transform;
                } else {
                    video.style.transformOrigin = '';
                    video.style.transform = baseTransform;
                }
            };
            window.akari.applyCutFramingVisual = applyCutFramingVisual;
            const enterSegment = index => {
                if (index < 0 || index >= segments.length) return;
                // ㉕ フリーズホールドはセグメント（カット）が変わったら破棄する（seek 含む
                // enterSegment 呼び出し全経路がここを通る）。古い holdSeconds タイマーが新しい
                // セグメントの tick() を誤って早期 return させるのを防ぐ。
                freezeHoldUntilMs = 0;
                freezeHoldConsumedForSegmentIndex = null;
                activeSegmentIndex = index;
                const segment = segments[index];
                if (segment.kind === 'gap') {
                    applyCutVisual(segment);
                    // video.pause() は既に一時停止中だと 'pause' イベントを発火しない
                    // （ブラウザ仕様）。その場合に pausedForGapEntry を立てると、次に来る
                    // 本物の 'pause' イベント（例えば別セグメントで実際に再生中だったものを
                    // 止めた時）がこの使い古しの flag を誤って消費してしまう。
                    if (!video.paused) {
                        pausedForGapEntry = true;
                        video.pause();
                    }
                    video.style.visibility = 'hidden';
                    gapWallClockOriginMs = performance.now();
                    gapOutputOrigin = outputTime;
                    return;
                }
                applyCutVisual(segment);
                video.style.visibility = '';
                syncSegmentPlaybackRate();
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(outputTime - segment.outStart, 0, segmentDuration);
                const target = segment.in + withinSegment * segment.speed;
                const seekAndResume = () => {
                    if (Math.abs((video.currentTime || 0) - target) > 0.0005) {
                        video.currentTime = target;
                    }
                    if (isPlaying && video.paused) {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                };
                // v1 マルチソース: このカットが別ソースを指しているならストリームを差し替える。
                // 差し替え直後は readyState が 0 に戻り currentTime 代入が無視されるため、
                // loadedmetadata を待ってからシークする（単一ソースでは分岐しない）
                if (!applySegmentSource(segment, seekAndResume)) {
                    seekAndResume();
                }
            };
            const stopAtNaturalEnd = () => {
                if (!isPlaying) return;
                window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                isPlaying = false;
                freezeHoldUntilMs = 0;
                video.pause();
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            };
            const applyKeepRangeBoundary = () => {
                const segment = segments[activeSegmentIndex];
                if (!segment || segment.kind !== 'src') return;
                const current = video.currentTime || 0;
                if (current >= segment.out - 0.0005) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                const result = clampSourceTime(current, activeSegmentIndex);
                activeSegmentIndex = result.index;
                syncSegmentPlaybackRate();
                if (result.ended) {
                    const nextIndex = activeSegmentIndex + 1;
                    if (nextIndex < segments.length) {
                        outputTime = segments[nextIndex].outStart;
                        enterSegment(nextIndex);
                    } else {
                        stopAtNaturalEnd();
                    }
                    return;
                }
                if (Math.abs(current - result.time) > 0.0005) {
                    video.currentTime = result.time;
                }
            };
            const sourceToTimeline = (sourceTime, segmentIndex) => {
                if (segments.length === 0) return sourceTime;
                const segment = segments[segmentIndex] || segments[0];
                if (segment && segment.kind === 'gap') return outputTime;
                if (!segment) return sourceTime;
                return segment.outStart
                    + clamp(sourceTime - segment.in, 0, segment.out - segment.in) / segment.speed;
            };
            const timelineToSource = timelineValue => {
                if (segments.length === 0) return { index: 0, kind: 'src', time: timelineValue };
                let index = segments.length - 1;
                for (let candidate = 0; candidate < segments.length; candidate += 1) {
                    if (timelineValue < segments[candidate].outEnd || candidate === segments.length - 1) {
                        index = candidate;
                        break;
                    }
                }
                const segment = segments[index];
                if (segment.kind === 'gap') return { index, kind: 'gap' };
                const segmentDuration = segment.outEnd - segment.outStart;
                const withinSegment = clamp(timelineValue - segment.outStart, 0, segmentDuration);
                return { index, kind: 'src', time: segment.in + withinSegment * segment.speed };
            };
            const seekTimelineTime = timelineValue => {
                const previousOutputTime = outputTime;
                // 総尺ちょうどへシーク（末尾延長ギャップが最終セグメントの場合を含む）すると、
                // 直後の tick() が「境界に到達済み」と即判定して stopAtNaturalEnd() を出し、
                // 再生ボタンを押しても 1 フレームも進まず固まって見えるバグ⑬⑭の根本原因。
                // 末尾に数フレーム分の再生余地を残すようクランプすることで、再生開始が必ず
                // 観測可能な進行を1回は生む（自然再生が末尾へ到達して止まる経路 = tick() 内の
                // 別クランプは無改造のため、そちらの停止挙動は従来通り）。
                const seekableDuration = totalTimelineDuration || videoDuration();
                const endSafetyMargin = Math.min(2 / fps, seekableDuration);
                const seekableMax = Math.max(0, seekableDuration - endSafetyMargin);
                outputTime = clamp(Math.max(0, timelineValue), 0, seekableMax);
                window.akari.reviewTransport({ type: 'seek', from: previousOutputTime, to: outputTime });
                const mapped = timelineToSource(outputTime);
                enterSegment(mapped.index);
                if (mapped.kind === 'src') {
                    video.currentTime = mapped.time;
                } else if (isPlaying && window.akari.previewAudio) {
                    void window.akari.previewAudio.playFrom(outputTime);
                }
            };
            const applyInitialPosition = () => {
                if (initialPositionApplied) return;
                initialPositionApplied = true;
                if (Number.isFinite(initial.initialSeekTime)) {
                    seekTimelineTime(initial.initialSeekTime);
                } else if (segments.length > 0) {
                    outputTime = segments[0].outStart;
                    enterSegment(0);
                }
            };
            const zoomToSlider = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                return (Math.log2(clamp(value, ZOOM_MIN, ZOOM_MAX)) - logMin) / (logMax - logMin);
            };
            const sliderToZoom = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                const sliderValue = clamp(value, 0, 1);
                if (Math.abs(sliderValue - zoomToSlider(1)) <= SNAP_TOLERANCE) return 1;
                return Math.pow(2, logMin + (logMax - logMin) * sliderValue);
            };
            const renderZoom = () => {
                zoomLayer.style.transform = 'translate(' + (pan.x * zoom * 100).toFixed(3) + '%, '
                    + (pan.y * zoom * 100).toFixed(3) + '%) scale(' + zoom + ')';
                zoomValue.textContent = Math.round(zoom * 100) + '%';
                zoomSlider.value = String(zoomToSlider(zoom));
                const isZoomed = zoom > 1.05;
                wrapper.classList.toggle('is-draggable', isZoomed);
                if (!isZoomed) wrapper.classList.remove('is-dragging');
                zoomMinimap.hidden = !isZoomed;
                if (!isZoomed) return;
                const width = Number(summary.output && summary.output.width) || 1280;
                const height = Number(summary.output && summary.output.height) || 720;
                const aspectRatio = width / height;
                zoomMinimap.style.width = (aspectRatio >= 1 ? 64 : 64 * aspectRatio) + 'px';
                zoomMinimap.style.height = (aspectRatio >= 1 ? 64 / aspectRatio : 64) + 'px';
                const innerSize = 1 / zoom;
                zoomMinimapViewport.style.left = (((1 - innerSize) / 2 - pan.x) * 100) + '%';
                zoomMinimapViewport.style.top = (((1 - innerSize) / 2 - pan.y) * 100) + '%';
                zoomMinimapViewport.style.width = (innerSize * 100) + '%';
                zoomMinimapViewport.style.height = (innerSize * 100) + '%';
            };
            const setZoom = value => {
                zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
                if (zoom <= 1.05) {
                    pan = { x: 0, y: 0 };
                } else {
                    const maxR = (zoom - 1) / (2 * zoom);
                    pan = {
                        x: clamp(pan.x, -maxR, maxR),
                        y: clamp(pan.y, -maxR, maxR)
                    };
                }
                renderZoom();
            };

            const formatTime = value => {
                const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
                const minutes = Math.floor(seconds / 60);
                return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
            };
            const updateTransport = () => {
                const timelineDuration = segments.length > 0 ? totalTimelineDuration : videoDuration();
                const timelinePosition = segments.length > 0 ? outputTime : (video.currentTime || 0);
                seek.max = String(timelineDuration);
                seek.value = String(clamp(timelinePosition, 0, timelineDuration));
                timeLabel.textContent = formatTime(timelinePosition) + ' / ' + formatTime(timelineDuration);
                penToggle.disabled = !reviewRecordingActive || isPlaying;
                if (playToggleRenderedIsPlaying !== isPlaying) {
                    playToggleRenderedIsPlaying = isPlaying;
                    const label = isPlaying ? '一時停止' : '再生';
                    playToggle.innerHTML = isPlaying ? pauseIcon : playIcon;
                    playToggle.setAttribute('aria-label', label);
                    playToggle.title = label;
                }
            };
            const waveformBinCount = () => {
                const raw = Math.max(96, Math.min(1024, Math.ceil(waveformRow.clientWidth / 2)));
                return Math.max(96, Math.round(raw / 8) * 8);
            };
            const aggregateWaveform = widthBins => {
                if (!waveformAudioBuffer || widthBins <= 0) return null;
                const total = waveformAudioBuffer.length;
                const samplesPerBin = total / widthBins;
                const peaks = new Float32Array(widthBins);
                const rms = new Float32Array(widthBins);
                const channel = waveformAudioBuffer.getChannelData(0);
                let globalMax = 0;
                let rmsMax = 0;
                for (let bin = 0; bin < widthBins; bin += 1) {
                    const start = Math.floor(bin * samplesPerBin);
                    const end = Math.min(total, Math.floor((bin + 1) * samplesPerBin));
                    let peak = 0;
                    let sumSquares = 0;
                    let count = 0;
                    for (let index = start; index < end; index += 1) {
                        const value = Math.abs(channel[index]);
                        if (value > peak) peak = value;
                        sumSquares += value * value;
                        count += 1;
                    }
                    const rootMeanSquare = count > 0 ? Math.sqrt(sumSquares / count) : 0;
                    peaks[bin] = peak;
                    rms[bin] = rootMeanSquare;
                    if (peak > globalMax) globalMax = peak;
                    if (rootMeanSquare > rmsMax) rmsMax = rootMeanSquare;
                }
                return { peaks, rms, globalMax, rmsMax };
            };
            const prepareWaveformCanvas = () => {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const width = Math.max(1, Math.floor(waveformRow.clientWidth));
                const height = Math.max(1, Math.floor(waveformRow.clientHeight));
                waveformCanvas.width = Math.floor(width * dpr);
                waveformCanvas.height = Math.floor(height * dpr);
                waveformCanvas.style.width = width + 'px';
                waveformCanvas.style.height = height + 'px';
                const context = waveformCanvas.getContext('2d');
                if (!context) return null;
                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.fillStyle = '#181818';
                context.fillRect(0, 0, width, height);
                context.fillStyle = 'rgba(255,255,255,0.06)';
                context.fillRect(0, height / 2 - 0.5, width, 1);
                return { context, width, height };
            };
            const drawWaveformMessage = message => {
                const drawing = prepareWaveformCanvas();
                if (!drawing) return;
                drawing.context.fillStyle = '#999';
                drawing.context.font = '12px system-ui, sans-serif';
                drawing.context.textAlign = 'center';
                drawing.context.textBaseline = 'middle';
                drawing.context.fillText(message, drawing.width / 2, drawing.height / 2);
            };
            const drawWaveform = () => {
                if (waveformState === 'loading') {
                    drawWaveformMessage('波形を生成中…');
                    return;
                }
                if (waveformState === 'error') {
                    drawWaveformMessage('この動画の波形は生成できません');
                    return;
                }
                const drawing = prepareWaveformCanvas();
                if (!drawing || !waveformPeaks) return;
                const { context, width, height } = drawing;
                const maximum = Math.max(0.012, waveformPeaks.rmsMax * 1.08);
                const barWidth = Math.max(1, width / Math.max(1, waveformPeaks.rms.length));
                for (let index = 0; index < waveformPeaks.rms.length; index += 1) {
                    const normalized = Math.min(1, waveformPeaks.rms[index] / maximum);
                    const compressed = Math.pow(normalized, 0.62);
                    const barHeight = Math.max(1, compressed * (height - 10));
                    const x0 = Math.floor(index * barWidth);
                    const x1 = Math.max(x0 + 1, Math.ceil((index + 1) * barWidth) - 1);
                    context.fillStyle = waveformPeaks.peaks[index] >= 0.92 ? '#f97316' : '#22d3ee';
                    context.fillRect(x0, height / 2 - barHeight / 2, x1 - x0, barHeight);
                }
            };
            const waitForWaveformMetadata = () => {
                if (video.readyState >= 1) return Promise.resolve();
                return new Promise((resolve, reject) => {
                    const cleanup = () => {
                        video.removeEventListener('loadedmetadata', onLoaded);
                        video.removeEventListener('error', onError);
                    };
                    const onLoaded = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = () => {
                        cleanup();
                        reject(new Error('video metadata unavailable'));
                    };
                    video.addEventListener('loadedmetadata', onLoaded);
                    video.addEventListener('error', onError);
                });
            };
            const loadWaveform = async () => {
                if (waveformState !== 'idle') return;
                waveformState = 'loading';
                drawWaveform();
                let context = null;
                try {
                    await waitForWaveformMetadata();
                    const bytes = await window.akari.engine.readWaveformBytes();
                    context = new AudioContext();
                    waveformAudioBuffer = await context.decodeAudioData(bytes.slice(0));
                    await context.close().catch(() => undefined);
                    context = null;
                    waveformPeaks = aggregateWaveform(waveformBinCount());
                    if (!waveformPeaks) throw new Error('waveform contains no audio samples');
                    waveformState = 'ready';
                    drawWaveform();
                } catch (error) {
                    if (context) await context.close().catch(() => undefined);
                    waveformAudioBuffer = null;
                    waveformPeaks = null;
                    waveformState = 'error';
                    drawWaveform();
                    console.error('[akari-preview] waveform generation failed', error);
                }
            };
            const updateWaveformPlayhead = () => {
                const duration = segments.length > 0 ? totalTimelineDuration
                    : Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                const position = duration > 0
                    ? clamp((segments.length > 0 ? outputTime : (video.currentTime || 0)) / duration, 0, 1) : 0;
                waveformPlayhead.style.left = (position * 100) + '%';
            };
            const escapeCaptionHtml = value => String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const formatCaptionSeconds = value => String(Math.round(value * 1000) / 1000);
            const groupWordsIntoLines = (words, maximum = 13) => {
                const lines = [];
                let current = [];
                let currentLength = 0;
                for (const word of words) {
                    const wordLength = Array.from(word.text).length;
                    if (current.length > 0 && currentLength + wordLength > maximum) {
                        lines.push(current);
                        current = [];
                        currentLength = 0;
                    }
                    current.push(word);
                    currentLength += wordLength;
                }
                if (current.length > 0) lines.push(current);
                return lines;
            };
            // --- render-cut とのパリティ層（正本: packages/render-cut/src/captions.mjs）---
            // 縦長出力の既定: 行 10 字・文字は出力幅 6%・複数行の無指定字幕は行単位の順送り（reveal）。
            // webview はサンドボックスで import できないため、意図的なコード重複（app.js と同じ判断）。
            const captionOutput = (initial.summary && initial.summary.output) || {};
            const captionPortrait = Number(captionOutput.height) > Number(captionOutput.width);
            const captionLineBudget = captionPortrait ? 10 : 20;
            const captionDefaultFontSize = captionPortrait
                ? Math.round(Number(captionOutput.width) * 0.06) : 38;
            const CAPTION_BOUNDARIES = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
            const findLastSpaceBoundary = (characters, maximum) => {
                for (let index = maximum - 1; index > 0; index -= 1) {
                    if (characters[index] === ' ' || characters[index] === '\u3000') return index + 1;
                }
                return null;
            };
            const findLastPhraseBoundary = (characters, maximum) => {
                const prefix = characters.slice(0, maximum).join('');
                let best = null;
                for (const boundary of CAPTION_BOUNDARIES) {
                    const index = prefix.lastIndexOf(boundary);
                    if (index >= 0) {
                        const candidate = Array.from(prefix.slice(0, index + boundary.length)).length;
                        if (candidate > 0 && (best === null || candidate > best)) best = candidate;
                    }
                }
                return best;
            };
            const splitAtNaturalBoundaries = (value, maximum) => {
                const lines = [];
                let remaining = Array.from(value);
                while (remaining.length > maximum) {
                    const spaceBoundary = findLastSpaceBoundary(remaining, maximum);
                    const phraseBoundary = spaceBoundary !== null ? spaceBoundary : findLastPhraseBoundary(remaining, maximum);
                    const boundary = phraseBoundary !== null ? phraseBoundary : maximum;
                    lines.push(remaining.slice(0, boundary).join(''));
                    remaining = remaining.slice(boundary);
                }
                if (remaining.length > 0) lines.push(remaining.join(''));
                return lines;
            };
            const splitAfterPunctuation = value => {
                const characters = Array.from(value);
                const segments = [];
                let start = 0;
                for (let index = 0; index < characters.length; index += 1) {
                    if ((characters[index] === '、' || characters[index] === '。') && index + 1 < characters.length) {
                        segments.push(characters.slice(start, index + 1).join(''));
                        start = index + 1;
                    }
                }
                segments.push(characters.slice(start).join(''));
                return segments;
            };
            const splitCaptionLines = (text, maximum) => {
                const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 20;
                const lines = [];
                for (const value of String(text).split(/\\r?\\n/u)) {
                    if (value.length === 0) { lines.push(''); continue; }
                    for (const segment of splitAfterPunctuation(value)) {
                        lines.push(...splitAtNaturalBoundaries(segment, limit));
                    }
                }
                return lines;
            };
            // splitCaptionLines の分割点を word 境界へスナップして words を行へ配る
            const groupWordsIntoDisplayLines = (words, maximum) => {
                if (words.length === 0) return [];
                const text = words.map(word => word.text).join('');
                const desiredBoundaries = [];
                let desiredOffset = 0;
                for (const line of splitCaptionLines(text, maximum).slice(0, -1)) {
                    desiredOffset += Array.from(line).length;
                    desiredBoundaries.push(desiredOffset);
                }
                const ranges = [];
                let offset = 0;
                for (const word of words) {
                    const start = offset;
                    offset += Array.from(word.text).length;
                    ranges.push({ word, start, end: offset });
                }
                const boundaries = [];
                let previous = 0;
                for (const desired of desiredBoundaries) {
                    const containing = ranges.find(range => range.start < desired && desired < range.end);
                    let snapped = desired;
                    if (containing) {
                        const candidates = [containing.start, containing.end]
                            .filter(candidate => candidate > previous && candidate < offset);
                        const withinTolerance = candidates.filter(candidate => candidate - previous <= maximum + 2);
                        const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
                        if (eligible.length === 0) continue;
                        snapped = eligible.reduce((best, candidate) =>
                            Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
                    }
                    if (snapped > previous && snapped < offset) { boundaries.push(snapped); previous = snapped; }
                }
                const lines = [];
                let start = 0;
                for (const end of [...boundaries, offset]) {
                    const line = ranges.filter(range => range.end > start && range.start < end).map(range => range.word);
                    if (line.length > 0) lines.push(line);
                    start = end;
                }
                return lines;
            };
            const renderRevealGroupsMarkup = (lines, rangeStart, rangeEnd, renderLine) => {
                const groups = [];
                for (const line of lines) {
                    const start = line.length > 0 ? line[0].start : rangeStart;
                    const previous = groups[groups.length - 1];
                    if (previous && previous.start === start) previous.lines.push(line);
                    else groups.push({ start, lines: [line] });
                }
                return groups.map((group, index) => {
                    const nextStart = index + 1 < groups.length ? groups[index + 1].start : rangeEnd;
                    const delay = Math.max(0, group.start - rangeStart);
                    const duration = Math.max(0.01, nextStart - group.start);
                    const lineMarkup = group.lines
                        .map(line => '<p class="akari-caption__line">' + renderLine(line) + '</p>')
                        .join('');
                    return '<div class="akari-caption__reveal-group" style="--akari-reveal-delay: '
                        + formatCaptionSeconds(delay) + 's; --akari-reveal-dur: '
                        + formatCaptionSeconds(duration) + 's">' + lineMarkup + '</div>';
                }).join('');
            };
            const findMatchingEmphasis = word => emphasisWords.find(emphasis =>
                emphasis.t_end > word.start
                && emphasis.t_start < word.end
                && (word.text === emphasis.word || emphasis.word.includes(word.text))
            );
            const resolveEmphasisStyle = emphasis => {
                if (emphasis.style_hint === 'one-char-bang'
                    || emphasis.style_hint === 'size-pulse'
                    || emphasis.style_hint === 'color-accent') return emphasis.style_hint;
                if (emphasis.style_hint !== undefined) return 'color-accent';
                if (emphasis.emotion === 'pain' || emphasis.emotion === 'surprise'
                    || emphasis.emotion === 'anger') return 'one-char-bang';
                if (emphasis.emotion === 'joy' || emphasis.emotion === 'emphasis') return 'size-pulse';
                return 'color-accent';
            };
            const emphasisColorName = emotion =>
                ['joy', 'pain', 'surprise', 'anger', 'sadness', 'emphasis'].includes(emotion)
                    ? emotion : 'emphasis';
            const renderEmphasisCaptionToken = (word, rangeStart, emphasis) => {
                const style = resolveEmphasisStyle(emphasis);
                const overlapStart = Math.max(word.start, emphasis.t_start);
                const overlapEnd = Math.min(word.end, emphasis.t_end);
                const delay = Math.max(0, overlapStart - rangeStart);
                const duration = Math.max(0.01, overlapEnd - overlapStart);
                const baseClass = 'akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--' + style;
                if (style === 'one-char-bang') {
                    const characters = Array.from(word.text);
                    const characterDuration = duration / characters.length;
                    const markup = characters.map((character, index) =>
                        '<span class="akari-caption__emphasis-char" style="--akari-emphasis-delay: '
                        + formatCaptionSeconds(delay + characterDuration * index)
                        + 's; --akari-emphasis-dur: '
                        + formatCaptionSeconds(Math.max(0.01, characterDuration)) + 's">'
                        + escapeCaptionHtml(character) + '</span>'
                    ).join('');
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id + '">'
                        + markup + '</span>';
                }
                if (style === 'size-pulse') {
                    return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                        + '" style="--akari-emphasis-delay: ' + formatCaptionSeconds(delay)
                        + 's; --akari-emphasis-dur: ' + formatCaptionSeconds(duration) + 's">'
                        + escapeCaptionHtml(word.text) + '</span>';
                }
                return '<span class="' + baseClass + '" data-emphasis-id="' + emphasis.id
                    + '" style="color: var(--akari-emphasis-' + emphasisColorName(emphasis.emotion) + ')">'
                    + escapeCaptionHtml(word.text) + '</span>';
            };
            const renderCaptionToken = (word, rangeStart, style) => {
                const emphasis = findMatchingEmphasis(word);
                // 語レベル演出は caption の karaoke/pop より該当 token だけ優先する。
                if (emphasis) return renderEmphasisCaptionToken(word, rangeStart, emphasis);
                const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                const className = style === 'karaoke'
                    ? 'akari-caption__tok akari-caption__tok--karaoke'
                    : style === 'pop'
                        ? 'akari-caption__tok akari-caption__tok--pop'
                        : 'akari-caption__tok';
                const vars = style === 'karaoke'
                    ? '--akari-tok-delay: ' + delay + 's; --akari-tok-dur: '
                        + formatCaptionSeconds(Math.max(0.01, word.end - word.start)) + 's'
                    : style === 'pop' ? '--akari-tok-delay: ' + delay + 's' : '';
                return '<span class="' + className + '" style="' + vars + '">'
                    + escapeCaptionHtml(word.text) + '</span>';
            };
            const renderStyledCaptionFragment = caption => {
                const style = caption.style;
                const textStyleActive = Boolean(caption.textStyle
                    && Object.keys(caption.textStyle).length > 0);
                const hasEmphasis = caption.words.some(word => findMatchingEmphasis(word));
                // reveal（行単位の順送り）: 明示指定に加え、縦長では複数行に折り返す無指定字幕を
                // 自動昇格させる（render-cut generateCaptionOverlays と同じ既定）。
                const reveal = style === 'reveal'
                    || (!style && captionPortrait
                        && splitCaptionLines(caption.text || '', captionLineBudget).length > 1);
                const rootStyle = reveal ? 'reveal' : (style || (hasEmphasis ? 'emphasis' : 'karaoke'));
                const renderLine = line =>
                    line.map(word => renderCaptionToken(word, caption.start, reveal ? null : style)).join('');
                const markup = reveal
                    ? renderRevealGroupsMarkup(
                        groupWordsIntoDisplayLines(caption.words, captionLineBudget),
                        caption.start, caption.end, renderLine)
                    : groupWordsIntoLines(caption.words, captionLineBudget).map(line =>
                        '<p class="akari-caption__line">' + renderLine(line) + '</p>'
                    ).join('');
                const revealCss = reveal
                    ? '.akari-caption--reveal .akari-caption__plate{display:grid;}'
                        + '.akari-caption__reveal-group{grid-area:1 / 1;display:flex;flex-direction:column;gap:var(--plate-gap,4px);opacity:0;animation:akari-caption-reveal var(--akari-reveal-dur,0.2s) var(--akari-reveal-delay,0s) linear both paused;}'
                        + '@keyframes akari-caption-reveal{0%{opacity:0;transform:translateY(0.18em);}12%{opacity:1;transform:translateY(0);}99.99%{opacity:1;transform:translateY(0);}100%{opacity:0;transform:translateY(0);}}'
                    : '';
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : markup;
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                const emphasisCss = hasEmphasis
                    ? '.akari-caption{--akari-emphasis-joy:var(--vscode-akariTheme-accentLighter,#fdba74);--akari-emphasis-pain:var(--vscode-errorForeground,#ff798c);--akari-emphasis-surprise:var(--vscode-akariTheme-accentLight,#fb923c);--akari-emphasis-anger:var(--vscode-errorForeground,#ff798c);--akari-emphasis-sadness:var(--vscode-descriptionForeground,#a3a3a3);--akari-emphasis-emphasis:var(--vscode-akariTheme-accent,#f97316);}'
                        + '@keyframes akari-emphasis-one-char-bang{from{opacity:0;transform:scale(1.6);}to{opacity:1;transform:scale(1);}}'
                        + '@keyframes akari-emphasis-size-pulse{0%{transform:scale(1);}50%{transform:scale(1.25);}100%{transform:scale(1);}}'
                        + '.akari-caption__emphasis-char{display:inline-block;opacity:0;animation:akari-emphasis-one-char-bang var(--akari-emphasis-dur,0.1s) var(--akari-emphasis-delay,0s) ease-out both paused;}'
                        + '.akari-caption__tok--size-pulse{animation:akari-emphasis-size-pulse var(--akari-emphasis-dur,0.2s) var(--akari-emphasis-delay,0s) ease-in-out both paused;}'
                    : '';
                return '<div class="akari-caption akari-caption--' + rootStyle + '">'
                    + '<style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);'
                    + '-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));'
                    + 'paint-order:var(--caption-paint-order,stroke fill);'
                    + 'text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));'
                    + 'font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif;font-size:var(--caption-font-size,38px);font-weight:700;line-height:1.42;text-align:center;}'
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);}'
                    + '.akari-caption__line{width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + blockCss
                    + '.akari-caption__tok{display:inline-block;will-change:transform,color;}'
                    + '@keyframes akari-caption-karaoke-lit{from{color:var(--caption-color,#fff);}to{color:var(--caption-highlight-color,#ffd94a);}}'
                    + '@keyframes akari-caption-pop{0%{transform:translateY(0) scale(1);}50%{transform:translateY(-0.08em) scale(1.12);}100%{transform:translateY(0) scale(1);}}'
                    + '.akari-caption__tok--karaoke{animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}'
                    + '.akari-caption__tok--pop{animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused;}'
                    + revealCss
                    + emphasisCss
                    + '</style><div class="akari-caption__plate">' + plateMarkup + '</div></div>';
            };
            const renderPlainCaptionFragment = caption => {
                if (caption.resolvedTimeline) {
                    return ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_OPEN)}
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_CAPTION_CSS)}
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE)}
                        + escapeCaptionHtml(caption.text)
                        + ${JSON.stringify(RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE)};
                }
                // 焼き込みと同じ自然な区切り（句読点 → 空白 → 文節境界 → 文字上限）で折り返す
                const lines = splitCaptionLines(caption.text || '', captionLineBudget);
                const markup = lines.map(line => '<p class="akari-caption__line">'
                    + escapeCaptionHtml(line) + '</p>').join('');
                const blockMode = caption.textStyle && caption.textStyle.background
                    && caption.textStyle.background.mode === 'block';
                const plateMarkup = blockMode
                    ? '<div class="akari-caption__block">' + markup + '</div>'
                    : markup;
                const blockCss = blockMode
                    ? '.akari-caption__block{display:flex;flex-direction:column;width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);gap:var(--plate-gap,4px);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-block-radius,10px);background:var(--plate-block-bg,transparent);}'
                        + '.akari-caption__block .akari-caption__line{width:auto;max-width:none;margin:0;padding:0;border-radius:0;background:transparent;}'
                    : '';
                return '<div class="akari-caption"><style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);-webkit-text-stroke:var(--caption-webkit-text-stroke,var(--caption-stroke,0.14em rgba(0,0,0,.9)));paint-order:var(--caption-paint-order,stroke fill);text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35));font-family:"AKARI Noto Sans JP","Noto Sans JP",sans-serif;font-size:var(--caption-font-size,38px);font-weight:700;line-height:1.42;text-align:center;}'
                    + '.akari-caption__plate{position:absolute;top:var(--caption-top,auto);left:var(--caption-left,0);right:var(--caption-right,0);bottom:var(--caption-bottom,7%);display:flex;flex-direction:column;justify-content:var(--caption-justify-content,flex-start);align-items:var(--caption-align-items,stretch);gap:var(--plate-gap,4px);}'
                    + '.akari-caption__line{width:max-content;max-width:var(--caption-line-max-width,92%);margin:var(--caption-line-margin,0 auto);padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,transparent);text-align:var(--caption-text-align,center);white-space:pre;}'
                    + blockCss
                    + '</style><div class="akari-caption__plate">' + plateMarkup + '</div></div>';
            };
            const captionStyleVariableNames = ${JSON.stringify(RESOLVED_CAPTION_STYLE_VARIABLE_NAMES)};
            const applyCaptionStyleVars = caption => {
                for (const name of captionStyleVariableNames) {
                    captionPlate.style.removeProperty(name);
                }
                const textStyleActive = Boolean(caption && ((caption.textStyle
                    && Object.keys(caption.textStyle).length > 0) || caption.resolvedTimeline));
                if (!textStyleActive) return;
                const vars = caption.textStyleVars || {};
                for (const [name, value] of Object.entries(vars)) {
                    captionPlate.style.setProperty(name, String(value));
                }
                if (!Object.prototype.hasOwnProperty.call(vars, '--caption-font-size')) {
                    // 明示 size_px が無いときの既定は render-cut と同じ（縦長 = 幅 6% / 横長 = 38px）
                    captionPlate.style.setProperty('--caption-font-size', captionDefaultFontSize + 'px');
                }
            };
            const renderCaption = () => {
                const activeSegment = segments[activeSegmentIndex];
                const time = video.currentTime || 0;
                const resolvedTimeline = captions.some(candidate => candidate.resolvedTimeline);
                // 字幕ウィンドウ判定は共有カーネル（webview-kernel.js / caption-window.ts）
                const caption = (activeSegment && activeSegment.kind === 'gap')
                    ? null
                    : (window.AkariEditKernel.findActiveCaption(captions, resolvedTimeline ? outputTime : time) || null);
                if (caption !== activeCaption) {
                    activeCaption = caption;
                    applyCaptionStyleVars(caption);
                    const hasEmphasis = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.some(word => findMatchingEmphasis(word)));
                    const hasTextStyle = Boolean(caption && ((caption.textStyle
                        && Object.keys(caption.textStyle).length > 0) || caption.resolvedTimeline));
                    const hasCaptionWords = Boolean(caption && Array.isArray(caption.words)
                        && caption.words.length > 0);
                    // reveal（明示 + 縦長の複数行自動昇格）も word ベースの styled 経路で描く
                    const wantsCaptionReveal = hasCaptionWords
                        && (caption.style === 'reveal'
                            || (!caption.style && captionPortrait
                                && splitCaptionLines(caption.text || '', captionLineBudget).length > 1));
                    styledCaptionActive = Boolean(caption
                        && (hasTextStyle || (hasCaptionWords
                            && ((caption.style === 'karaoke' || caption.style === 'pop')
                                || hasEmphasis || wantsCaptionReveal))));
                    captionPlate.classList.toggle('akari-caption-host--styled', styledCaptionActive);
                    if (styledCaptionActive) {
                        const usesWords = hasCaptionWords
                            && ((caption.style === 'karaoke' || caption.style === 'pop')
                                || hasEmphasis || wantsCaptionReveal);
                        captionPlate.innerHTML = usesWords
                            ? renderStyledCaptionFragment(caption)
                            : renderPlainCaptionFragment(caption);
                    } else {
                        captionPlate.textContent = caption ? caption.text : '';
                    }
                    // ㉓ 字幕もオーバーレイ同様「inset:0 全画面ラッパー + 内側配置」パターン
                    // （styled 字幕の .akari-caption 断片）を取り得るため、㉑ と同じ
                    // clip-path 実寸当たり判定を流用する。プレーン字幕（shrink-to-fit の
                    // #caption-plate 自体が既に実寸）は fragmentBounds が null を返し
                    // clip-path 'none'（=元々実寸のフルコンテナ）のまま無害。
                    window.akari.interaction?.syncOverlayHitRegion?.(captionPlate);
                    if (typeof updateCaptionSelectBox === 'function') updateCaptionSelectBox();
                }
                if (caption && styledCaptionActive) {
                    const localMs = (clamp(time, caption.start, caption.end) - caption.start) * 1000;
                    for (const animation of captionPlate.getAnimations({ subtree: true })) {
                        animation.pause();
                        animation.currentTime = localMs;
                    }
                }
            };
            const renderTransitionPlate = timelineTime => {
                const plate = transitionPlates.find(candidate =>
                    timelineTime >= candidate.start && timelineTime <= candidate.end);
                if (!plate) {
                    transitionPlate.style.opacity = '0';
                    return;
                }
                const halfDuration = (plate.end - plate.start) / 2;
                const opacity = halfDuration > 0
                    ? clamp(1 - Math.abs(timelineTime - plate.mid) / halfDuration, 0, 1)
                    : 0;
                transitionPlate.style.background = plate.color;
                transitionPlate.style.opacity = String(opacity);
            };
            const renderLayers = timelineTime => {
                for (const entry of layerEntries) {
                    const layer = entry.spec;
                    const layerVideo = entry.video;
                    layerVideo.muted = allTracksMutedByScope.layers || mutedTracksByScope.layers.has(layer.track);
                    const active = !layer.proxyMissing
                        && typeof layer.src === 'string' && layer.src
                        && !allTracksHiddenByScope.layers
                        && !hiddenTracksByScope.layers.has(layer.track)
                        && timelineTime >= layer.t && timelineTime < layer.t + layer.duration;
                    if (!active) {
                        layerVideo.style.display = 'none';
                        if (!layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    if (layerVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
                        layerVideo.style.display = 'none';
                        continue;
                    }
                    layerVideo.style.display = 'block';
                    const localTime = clamp(timelineTime - layer.t, 0, layer.duration);
                    const mediaEnd = Number.isFinite(layerVideo.duration) && layerVideo.duration > 0
                        ? Math.max(0, layerVideo.duration - 0.001)
                        : layer.duration;
                    const target = Math.min(localTime, mediaEnd);
                    const tolerance = isPlaying ? 0.05 : 0.001;
                    if (Math.abs((layerVideo.currentTime || 0) - target) > tolerance) {
                        try {
                            layerVideo.currentTime = target;
                        } catch (error) {
                            console.warn('[akari-preview] layer seek failed', layer.id, error);
                        }
                    }
                    if (!isPlaying) {
                        if (!layerVideo.paused) layerVideo.pause();
                    } else if (layerVideo.paused) {
                        void layerVideo.play().catch(() => undefined);
                    }
                }
            };
            const applyCutsMuteState = () => {
                const segment = segments[activeSegmentIndex];
                applyCutsZIndex(segment);
                const cutsTrackMuted = Boolean(segment && segment.kind === 'src'
                    && (allTracksMutedByScope.cuts || mutedTracksByScope.cuts.has(segment.track)));
                const cutsTrackHidden = Boolean(segment && segment.kind === 'src'
                    && (allTracksHiddenByScope.cuts || hiddenTracksByScope.cuts.has(segment.track)));
                video.dataset.akariGlobalMuted = String(globalMuted);
                video.muted = globalMuted || cutsTrackMuted;
                video.style.visibility = !segment || segment.kind === 'gap' || cutsTrackHidden ? 'hidden' : '';
            };
            const tick = (immediatePlaybackTick = false) => {
                // ㉕ cuts[].freeze の一時停止ホールド中（contract-2026-08-02-preview-parity.md
                // §2.4.3 の近似実装 — 尺は伸ばさない）: video / previewAudio を実時間で
                // 一時停止したまま outputTime を進めず、rAF の連鎖だけ生かしておく。
                if (freezeHoldUntilMs > 0) {
                    if (performance.now() < freezeHoldUntilMs) {
                        applyCutsMuteState();
                        return;
                    }
                    freezeHoldUntilMs = 0;
                    if (isPlaying) {
                        if (video.paused) void video.play().catch(error => console.error('[akari-preview] freeze hold の再開に失敗しました', error));
                        if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    }
                }
                const segment = segments[activeSegmentIndex];
                if (segment && segment.kind === 'gap') {
                    if (isPlaying) {
                        outputTime = clamp(
                            gapOutputOrigin + (performance.now() - gapWallClockOriginMs) / 1000,
                            segment.outStart,
                            segment.outEnd
                        );
                        if (outputTime >= segment.outEnd - 0.0005) {
                            const nextIndex = activeSegmentIndex + 1;
                            if (nextIndex < segments.length) {
                                outputTime = segments[nextIndex].outStart;
                                enterSegment(nextIndex);
                            } else {
                                stopAtNaturalEnd();
                            }
                        }
                    }
                } else if (segment) {
                    outputTime = sourceToTimeline(video.currentTime || 0, activeSegmentIndex);
                    applyKeepRangeBoundary();
                    const activeSegment = segments[activeSegmentIndex];
                    if (isPlaying && activeSegment && activeSegment.kind === 'src'
                        && freezeHoldConsumedForSegmentIndex !== activeSegmentIndex) {
                        const freezeCheck = checkCutFreezeCrossingFn(activeSegment.freeze, playedCutLocalSeconds(activeSegment));
                        if (freezeCheck.shouldHold) {
                            freezeHoldConsumedForSegmentIndex = activeSegmentIndex;
                            freezeHoldUntilMs = performance.now() + freezeCheck.holdSeconds * 1000;
                            video.pause();
                            if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        }
                    }
                } else {
                    outputTime = video.currentTime || 0;
                }
                applyCutFramingVisual();
                renderLayers(outputTime);
                updateLayerSelectBox();
                renderTransitionPlate(outputTime);
                window.akari.runtime.tick(outputTime, isPlaying);
                if (window.akari.previewAudio) {
                    window.akari.previewAudio.setMutedTracks(
                        mutedTracksByScope.audio, allTracksMutedByScope.audio
                    );
                    window.akari.previewAudio.tick(outputTime, isPlaying);
                }
                // タイムライン横軸と同じ出力秒（cuts ギャップレス連結後の秒）を送る（音声側も timelineTime で駆動済み）。
                window.akari.playbackTick(outputTime, isPlaying, immediatePlaybackTick);
                renderCaption();
                updateTransport();
                updateWaveformPlayhead();
                applyCutsMuteState();
            };
            const runTickGuarded = () => {
                // A thrown exception here would otherwise abort animate()/the
                // watchdog callback before their requestAnimationFrame re-arm runs,
                // permanently killing the rAF self-chain (defense in depth -
                // real-data testing found no such exception, but tick() has many
                // data-dependent branches and this keeps any future one from being
                // fatal to playback).
                try {
                    tick();
                } catch (error) {
                    console.error('[akari-preview] tick failed; continuing animation loop', error);
                }
            };
            const animate = () => {
                lastTickAtMs = performance.now();
                runTickGuarded();
                if (isPlaying) animationFrame = requestAnimationFrame(animate);
            };
            const startAnimation = () => {
                cancelAnimationFrame(animationFrame);
                lastTickAtMs = performance.now();
                animationFrame = requestAnimationFrame(animate);
                window.clearInterval(animationWatchdogTimer);
                // rAF の連鎖が途切れると outputTime/シークバー/video が永久停止する一方、
                // previewAudio は壁時計駆動で鳴り続ける「片肺」状態になる（実機再現済み）。
                // rAF が生きている間は lastTickAtMs が毎フレーム更新されるため素通りする監視。
                animationWatchdogTimer = window.setInterval(() => {
                    if (!isPlaying) {
                        window.clearInterval(animationWatchdogTimer);
                        animationWatchdogTimer = 0;
                        return;
                    }
                    if (performance.now() - lastTickAtMs > 400) {
                        cancelAnimationFrame(animationFrame);
                        lastTickAtMs = performance.now();
                        runTickGuarded();
                        animationFrame = requestAnimationFrame(animate);
                    }
                }, 200);
            };
            const stopAnimation = () => {
                cancelAnimationFrame(animationFrame);
                animationFrame = 0;
                window.clearInterval(animationWatchdogTimer);
                animationWatchdogTimer = 0;
                tick(true);
            };
            const showPlaybackError = () => {
                playbackErrored = true;
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
                video.pause();
                video.hidden = true;
                layersStage.hidden = true;
                stage.hidden = true;
                captionPlate.textContent = '';
                previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                previewMessageReload.hidden = false;
                previewMessage.hidden = false;
                playToggle.disabled = true;
                frameBack.disabled = true;
                frameForward.disabled = true;
                skipBack.disabled = true;
                skipForward.disabled = true;
                waveformToggle.disabled = true;
                zoomToggle.disabled = true;
                fullscreenToggle.disabled = true;
                seek.disabled = true;
            };
            const restorePlayback = () => {
                if (!playbackErrored) return;
                playbackErrored = false;
                previewMessage.hidden = true;
                previewMessageReload.hidden = true;
                video.hidden = false;
                layersStage.hidden = false;
                stage.hidden = false;
                playToggle.disabled = false;
                frameBack.disabled = false;
                frameForward.disabled = false;
                skipBack.disabled = false;
                skipForward.disabled = false;
                waveformToggle.disabled = false;
                zoomToggle.disabled = false;
                fullscreenToggle.disabled = false;
                seek.disabled = false;
                updateTransport();
                tick(true);
            };
            previewMessageReload.addEventListener('click', () => video.load());
            const togglePlayback = () => {
                if (playToggle.disabled) return;
                if (!isPlaying) {
                    abortCurrentStroke();
                    isPlaying = true;
                    setPenModeActive(false);
                    window.akari.reviewTransport({ type: 'play', timelineT: outputTime });
                    if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    const segment = segments[activeSegmentIndex];
                    if (segment && segment.kind === 'gap') {
                        gapWallClockOriginMs = performance.now();
                        gapOutputOrigin = outputTime;
                        if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    } else {
                        void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                    }
                    startAnimation();
                } else {
                    isPlaying = false;
                    // ㉕ 手動一時停止はフリーズホールドを打ち切る（保留中タイマーを引きずったまま
                    // 次の再開で誤って再一時停止しない — contract-2026-08-02-preview-parity.md §2.4.3）。
                    freezeHoldUntilMs = 0;
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                    if (window.akari.previewAudio) window.akari.previewAudio.pause();
                    video.pause();
                    stopAnimation();
                }
            };
            const isEditable = element => {
                if (!(element instanceof HTMLElement)) return false;
                if (element.isContentEditable) return true;
                if (element.matches('textarea')) return true;
                if (element.matches('input')) {
                    const nonTextInputTypes = [
                        'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'
                    ];
                    return !nonTextInputTypes.includes(element.type);
                }
                return false;
            };
            const videoDuration = () => Number.isFinite(video.duration) ? video.duration : 0;
            const nudgeFrame = direction => {
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                video.pause();
                seekTimelineTime(outputTime + direction / fps);
                stopAnimation();
            };
            const skipSeconds = seconds => {
                seekTimelineTime(outputTime + seconds);
                tick(true);
            };

            playToggle.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                togglePlayback();
            });
            frameBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(-1);
            });
            frameForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                nudgeFrame(1);
            });
            skipBack.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(-10);
            });
            skipForward.addEventListener('click', () => {
                clearStaticAnnotationStrokes();
                skipSeconds(10);
            });
            waveformToggle.addEventListener('click', () => {
                const show = waveformRow.hidden;
                waveformRow.hidden = !show;
                waveformToggle.setAttribute('aria-pressed', String(show));
                if (!show) return;
                drawWaveform();
                updateWaveformPlayhead();
                void loadWaveform();
            });
            new ResizeObserver(() => {
                window.clearTimeout(waveformResizeTimer);
                waveformResizeTimer = window.setTimeout(() => {
                    if (waveformRow.hidden) return;
                    if (waveformState === 'ready') {
                        waveformPeaks = aggregateWaveform(waveformBinCount());
                    }
                    drawWaveform();
                }, 300);
            }).observe(waveformRow);
            const seekFromWaveformPointer = event => {
                const rect = waveformCanvas.getBoundingClientRect();
                const duration = segments.length > 0 ? totalTimelineDuration : videoDuration();
                if (rect.width <= 0 || duration <= 0) return;
                const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                seekTimelineTime(fraction * duration);
                tick();
            };
            waveformCanvas.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                clearStaticAnnotationStrokes();
                waveformDragPointer = event.pointerId;
                waveformCanvas.setPointerCapture(event.pointerId);
                seekFromWaveformPointer(event);
            });
            waveformCanvas.addEventListener('pointermove', event => {
                if (waveformDragPointer !== event.pointerId) return;
                event.preventDefault();
                seekFromWaveformPointer(event);
            });
            const finishWaveformSeek = event => {
                if (waveformDragPointer !== event.pointerId) return;
                seekFromWaveformPointer(event);
                waveformDragPointer = null;
                if (waveformCanvas.hasPointerCapture(event.pointerId)) {
                    waveformCanvas.releasePointerCapture(event.pointerId);
                }
            };
            waveformCanvas.addEventListener('pointerup', finishWaveformSeek);
            waveformCanvas.addEventListener('pointercancel', event => {
                if (waveformDragPointer !== event.pointerId) return;
                waveformDragPointer = null;
            });
            zoomToggle.addEventListener('click', () => {
                zoomPopup.hidden = !zoomPopup.hidden;
                zoomToggle.setAttribute('aria-expanded', String(!zoomPopup.hidden));
            });
            indicatorToggle.addEventListener('click', () => {
                indicatorPopup.hidden = !indicatorPopup.hidden;
                indicatorToggle.setAttribute('aria-expanded', String(!indicatorPopup.hidden));
            });
            indicatorToggle.addEventListener('mouseenter', () => {
                indicatorPopup.hidden = false;
                indicatorToggle.setAttribute('aria-expanded', 'true');
            });
            zoomSlider.addEventListener('input', () => setZoom(sliderToZoom(Number(zoomSlider.value))));
            zoomSlider.addEventListener('dblclick', () => setZoom(1));
            for (const preset of document.querySelectorAll('.zoom-preset')) {
                preset.addEventListener('click', () => setZoom(Number(preset.getAttribute('data-zoom'))));
            }
            // capture 段で登録: パン開始の stopPropagation（ズーム中の wrapper pointerdown）に
            // 外側クリック検知が殺されないようにする
            document.addEventListener('pointerdown', event => {
                if (!zoomPopup.hidden && !event.target.closest('.transport-right')) {
                    zoomPopup.hidden = true;
                    zoomToggle.setAttribute('aria-expanded', 'false');
                }
                if (!indicatorPopup.hidden && !event.target.closest('.transport-left')) {
                    indicatorPopup.hidden = true;
                    indicatorToggle.setAttribute('aria-expanded', 'false');
                }
            }, true);
            previewPane.addEventListener('wheel', event => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const factor = Math.exp(-event.deltaY * 0.01);
                setZoom(clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX));
            }, { passive: false });
            wrapper.addEventListener('pointerdown', event => {
                if (penModeActive || zoom <= 1.05 || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                wrapper.setPointerCapture(event.pointerId);
                drag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    base: { x: pan.x, y: pan.y },
                    vidW: zoomLayer.offsetWidth * zoom,
                    vidH: zoomLayer.offsetHeight * zoom,
                    didMove: false
                };
            }, true);
            wrapper.addEventListener('pointermove', event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (!drag.didMove && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
                    drag.didMove = true;
                    wrapper.classList.add('is-dragging');
                }
                if (!drag.didMove) return;
                const maxR = (zoom - 1) / (2 * zoom);
                pan = {
                    x: clamp(drag.base.x + dx / drag.vidW, -maxR, maxR),
                    y: clamp(drag.base.y + dy / drag.vidH, -maxR, maxR)
                };
                renderZoom();
            }, true);
            const finishPan = event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const didMove = drag.didMove;
                drag = null;
                wrapper.classList.remove('is-dragging');
                if (wrapper.hasPointerCapture(event.pointerId)) wrapper.releasePointerCapture(event.pointerId);
                if (didMove) suppressClick = true;
            };
            wrapper.addEventListener('pointerup', finishPan, true);
            wrapper.addEventListener('pointercancel', finishPan, true);
            wrapper.addEventListener('click', event => {
                if (!suppressClick) return;
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            fullscreenToggle.addEventListener('click', () => {
                void window.akari.toggleFullscreen().catch(error => console.error('[akari-preview] fullscreen failed', error));
            });
            document.addEventListener('fullscreenchange', () => {
                const isFullscreen = Boolean(document.fullscreenElement);
                fullscreenToggle.setAttribute('aria-pressed', String(isFullscreen));
                fullscreenToggle.setAttribute('aria-label', isFullscreen ? '全画面解除' : '全画面');
                fullscreenToggle.title = isFullscreen ? '全画面解除' : '全画面';
                fullscreenToggle.innerHTML = isFullscreen ? restoreIcon : fullscreenIcon;
            });
            window.addEventListener('keydown', event => {
                if ((event.code !== 'Space' && event.key !== ' ')
                    || isEditable(event.target)
                    || isEditable(document.activeElement)
                    || playToggle.disabled) return;
                event.preventDefault();
                clearStaticAnnotationStrokes();
                togglePlayback();
            });
            seek.addEventListener('input', () => {
                clearStaticAnnotationStrokes();
                seekTimelineTime(Number(seek.value));
                tick();
            });
            let requestedOverlayId;
            const applyRequestedOverlaySelection = () => {
                if (requestedOverlayId === undefined) return;
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedId === requestedOverlayId) return;
                if (requestedOverlayId === null) {
                    if (selected) {
                        window.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
                        }));
                    }
                    return;
                }
                const target = Array.from(stage.querySelectorAll('[data-overlay-id]'))
                    .find(candidate => candidate.getAttribute('data-overlay-id') === requestedOverlayId);
                if (!target || getComputedStyle(target).visibility === 'hidden') return;
                const fragment = Array.from(target.children)
                    .find(candidate => !candidate.hasAttribute('data-akari-interaction'));
                const rect = (fragment || target).getBoundingClientRect();
                target.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
            };
            video.addEventListener('loadedmetadata', () => {
                void sfxDurationsReady.then(() => {
                    restorePlayback();
                    rebuildSegments();
                    applyInitialPosition();
                    updateTransport();
                });
            });
            video.addEventListener('canplay', restorePlayback);
            video.addEventListener('play', () => {
                if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                if (isPlaying) startAnimation();
            });
            video.addEventListener('play', () => {
                // 無音素材の検知は 1 ドキュメントにつき 1 回だけ。再生開始から 1.5 秒後、
                // まだ再生中で webkitAudioDecodedByteCount が 0（対応ブラウザのみ）なら無音とみなす。
                window.setTimeout(() => {
                    if (audioNoticeShown || video.paused || video.ended) return;
                    if (!('webkitAudioDecodedByteCount' in video)) return;
                    if (video.webkitAudioDecodedByteCount === 0) {
                        audioNoticeShown = true;
                        audioNotice.hidden = false;
                    }
                }, 1500);
            });
            video.addEventListener('pause', () => {
                if (pausedForGapEntry) {
                    pausedForGapEntry = false;
                    return;
                }
                // Every intentional pause call site (togglePlayback's stop branch,
                // nudgeFrame, stopAtNaturalEnd, showPlaybackError) flips isPlaying
                // to false *before* calling video.pause(), so isPlaying still being
                // true here means the browser paused the element on its own -
                // observed reliably as a single spurious native pause ~0.3-0.8s
                // into the first playback of a large (100s+ MB) source.mp4 right
                // after a fresh <video> load (e.g. every full webview reload
                // triggered by an edit.json save while playing). Tearing down the
                // animation/audio loop here would leave the raw <video> decoding
                // ungoverned by tick() while previewAudio keeps its own independent
                // schedule - the "video/seekbar stuck, audio still going" freeze.
                // Resume instead; if that also fails, fall back to a real stop.
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src' && !video.ended) {
                    void video.play().catch(error => {
                        console.error('[akari-preview] unexpected pause auto-resume failed', error);
                        window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                        isPlaying = false;
                        if (window.akari.previewAudio) window.akari.previewAudio.pause();
                        stopAnimation();
                    });
                    return;
                }
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('ended', () => {
                if (isPlaying) {
                    window.akari.reviewTransport({ type: 'pause', timelineT: outputTime });
                }
                isPlaying = false;
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('seeking', () => {
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            });
            video.addEventListener('seeked', () => {
                tick(true);
                const segment = segments[activeSegmentIndex];
                if (isPlaying && segment && segment.kind === 'src') {
                    if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(outputTime);
                    if (video.paused) void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                }
                applyRequestedOverlaySelection();
            });
            video.addEventListener('error', showPlaybackError);
            audioNoticeDismiss.addEventListener('click', () => {
                audioNotice.hidden = true;
            });
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-set-review-recording'
                    && typeof message.active === 'boolean') {
                    reviewRecordingActive = message.active;
                    penToggle.hidden = !reviewRecordingActive;
                    if (!reviewRecordingActive) {
                        abortCurrentStroke();
                        setPenModeActive(false);
                    }
                    updateTransport();
                    return;
                }
                if (message && message.type === 'akari-preview-show-annotation-strokes') {
                    showStaticAnnotationStrokes(message.points);
                    return;
                }
                if (message && message.type === 'akari-preview-captions-update') {
                    captions = Array.isArray(message.captions) ? message.captions : [];
                    renderCaption();
                    return;
                }
                if (message && message.type === 'akari-preview-set-muted' && typeof message.muted === 'boolean') {
                    globalMuted = message.muted;
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility'
                    && Number.isInteger(message.track) && message.track >= 0 && typeof message.visible === 'boolean') {
                    if (message.visible) hiddenTracks.delete(message.track); else hiddenTracks.add(message.track);
                    applyTrackVisibility(message.track);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2') {
                    const { scope, track, hidden, muted } = message;
                    if ((scope === 'cuts' || scope === 'layers' || scope === 'audio') && typeof hidden === 'boolean') {
                        if (track === null) {
                            allTracksHiddenByScope[scope] = hidden;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (hidden) hiddenTracksByScope[scope].add(track);
                            else hiddenTracksByScope[scope].delete(track);
                        }
                    }
                    if ((scope === 'cuts' || scope === 'audio' || scope === 'layers') && typeof muted === 'boolean') {
                        if (track === null) {
                            allTracksMutedByScope[scope] = muted;
                        } else if (Number.isInteger(track) && track >= 0) {
                            if (muted) mutedTracksByScope[scope].add(track);
                            else mutedTracksByScope[scope].delete(track);
                        }
                    }
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(
                            mutedTracksByScope.audio, allTracksMutedByScope.audio
                        );
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility-v2-bulk') {
                    hiddenTracksByScope.cuts = new Set(Array.isArray(message.hiddenCuts) ? message.hiddenCuts : []);
                    mutedTracksByScope.cuts = new Set(Array.isArray(message.mutedCuts) ? message.mutedCuts : []);
                    hiddenTracksByScope.layers = new Set(Array.isArray(message.hiddenLayers) ? message.hiddenLayers : []);
                    mutedTracksByScope.layers = new Set(Array.isArray(message.mutedLayers) ? message.mutedLayers : []);
                    if (window.akari.previewAudio) {
                        window.akari.previewAudio.setMutedTracks(mutedTracksByScope.audio, allTracksMutedByScope.audio);
                    }
                    tick(true);
                    return;
                }
                if (message && message.type === 'akari-preview-set-captions-visibility'
                    && typeof message.visible === 'boolean') {
                    captionPlate.style.visibility = message.visible ? 'visible' : 'hidden';
                    return;
                }
                if (message && message.type === 'akari-preview-seek' && Number.isFinite(message.time)) {
                    seekTimelineTime(message.time);
                    tick();
                    return;
                }
                if (message && message.type === 'akari-preview-toggle-playback') {
                    togglePlayback();
                    return;
                }
                if (message && message.type === 'akari-preview-select-overlay'
                    && (typeof message.overlayId === 'string' || message.overlayId === null)) {
                    requestedOverlayId = message.overlayId;
                    applyRequestedOverlaySelection();
                }
                if (message && message.type === 'akari-preview-select-layer'
                    && (typeof message.layerId === 'string' || message.layerId === null)) {
                    selectLayer(message.layerId, { report: false });
                }
                if (message && message.type === 'akari-preview-live-transform' && message.target
                    && (message.target.kind === 'cut' || message.target.kind === 'layer')
                    && typeof message.field === 'string' && Number.isFinite(message.value)) {
                    // ドラッグ中の ephemeral 反映: summary/segments は一切書き換えず、applyCutVisual/
                    // layerEntries が読む dataset を直接上書きして updateLayerLayout() で再計算させるだけ。
                    // 確定書き込み(pointerup)後は edit.json 変更検知 → queueRefresh() の通常経路で
                    // 正規の HTML に置き換わるため、ここで明示的な「クリア」は不要
                    // （Esc 破棄時は元値を持つ同型メッセージが再送されて上書きされる）。
                    const applyLiveField = element => {
                        if (message.field === 'x') element.dataset.akariTransformX = String(message.value);
                        else if (message.field === 'y') element.dataset.akariTransformY = String(message.value);
                        else if (message.field === 'scale') element.dataset.akariTransformScale = String(message.value);
                        else if (message.field === 'rotate') element.dataset.akariTransformRotate = String(message.value);
                        else if (message.field === 'opacity') element.style.opacity = String(message.value);
                    };
                    if (message.target.kind === 'cut') {
                        if (message.field !== 'opacity') video.dataset.akariCutTransformActive = 'true';
                        applyLiveField(video);
                    } else if (typeof message.target.id === 'string') {
                        const layerVideo = layersStage.querySelector(
                            'video[data-akari-layer-id="' + CSS.escape(message.target.id) + '"]'
                        );
                        if (layerVideo) applyLiveField(layerVideo);
                    }
                    if (window.akari.updateLayerLayout) window.akari.updateLayerLayout();
                    updateLayerSelectBox();
                    return;
                }
            });

            let lastReportedOverlayId = null;
            const reportOverlaySelectionChange = () => {
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedOverlayId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedOverlayId !== lastReportedOverlayId) {
                    lastReportedOverlayId = selectedOverlayId;
                    requestedOverlayId = undefined;
                    window.akari.reportOverlaySelection(selectedOverlayId);
                }
            };
            new MutationObserver(reportOverlaySelectionChange).observe(stage, {
                attributes: true,
                attributeFilter: ['data-akari-interaction-selected'],
                subtree: true
            });

            Promise.all([window.__akariCaptionFontReady, window.akari.runtime.mount(summary), sfxDurationsReady]).then(() => {
                applyOverlayTracks();
                stage.append(transitionPlate, captionPlate);
                const indicators = Array.isArray(summary.indicators) ? summary.indicators : [];
                const INDICATOR_GLOSSARY = {
                    'LUT': '色調フィルタ',
                    'クロマキー': '背景透過',
                    '音声マスター処理': 'ノイズ除去・音量正規化',
                    'ディゾルブ切り替え': 'カットの溶け込み切替'
                };
                indicatorToggle.hidden = indicators.length === 0;
                if (indicators.length > 0) {
                    const items = indicators.map(item => INDICATOR_GLOSSARY[item]
                        ? item + ' = ' + INDICATOR_GLOSSARY[item]
                        : item).join(' / ');
                    indicatorPopup.textContent = 'プレビュー未対応（書き出し時のみ適用）: ' + items;
                }
                rebuildSegments();
                applyInitialPosition();
                setZoom(1);
                tick();
                reportOverlaySelectionChange();
                applyRequestedOverlaySelection();
            }).catch(error => console.error('[akari-preview] overlay mount failed', error));
        })();`;
    }

    protected async isInsideWorkspace(uri: URI): Promise<boolean> {
        const value = uri.toString();
        return (await this.workspaceService.roots).some(root => {
            const prefix = root.resource.toString().replace(/\/$/, '') + '/';
            return value === root.resource.toString() || value.startsWith(prefix);
        });
    }

    protected streamOrigin(source: string): string {
        const parsed = new URL(source);
        return parsed.origin;
    }

    protected async disposeVideoStream(widget: PreviewWidgetMarker): Promise<void> {
        const id = widget.akariPreviewStreamId;
        widget.akariPreviewStreamId = undefined;
        if (id) {
            await this.disposeVideoStreamId(id);
        }
    }

    protected async disposeVideoStreamId(id: string): Promise<void> {
        try {
            await this.previewService.disposeVideoStream(id);
        } catch (error) {
            console.warn(`[akari-preview] failed to dispose video stream ${id}`, error);
        }
    }

    protected async disposeAssetStreams(ids: string[]): Promise<void> {
        await Promise.all(ids.map(async id => {
            try {
                await this.previewService.disposeAssetStream(id);
            } catch (error) {
                console.warn(`[akari-preview] failed to dispose asset stream ${id}`, error);
            }
        }));
    }

    protected async disposePreviewStreams(widget: PreviewWidgetMarker): Promise<void> {
        const assetIds = widget.akariPreviewAssetStreamIds ?? [];
        widget.akariPreviewAssetStreamIds = [];
        const extraIds = widget.akariPreviewExtraStreamIds ?? [];
        widget.akariPreviewExtraStreamIds = [];
        await Promise.all([
            this.disposeVideoStream(widget),
            ...extraIds.map(id => this.disposeVideoStreamId(id)),
            this.disposeAssetStreams(assetIds)
        ]);
    }

    protected readText(uri: URI): Promise<string> {
        return this.fileService.readFile(uri).then(content => content.value.toString());
    }

    protected toBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    protected transform(value: any): OverlayTransform {
        return {
            x: this.finiteNumber(value?.x, 0),
            y: this.finiteNumber(value?.y, 0),
            scale: this.finiteNumber(value?.scale, 1),
            rotate: this.finiteNumber(value?.rotate, 0)
        };
    }

    protected objectRecord(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    protected stringRecord(value: unknown): Record<string, string> {
        return Object.fromEntries(Object.entries(this.objectRecord(value)).map(([key, item]) => [key, String(item)]));
    }

    protected normalizeEmphasisWords(value: unknown): EditSummaryEmphasisWord[] {
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            console.warn('[akari-preview] emphasis_words を無視しました（配列ではありません）');
            return [];
        }
        const seenIds = new Set<string>();
        const normalized: EditSummaryEmphasisWord[] = [];
        for (const [index, item] of value.entries()) {
            const candidate = item && typeof item === 'object' && !Array.isArray(item)
                ? item as Record<string, unknown>
                : undefined;
            const valid = candidate !== undefined
                && typeof candidate.id === 'string'
                && /^e-\d{4}$/u.test(candidate.id)
                && !seenIds.has(candidate.id)
                && typeof candidate.t_start === 'number'
                && Number.isFinite(candidate.t_start)
                && candidate.t_start >= 0
                && typeof candidate.t_end === 'number'
                && Number.isFinite(candidate.t_end)
                && candidate.t_end > candidate.t_start
                && typeof candidate.word === 'string'
                && /\S/u.test(candidate.word)
                && typeof candidate.emotion === 'string'
                && /\S/u.test(candidate.emotion)
                && (candidate.src === undefined || (typeof candidate.src === 'string' && /\S/u.test(candidate.src)))
                && (candidate.style_hint === undefined || typeof candidate.style_hint === 'string');
            if (!valid || !candidate) {
                console.warn(`[akari-preview] emphasis_words[${index}] を無視しました（要素が不正です）`);
                continue;
            }
            seenIds.add(candidate.id as string);
            normalized.push({
                id: candidate.id as string,
                ...(candidate.src !== undefined ? { src: candidate.src as string } : {}),
                t_start: candidate.t_start as number,
                t_end: candidate.t_end as number,
                word: candidate.word as string,
                emotion: candidate.emotion as string,
                ...(candidate.style_hint !== undefined ? { style_hint: candidate.style_hint as string } : {})
            });
        }
        return normalized;
    }

    protected finiteNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    protected positiveNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    // Single implementation of the edit.json asset path resolution judgment (previously
    // duplicated inline in resolveAudioAssets()). classifyEditAssetPath() is a pure, platform-
    // independent helper covered by node --test (see ../common/edit-asset-path.ts); this method
    // is just the thin Theia URI construction on top of it. Order: file: scheme, then Windows
    // drive-letter absolute, then UNC, then POSIX absolute, then relative (resolved against the
    // edit.json's parent directory). edit.json's own canon is project-relative paths, so darwin
    // never actually receives a "C:\..." value in practice; this only has to be correct in
    // principle for a future Windows port, not exercised end-to-end on this platform.
    protected resolveEditAssetUri(pathValue: string, editUri: URI): URI {
        switch (classifyEditAssetPath(pathValue)) {
            case 'file-uri':
                return new URI(pathValue);
            case 'windows-drive':
                return new URI(windowsDriveToFileUriString(pathValue));
            case 'unc':
                return new URI(uncToFileUriString(pathValue));
            case 'posix-absolute':
                return new URI(pathValue).withScheme('file');
            case 'relative':
            default:
                return editUri.parent.resolve(pathValue);
        }
    }

    protected previewProxyUri(sourceUri: URI): URI {
        const base = sourceUri.path.base;
        const proxyBase = /\.mov$/i.test(base)
            ? base.replace(/\.mov$/i, '.preview.webm')
            : `${base}.preview.webm`;
        return sourceUri.parent.resolve(proxyBase);
    }

    protected pathBase(value: string): string {
        return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected safeJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    protected escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected inlineScript(value: string): string {
        return value.replace(/<\/script/gi, '<\\/script');
    }

    protected inlineStyle(value: string): string {
        return value.replace(/<\/style/gi, '<\\/style');
    }

}

@injectable()
export class AkariOutputPreviewOpenHandler implements OpenHandler {
    readonly id = 'akari-output-preview-open-handler';

    @inject(AkariPreviewOpenHandler)
    protected readonly previewHandler: AkariPreviewOpenHandler;

    canHandle(uri: URI): number {
        return uri.path.base === 'edit.json' ? 1200 : 0;
    }

    open(uri: URI, options?: any): Promise<WebviewWidget> {
        return this.previewHandler.openOutput(uri, options);
    }
}
