import type { EditAudioKeyframe, TransitionType } from '@akari-video/edit-store';
import type { CaptionDisplayPolicy, CaptionTextStyle } from '@akari-video/edit-store';
import type { GenerationBindingView, GenerationSidecarMeta } from './generation-sidecar';

export const AKARI_ANNOTATIONS_SERVICE_PATH = '/services/akari-annotations';
export const AkariAnnotationsService = Symbol('AkariAnnotationsService');

export interface NarrationEngine {
    id: string; label: string; place: 'local' | 'network' | 'cloud'; provider?: string; experimental?: boolean;
    price?: { usd_per_1000_chars: number; verified: boolean; as_of?: string };
    availability: { state: 'available' | 'needs' | 'unconfigured' | 'unsupported'; label: string; detail?: { url?: string; setup_url?: string } };
    default_voice?: string; credit_required?: boolean;
    supports?: { speed: boolean; style: boolean };
}
export interface NarrationVoice { id: string; label: string; default?: boolean; group?: string }
export interface NarrationEnginesResult { version: number; engines: NarrationEngine[] }
export interface NarrationVoicesResult { version: number; engine: string; voices: NarrationVoice[] }
export interface GenerateNarrationRequest {
    projectRootUri: string; engine: string; voice: string; speed?: number; style?: string; irodoriUrl?: string;
    script: string; reading: string; captionId?: string | null; t: number; approved?: boolean;
}
export interface GenerateNarrationResult {
    version?: number; status: 'ok' | 'needs_approval'; id?: string; path?: string; duration_s?: number;
    engine?: string; voice?: string; cost_usd?: number; applied?: boolean;
    caption_ref?: string | null; provenance?: Record<string, unknown>; warnings?: string[];
    estimate_usd?: number; chars?: number;
}
export interface ApplyNarrationRequest {
    projectRootUri: string; path: string; t: number; script: string; reading: string;
    provenance?: Record<string, unknown>; captionRef?: string | null; id?: string;
}
export type ApplyNarrationItem = Omit<ApplyNarrationRequest, 'projectRootUri'>;
export interface ApplyNarrationsRequest {
    projectRootUri: string; items: ApplyNarrationItem[]; replaceIds?: string[];
}

export type MediaUnavailableReason = 'ffmpeg-not-found' | 'source-missing' | 'extraction-failed';

export const THUMBNAIL_WIDTH_PX = 160;
export const WAVEFORM_BUCKET_COUNT = 200;
export const CLIP_SILENCE_NOISE_DB = -35;
export const CLIP_SILENCE_MIN_SEC = 0.3;

/** フィルムストリップ atlas の既定パラメータ（旧版 `thumbnail_strip()` の実測値を踏襲）。 */
export const FILMSTRIP_FRAME_WIDTH_PX = 98;
export const FILMSTRIP_FPS = 2.0;
export const FILMSTRIP_COLS = 32;
/**
 * チャンク境界のソース時間長（秒）。素材全体をこの等間隔グリッド
 * （`floor(sourceT / FILMSTRIP_CHUNK_SECONDS)`）で区切る。クリップの in/out や
 * トリムには依存しない（トリムで再焼成しない性質は T2 の全体 atlas 方式から継承）。
 * 既定 fps（2.0）では 120s ちょうど 240 コマ = 32 列 × 8 行に一致する。
 */
export const FILMSTRIP_CHUNK_SECONDS = 120;
/** 1 チャンクの暴走防止上限（既定パラメータでは 120s × 2fps = 240 コマにちょうど一致し、通常はここに届かない）。 */
export const FILMSTRIP_MAX_FRAMES_PER_CHUNK = 240;

export interface ExtractSourceFrameRequest {
    projectRootUri: string;
    sourcePath: string;
    atSeconds: number;
    which: 'first' | 'last';
}
export interface ExtractSourceFrameResult { relativePath: string; sha256: string; }

export interface GetClipThumbnailRequest {
    projectRootUri: string;
    videoUri: string;
    atSeconds: number;
}

export interface GetClipThumbnailResult {
    status: 'ready' | 'unavailable';
    dataUri?: string;
    reason?: MediaUnavailableReason;
}

export interface ReadGenerationSidecarsRequest {
    projectRootUri: string;
    sourcePaths: string[];
}

export interface ReadGenerationSidecarsResult {
    entries: Array<{ sourcePath: string; meta: GenerationSidecarMeta; binding: GenerationBindingView | null }>;
}

export interface GenerationCatalogRow {
    id: string;
    kind: string;
    provider?: string;
    family?: string;
    inputs: Record<string, unknown>;
    duration: Record<string, unknown>;
    resolutions?: string[] | null;
    aspects?: string[] | null;
    audio_out?: boolean | 'always';
    seed?: boolean;
    price?: { unit?: string; by_resolution?: Record<string, number>; audio_multiplier?: number | null } | null;
    as_of?: string | null;
    [key: string]: unknown;
}

export interface ReadGenerationCatalogResult { models: GenerationCatalogRow[]; }
export interface ReadGenerationDefaultsResult { video: string; }
export interface ValidateGenerationInputsRequest {
    modelId: string;
    inputs: Record<string, unknown>;
    output: Record<string, unknown>;
}
export interface GenerationValidationResult {
    ok: boolean;
    normalized: { inputs: Record<string, unknown>; output: Record<string, unknown> };
    rounded: { duration_s?: { from: number; to: number; reason?: string } } | null;
    messages: Array<{ level: 'error' | 'warn' | 'info'; code?: string; text: string }>;
    cost: { estimate_usd: number | null; as_of?: string | null; source?: string; needs_explicit_confirm?: boolean };
}
export interface WriteGenerationDraftRequest extends ValidateGenerationInputsRequest {
    projectRootUri: string;
    itemId: string;
}
export interface StartGenerateVideoRequest {
    projectRootUri: string;
    itemId: string;
    approved?: boolean;
}
export interface GenerationProcessRequest { projectRootUri: string; itemId: string; }
export interface GenerationProcessResult {
    ok: boolean;
    reason?: string;
    stdout: string;
    stderr?: string;
    exitCode?: number | null;
}
export interface ImageRouteState { id: 'codex'; state: 'ready' | 'signed-out' | 'missing'; detail: string; }
export interface StartGenerateStillRequest { projectRootUri: string; itemId: string; prompt: string; aspect: '16:9' | '9:16' | '1:1'; }
export interface GenerateStillResult { ok: boolean; reason?: string; relativePath?: string; width?: number; height?: number; elapsedSeconds?: number; cancelled?: boolean; }

export interface GetClipFilmstripChunkRequest {
    projectRootUri: string;
    /** 素材（クリップ区間ではなく素材全体）の URI。チャンクはこの単位 + chunkIndex でキャッシュされる。 */
    videoUri: string;
    /** `floor(sourceT / FILMSTRIP_CHUNK_SECONDS)`。0 始まり。 */
    chunkIndex: number;
    frameWidth?: number;
    fps?: number;
}

/** チャンク 1 枚分の atlas レイアウト。frame は `idx = row * cols + col`、余りは黒で埋められる。 */
export interface ClipFilmstripChunk {
    /** atlas 画像を指す URI（file スキーム）。widget はこれを background-image にそのまま渡す。 */
    atlasUri: string;
    frameWidth: number;
    frameHeight: number;
    cols: number;
    rows: number;
    /** このチャンクで実際に焼いたフレーム数（末尾チャンクは満杯未満になりうる）。 */
    frameCount: number;
    /** 暴走防止クランプ後の実効 fps（静止画は元の fps をそのまま反映）。 */
    fps: number;
    chunkIndex: number;
    /** このチャンクが表すソース時間の開始秒（= `chunkIndex * FILMSTRIP_CHUNK_SECONDS`）。 */
    chunkStartSeconds: number;
    /** このチャンクの実区間長（末尾チャンクは `FILMSTRIP_CHUNK_SECONDS` 未満になりうる）。 */
    chunkDurationSeconds: number;
}

export interface GetClipFilmstripChunkResult {
    status: 'ready' | 'unavailable';
    chunk?: ClipFilmstripChunk;
    reason?: MediaUnavailableReason;
}

export interface GetClipWaveformRequest {
    projectRootUri: string;
    videoUri: string;
    startSeconds: number;
    endSeconds: number;
    bucketCount?: number;
}

export interface GetClipWaveformResult {
    status: 'ready' | 'unavailable';
    peaks?: number[];
    reason?: MediaUnavailableReason;
}

export interface GetClipSilencesRequest {
    projectRootUri: string;
    videoUri: string;
    startSeconds?: number;
    endSeconds?: number;
    noiseDb?: number;
    minSec?: number;
}

export interface GetClipSilencesResult {
    status: 'ready' | 'unavailable';
    silences?: [number, number][];
    reason?: MediaUnavailableReason;
    cached?: boolean;
}

export interface GetAudioDurationRequest {
    projectRootUri: string;
    audioUri: string;
}

export interface ProbeSourceDimensionsRequest { path: string }
export interface ProbeSourceDimensionsResult { width?: number; height?: number }

export interface ProbeSourceHasAudioRequest {
    /** Absolute media path or file URI, as with the existing media read RPCs. */
    path: string;
}

export interface ProbeSourceHasAudioResult {
    hasAudio: boolean;
}

export interface GetAudioDurationResult {
    status: 'ready' | 'unavailable';
    durationSeconds?: number;
    reason?: MediaUnavailableReason;
}

export type {
    Annotation,
    AnnotationResponse,
    AnnotationTargetKind,
    AnnotationRegion,
    AnnotationStroke,
    AnnotationRef
} from './annotation-store';
import type {
    Annotation,
    AnnotationTargetKind,
    AnnotationRegion,
    AnnotationStroke,
    AnnotationRef
} from './annotation-store';

export interface CreateAnnotationRequest {
    reviewUri: string;
    projectRootUri: string;
    /** edit.json v1 の sources[].id 参照（省略 = 単一ソース互換） */
    src?: string | null;
    /** target が doc:<path>#<block-id> / image:<path> のときに限り null を許容する（契約 §2）。 */
    sourceT: number | null;
    sourceRange?: [number, number] | null;
    /** 非推奨。値は無視され、保存時は常に null になる */
    timelineT: number | null;
    target: string | null;
    targetKind?: AnnotationTargetKind | null;
    region?: AnnotationRegion | null;
    strokes?: AnnotationStroke[] | null;
    refs?: AnnotationRef[] | null;
    insertPosition?: 'before' | 'after' | null;
    intent?: string | null;
    text: string;
}

export interface CreateAnnotationResult {
    annotation: Annotation;
    committed: boolean;
}

export interface ResolveAnnotationRequest {
    reviewUri: string;
    annotationId: string;
}

export interface DeleteAnnotationRequest {
    reviewUri: string;
    annotationId: string;
}

export interface DeleteAnnotationResult {
    /** 削除前の全内容。「元に戻す」ボタンから restoreAnnotation にそのまま渡す。 */
    annotation: Annotation;
}

export interface RestoreAnnotationRequest {
    reviewUri: string;
    /** deleteAnnotation が返した annotation をそのまま渡す（id を保ったまま復元する）。 */
    annotation: Annotation;
}

export interface RestoreAnnotationResult {
    annotation: Annotation;
}

/** キャンバス面（contract-2026-07-26-canvas-surface）1 ストローク分の入力。space/tool は固定のため送らない。 */
export interface SaveCanvasStrokeInput {
    /** 正規化 0〜1・キャンバス矩形基準の点列（記録原本は間引かない）。 */
    points: [number, number][];
}

export interface SaveCanvasBackgroundInput {
    /** 選んだ背景画像アセットの絶対 file URI。 */
    uri: string;
}

export interface SaveCanvasRequest {
    projectRootUri: string;
    aspect: { w: number; h: number };
    /** アスペクトの導出元（report.md に記録する調査結果と同じ区分）。 */
    aspectSource: 'edit.json' | 'default';
    background?: SaveCanvasBackgroundInput | null;
    /** 録音なし v0 で唯一のテキスト添付経路（契約 §3「後から typed で添えるメモ」）。 */
    memo?: string | null;
    strokes: SaveCanvasStrokeInput[];
}

export interface SaveCanvasResult {
    /** `c-` + ゼロ埋め連番。 */
    id: string;
}

export interface TrimCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    in: number;
    out: number;
    maxOutSeconds?: number;
}

/**
 * ソーストリマーの slip 操作（R6c-2）: out−in（尺）と t を固定したまま in/out を
 * 同量シフトする。trimCut と異なり at の再計算は発生しない（尺不変のため）。
 */
export interface SlipCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    in: number;
    out: number;
    maxOutSeconds?: number;
}

export interface ReorderCutsRequest {
    editUri: string;
    projectRootUri: string;
    fromIndex: number;
    toIndex: number;
}

export interface MoveCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    at: number;
    track?: number | null;
    trackState?: Record<string, number | null>;
    /** 移動で空になると UI が判定した宣言済み cuts トラック。moveCut の同一書き込みで除去する。 */
    pruneTrackIds?: string[];
}

export interface MoveCutResult extends WriteBackResult {
    prunedTracks?: {
        before: Array<{ id: string; kind: string; ref?: number; label?: string }>;
        after: Array<{ id: string; kind: string; ref?: number; label?: string }>;
    };
}

export interface SetCutAtValuesRequest {
    editUri: string;
    projectRootUri: string;
    entries: Array<{ cutIndex: number; at: number | null }>;
}

export interface ShiftCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
    deltaStart: number;
    deltaEnd: number;
}

export interface SetCaptionTimingRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
    start: number;
    end: number;
    /** null は未宣言へ戻す。undefined は既存宣言を変えない。 */
    timeDomain?: 'source' | 'output' | null;
    edited: boolean;
}

export interface MoveOverlayRequest {
    editUri: string;
    projectRootUri: string;
    overlayId: string;
    start: number;
    track?: number | null;
    trackState?: Record<string, number | null>;
}

export interface ResizeOverlayRequest {
    editUri: string;
    projectRootUri: string;
    overlayId: string;
    duration: number;
}

export interface SplitCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    atSeconds: number;
}

export interface DeleteCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
}

export interface InsertCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    /** 削除時に返された removedText をそのまま渡す（undo 用の原文復元） */
    elementText: string;
}

export interface CutRangeInput {
    in: number;
    out: number;
    kind: 'row' | 'filler' | 'silence' | 'unrecognized';
    captionId?: string;
    /** 台本の範囲エディタが付け、edit.json の cuts / media items へ永続化する由来。 */
    reason?: 'silence' | 'word';
    label?: string;
}

export interface ApplyCutRangesRequest {
    editUri: string;
    projectRootUri: string;
    ranges: CutRangeInput[];
    label: string;
}

export interface ApplyCutRangesResult extends WriteBackResult {
    removedFrames: number;
    beforeSource: string;
}

export interface CaptionWritePayload {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
    /** 省略時は source。undo で削除前の行を丸ごと戻すために運ぶ（additive）。 */
    timeDomain?: 'source' | 'output';
    /** 行ごとのスタイル。undo で落とさないために運ぶ（additive）。 */
    textStyle?: CaptionTextStyle;
    stylePreset?: string;
}

export interface InsertCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    caption: CaptionWritePayload;
    label?: string;
}

export interface RemoveCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
}

export interface SplitCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
    wordIndex: number;
    newCaptionId: string;
}

export interface MergeCaptionsRequest {
    captionsUri: string;
    projectRootUri: string;
    captionIds: string[];
}

export interface OverlayWritePayload extends Record<string, unknown> {
    id: string;
    start: number;
    duration: number;
    track?: number;
}

export interface InsertOverlayRequest {
    editUri: string;
    projectRootUri: string;
    overlay: OverlayWritePayload;
}

export interface RemoveOverlayRequest {
    editUri: string;
    projectRootUri: string;
    overlayId: string;
}

export interface MoveLayerRequest {
    editUri: string;
    projectRootUri: string;
    layerId: string;
    t: number;
    duration: number;
    track?: number;
    trackState?: Record<string, number | null>;
}

export interface RemoveLayerRequest {
    editUri: string;
    projectRootUri: string;
    layerId: string;
}

export interface InsertLayerRequest {
    editUri: string;
    projectRootUri: string;
    layerIndex: number;
    elementText: string;
}

export interface MoveSfxRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
    t: number;
    track?: number;
    trackState?: Record<string, number | null>;
}

export interface RemoveSfxRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
}

export interface TrimSfxRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
    /** 素材秒。null はフィールド削除（in=0 の省略時意味論へ戻す。undo 用）。 */
    in: number | null;
    /** 素材秒。null はフィールド削除（素材末尾までの省略時意味論へ戻す。undo 用）。 */
    out: number | null;
    /** 左端ドラッグ（in 変更）のときのみ指定。右端ドラッグでは t は不変のため省略する。 */
    t?: number;
}

export interface InsertSfxRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
    elementText: string;
}

export interface SetCutSpeedRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    speed: number | null;
}

export interface SetCutTransformRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    x?: number | null;
    y?: number | null;
    scale?: number | null;
    rotate?: number | null;
}

export interface SetCutOpacityRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    opacity: number | null;
}

export interface SetCutTransitionOutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    transitionOut: {
        type: TransitionType;
        duration: number;
    } | null;
}

export interface SetLayerTransformRequest {
    editUri: string;
    projectRootUri: string;
    layerId: string;
    x?: number | null;
    y?: number | null;
    scale?: number | null;
    rotate?: number | null;
}

export interface SetLayerOpacityRequest {
    editUri: string;
    projectRootUri: string;
    layerId: string;
    opacity: number | null;
}

export interface SetLayerBlendRequest {
    editUri: string;
    projectRootUri: string;
    layerId: string;
    blend: string | null;
}

export interface SetSfxGainRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
    gainDb: number | null;
}

// docs/contract-2026-07-25-r6-audio-tracks-and-trim.md §2 addendum (audio-clip-fades,
// 2026-08-18). edit.json spells these audio.sfx[].fade_in/fade_out (snake_case).
export interface SetSfxFadeRequest {
    editUri: string;
    projectRootUri: string;
    sfxIndex: number;
    fadeIn?: number | null;
    fadeOut?: number | null;
}

export interface SetBgmFieldsRequest {
    editUri: string;
    projectRootUri: string;
    gainDb?: number | null;
    fadeIn?: number | null;
    fadeOut?: number | null;
    ducking?: boolean | null;
}

export interface SetOverlayVarRequest {
    editUri: string;
    projectRootUri: string;
    overlayId: string;
    name: string;
    value: string;
}

export interface SetCaptionFieldsRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
    text?: string;
    speaker?: string | null;
    unrecognized?: ReadonlyArray<{ start: number; end: number }> | null;
    style?: string | null;
    displayTiming?: 'full' | 'speech-tight' | null;
}

export interface TextAnimationSlotPatch {
    id: string;
    durationSec?: number;
    ease?: string | null;
    amp?: number | null;
}

export interface SetCaptionTextStyleRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
    textStyle: {
        color?: string | null;
        sizePx?: number | null;
        stroke?: {
            color?: string | null;
            widthPx?: number | null;
        };
        background?: {
            color?: string | null;
            opacity?: number | null;
            radiusPx?: number | null;
        };
        animation?: { in?: TextAnimationSlotPatch | null; out?: TextAnimationSlotPatch | null } | null;
        zone?: 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right'
            | 'bottom-left' | 'bottom' | 'bottom-right' | null;
    };
}

export interface SetCaptionStylePresetRequest {
    captionsUri: string;
    projectRootUri: string;
    captionIds: string[];
    presetId: string | null;
}

export interface WriteBackResult {
    committed: boolean;
}

export interface SetCaptionStylePresetResult extends WriteBackResult {
    changed: number;
    beforeSource: string;
}

export interface SetCaptionDisplayPolicyRequest {
    captionsUri: string;
    projectRootUri: string;
    displayPolicy: CaptionDisplayPolicy;
}

export interface SetCaptionDisplayPolicyResult extends WriteBackResult {
    changed: number;
    beforeSource: string;
}

export interface EmphasisWord {
    /** Omit to reuse an equal span or allocate the lowest unused e-NNNN id. */
    id?: string;
    src?: string | null;
    t_start: number;
    t_end: number;
    word: string;
    emotion: string;
    style_preset?: string;
    style_hint?: string;
}

export interface SetEmphasisWordsRequest {
    captionsUri: string;
    projectRootUri: string;
    upserts: EmphasisWord[];
    removeIds: string[];
}

export interface SetEmphasisWordsResult extends WriteBackResult {
    changed: number;
    beforeSource: string;
    ids: string[];
}

/**
 * edit.json（と必要なら captions.json）全文スナップショットの atomic 書き戻し。
 * editSource / captionsSource の少なくとも一方は必須。両方渡すと連続保存した最新の組を
 * 保存後 debounce で 1 回 lint する。この RPC は git commit しない
 * （置き換え元の FileService 直書きが commit していなかった挙動を維持）。
 */
export interface WriteEditSnapshotRequest {
    editUri: string;
    projectRootUri: string;
    editSource?: string;
    captionsUri?: string;
    captionsSource?: string;
}

export interface EditHistoryEntry {
    id: string;
    label: string;
    at: string;
    files: string[];
    sha256: Record<string, string>;
    legacy?: boolean;
    bytes?: number;
}

export interface EditHistoryProjectRequest {
    projectRootUri: string;
}

export interface RestoreEditHistoryRequest extends EditHistoryProjectRequest {
    id: string;
}

export interface EditMigrationProposal {
    filePath: string;
    version: 0 | 1;
    changes: Array<{ path: string; note: string }>;
    warnings: string[];
    nextText: string;
    previousText: string;
    backupPath: string;
}

export type EditMigrationPlanResult = EditMigrationProposal | {
    ok: false;
    version: number;
    blockers: string[];
};

export interface EditMigrationRequest {
    editUri: string;
    projectRootUri: string;
}

export interface DeferredLintNotification {
    projectRootUri: string;
    pass: boolean;
    errors: string[];
    writtenFiles?: string[];
    findings: Array<{
        severity?: string;
        message?: string;
        check?: string;
        path?: string;
    }>;
}

export interface AkariAnnotationsClient {
    /** backend の atomic rename より前に通知し、自己書き込み由来 watcher を抑止する。 */
    onWillWrite(uri: string): void;
    /**
     * backend の atomic rename が完了した「直後」に、書けた全文つきで通知する。
     * onWillWrite の対。プレビュー拡張が file watcher の通知を待たずに差分判定へ入るための口で、
     * content が載っているぶん受け側は edit.json の再読込 I/O も省ける。
     */
    onDidWrite(uri: string, content: string): void;
    /** 保存後 debounce lint の最新結果。 */
    onLintResult(notification: DeferredLintNotification): void;
}

export interface DeleteArrayItemResult extends WriteBackResult {
    /** 削除した cuts 要素の原文（undo で insertCut に渡す） */
    removedText: string;
}

export type DeleteCutResult = DeleteArrayItemResult;

export interface RemoveLayerResult extends DeleteArrayItemResult {
    layerIndex: number;
}

export interface RemoveSfxResult extends DeleteArrayItemResult {
    sfxIndex: number;
}

export interface AkariAnnotationsService {
    listNarrationEngines(projectRootUri: string, irodoriUrl?: string): Promise<NarrationEnginesResult>;
    listNarrationVoices(projectRootUri: string, engine: string, irodoriUrl?: string): Promise<NarrationVoicesResult>;
    generateNarration(request: GenerateNarrationRequest): Promise<GenerateNarrationResult>;
    applyNarration(request: ApplyNarrationRequest): Promise<{ id: string }>;
    applyNarrations(request: ApplyNarrationsRequest): Promise<{ ids: string[] }>;
    cancelNarration(projectRootUri: string): Promise<void>;
    projectReferenceMediaUris(request: { projectRootUri: string; declaredPaths?: string[] }): Promise<Record<string, string>>;
    setClient(client: AkariAnnotationsClient | undefined): void;
    extractSourceFrame(request: ExtractSourceFrameRequest): Promise<ExtractSourceFrameResult>;
    getClipThumbnail(request: GetClipThumbnailRequest): Promise<GetClipThumbnailResult>;
    readGenerationSidecars(request: ReadGenerationSidecarsRequest): Promise<ReadGenerationSidecarsResult>;
    readGenerationCatalog(): Promise<ReadGenerationCatalogResult>;
    readGenerationDefaults(request: { projectRootUri: string }): Promise<ReadGenerationDefaultsResult>;
    createEmptyGenerationFrame(request: { projectRootUri: string; durationSeconds: number }): Promise<{
        relativePath: string; sha256: string; width: number; height: number; renderer: string;
    }>;
    validateGenerationInputs(request: ValidateGenerationInputsRequest): Promise<GenerationValidationResult>;
    writeGenerationDraft(request: WriteGenerationDraftRequest): Promise<{ ok: true; path: string }>;
    startGenerateVideo(request: StartGenerateVideoRequest): Promise<GenerationProcessResult>;
    resumeGenerateVideo(request: GenerationProcessRequest): Promise<GenerationProcessResult>;
    cancelGenerateVideo(request: GenerationProcessRequest): Promise<GenerationProcessResult>;
    probeImageRoutes(): Promise<ImageRouteState[]>;
    startGenerateStill(request: StartGenerateStillRequest): Promise<GenerateStillResult>;
    cancelGenerateStill(request: GenerationProcessRequest): Promise<void>;
    getClipFilmstripChunk(request: GetClipFilmstripChunkRequest): Promise<GetClipFilmstripChunkResult>;
    getClipWaveform(request: GetClipWaveformRequest): Promise<GetClipWaveformResult>;
    getClipSilences(request: GetClipSilencesRequest): Promise<GetClipSilencesResult>;
    getAudioDuration(request: GetAudioDurationRequest): Promise<GetAudioDurationResult>;
    probeSourceDimensions(request: ProbeSourceDimensionsRequest): Promise<ProbeSourceDimensionsResult>;
    probeSourceHasAudio(request: ProbeSourceHasAudioRequest): Promise<ProbeSourceHasAudioResult>;
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
    resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }>;
    deleteAnnotation(request: DeleteAnnotationRequest): Promise<DeleteAnnotationResult>;
    restoreAnnotation(request: RestoreAnnotationRequest): Promise<RestoreAnnotationResult>;
    saveCanvas(request: SaveCanvasRequest): Promise<SaveCanvasResult>;
    trimCut(request: TrimCutRequest): Promise<WriteBackResult>;
    slipCut(request: SlipCutRequest): Promise<WriteBackResult>;
    reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult>;
    moveCut(request: MoveCutRequest): Promise<MoveCutResult>;
    setCutAtValues(request: SetCutAtValuesRequest): Promise<WriteBackResult>;
    shiftCaption(request: ShiftCaptionRequest): Promise<WriteBackResult>;
    setCaptionTiming(request: SetCaptionTimingRequest): Promise<WriteBackResult>;
    insertCaption(request: InsertCaptionRequest): Promise<WriteBackResult>;
    removeCaption(request: RemoveCaptionRequest): Promise<WriteBackResult>;
    splitCaption(request: SplitCaptionRequest): Promise<WriteBackResult>;
    mergeCaptions(request: MergeCaptionsRequest): Promise<WriteBackResult>;
    moveOverlay(request: MoveOverlayRequest): Promise<WriteBackResult>;
    resizeOverlay(request: ResizeOverlayRequest): Promise<WriteBackResult>;
    splitCut(request: SplitCutRequest): Promise<WriteBackResult>;
    deleteCut(request: DeleteCutRequest): Promise<DeleteCutResult>;
    insertCut(request: InsertCutRequest): Promise<WriteBackResult>;
    applyCutRanges(request: ApplyCutRangesRequest): Promise<ApplyCutRangesResult>;
    insertOverlay(request: InsertOverlayRequest): Promise<WriteBackResult>;
    removeOverlay(request: RemoveOverlayRequest): Promise<WriteBackResult>;
    moveLayer(request: MoveLayerRequest): Promise<WriteBackResult>;
    removeLayer(request: RemoveLayerRequest): Promise<RemoveLayerResult>;
    insertLayer(request: InsertLayerRequest): Promise<WriteBackResult>;
    moveSfx(request: MoveSfxRequest): Promise<WriteBackResult>;
    trimSfx(request: TrimSfxRequest): Promise<WriteBackResult>;
    removeSfx(request: RemoveSfxRequest): Promise<RemoveSfxResult>;
    insertSfx(request: InsertSfxRequest): Promise<WriteBackResult>;
    setCutSpeed(request: SetCutSpeedRequest): Promise<WriteBackResult>;
    setCutTransform(request: SetCutTransformRequest): Promise<WriteBackResult>;
    setCutOpacity(request: SetCutOpacityRequest): Promise<WriteBackResult>;
    setCutTransitionOut(request: SetCutTransitionOutRequest): Promise<WriteBackResult>;
    setLayerTransform(request: SetLayerTransformRequest): Promise<WriteBackResult>;
    setLayerOpacity(request: SetLayerOpacityRequest): Promise<WriteBackResult>;
    setLayerBlend(request: SetLayerBlendRequest): Promise<WriteBackResult>;
    setSfxGain(request: SetSfxGainRequest): Promise<WriteBackResult>;
    setSfxFade(request: SetSfxFadeRequest): Promise<WriteBackResult>;
    setBgmFields(request: SetBgmFieldsRequest): Promise<WriteBackResult>;
    setOverlayVar(request: SetOverlayVarRequest): Promise<WriteBackResult>;
    setCaptionFields(request: SetCaptionFieldsRequest): Promise<WriteBackResult>;
    setCaptionTextStyle(request: SetCaptionTextStyleRequest): Promise<WriteBackResult>;
    setCaptionStylePreset(request: SetCaptionStylePresetRequest): Promise<SetCaptionStylePresetResult>;
    setCaptionDisplayPolicy(request: SetCaptionDisplayPolicyRequest): Promise<SetCaptionDisplayPolicyResult>;
    setEmphasisWords(request: SetEmphasisWordsRequest): Promise<SetEmphasisWordsResult>;
    writeEditSnapshot(request: WriteEditSnapshotRequest): Promise<WriteBackResult>;
    snapshotEditHistory(request: EditHistoryProjectRequest & { label: string }): Promise<EditHistoryEntry | null>;
    listEditHistory(request: EditHistoryProjectRequest): Promise<EditHistoryEntry[]>;
    restoreEditHistory(request: RestoreEditHistoryRequest): Promise<{ restored: EditHistoryEntry; snapshot: EditHistoryEntry | null }>;
    planEditMigration(request: EditMigrationRequest): Promise<EditMigrationPlanResult>;
    applyEditMigration(proposal: EditMigrationProposal): Promise<void>;
    revertEditMigration(proposal: EditMigrationProposal): Promise<void>;
}

export type AudioEnvelopeKeyframePayload = EditAudioKeyframe;

export type NormalizedAudioEnvelopeKeyframePayload = Omit<EditAudioKeyframe, 'gain_db' | 'easing'> & {
    gain_db: number;
    easing?: string;
};

export type AudioEnvelopeWriteRequest =
    | { kind: 'bgm-duck-db'; value: number | null }
    | { kind: 'bgm-duck-attack'; value: number | null }
    | { kind: 'bgm-duck-release'; value: number | null }
    | { kind: 'sfx-ducking'; id: string; value: boolean | null }
    | { kind: 'sfx-duck-db'; id: string; value: number | null }
    | { kind: 'sfx-duck-attack'; id: string; value: number | null }
    | { kind: 'sfx-duck-release'; id: string; value: number | null }
    | {
        kind: 'audio-keyframes';
        id: string;
        audioKind: 'bgm' | 'sfx' | 'narration';
        value: AudioEnvelopeKeyframePayload[] | null;
    };

export interface SetAudioDuckRequest {
    editUri: string;
    projectRootUri: string;
    target: { kind: 'bgm' } | { kind: 'sfx'; index: number };
    updates: {
        ducking?: boolean | null;
        duckDb?: number | null;
        duckAttack?: number | null;
        duckRelease?: number | null;
    };
}

export interface SetAudioKeyframesRequest {
    editUri: string;
    projectRootUri: string;
    target: { kind: 'bgm' } | { kind: 'sfx' | 'narration'; index: number };
    keyframes: NormalizedAudioEnvelopeKeyframePayload[] | null;
}

export interface AkariAnnotationsService {
    setAudioDuck(request: SetAudioDuckRequest): Promise<WriteBackResult>;
    setAudioKeyframes(request: SetAudioKeyframesRequest): Promise<WriteBackResult>;
}

export interface MeasureAudioForLevelRequest {
    projectRoot: string;
    audioPath: string;
    role?: string;
    collection?: 'bgm' | 'sfx' | 'narration';
    durationSec?: number;
}

export type MeasureAudioForLevelResult = {
    ok: true;
    measured: Record<string, unknown>;
    role: string;
    gain_db: number;
    fade_in: number;
    fade_out: number;
    basis: string;
} | {
    ok: false;
    reason: string;
};

export interface AkariAnnotationsService {
    measureAudioForLevel(request: MeasureAudioForLevelRequest): Promise<MeasureAudioForLevelResult>;
}

export interface ListAdjustLutsRequest { projectRootUri: string; }
export interface ListAdjustLutsResult { refs: string[]; }
export interface ImportAdjustLutRequest { projectRootUri: string; sourcePath: string; }
export interface ImportAdjustLutResult { ref: string; }
export interface AkariAnnotationsService {
    listAdjustLuts(request: ListAdjustLutsRequest): Promise<ListAdjustLutsResult>;
    importAdjustLut(request: ImportAdjustLutRequest): Promise<ImportAdjustLutResult>;
}
