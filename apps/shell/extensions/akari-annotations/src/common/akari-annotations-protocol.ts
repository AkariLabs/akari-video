export const AKARI_ANNOTATIONS_SERVICE_PATH = '/services/akari-annotations';
export const AkariAnnotationsService = Symbol('AkariAnnotationsService');

export type MediaUnavailableReason = 'ffmpeg-not-found' | 'source-missing' | 'extraction-failed';

export const THUMBNAIL_WIDTH_PX = 160;
export const WAVEFORM_BUCKET_COUNT = 200;

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

export interface GetClipWaveformRequest {
    projectRootUri: string;
    videoUri: string;
    startSeconds: number;
    endSeconds: number;
}

export interface GetClipWaveformResult {
    status: 'ready' | 'unavailable';
    peaks?: number[];
    reason?: MediaUnavailableReason;
}

export interface GetAudioDurationRequest {
    projectRootUri: string;
    audioUri: string;
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
    sourceT: number;
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

export interface TrimCutRequest {
    editUri: string;
    projectRootUri: string;
    cutIndex: number;
    in: number;
    out: number;
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

export interface CaptionWritePayload {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
}

export interface InsertCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    caption: CaptionWritePayload;
}

export interface RemoveCaptionRequest {
    captionsUri: string;
    projectRootUri: string;
    captionId: string;
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
}

export interface WriteBackResult {
    committed: boolean;
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
    getClipThumbnail(request: GetClipThumbnailRequest): Promise<GetClipThumbnailResult>;
    getClipWaveform(request: GetClipWaveformRequest): Promise<GetClipWaveformResult>;
    getAudioDuration(request: GetAudioDurationRequest): Promise<GetAudioDurationResult>;
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
    resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }>;
    trimCut(request: TrimCutRequest): Promise<WriteBackResult>;
    reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult>;
    moveCut(request: MoveCutRequest): Promise<WriteBackResult>;
    setCutAtValues(request: SetCutAtValuesRequest): Promise<WriteBackResult>;
    shiftCaption(request: ShiftCaptionRequest): Promise<WriteBackResult>;
    insertCaption(request: InsertCaptionRequest): Promise<WriteBackResult>;
    removeCaption(request: RemoveCaptionRequest): Promise<WriteBackResult>;
    moveOverlay(request: MoveOverlayRequest): Promise<WriteBackResult>;
    resizeOverlay(request: ResizeOverlayRequest): Promise<WriteBackResult>;
    splitCut(request: SplitCutRequest): Promise<WriteBackResult>;
    deleteCut(request: DeleteCutRequest): Promise<DeleteCutResult>;
    insertCut(request: InsertCutRequest): Promise<WriteBackResult>;
    insertOverlay(request: InsertOverlayRequest): Promise<WriteBackResult>;
    removeOverlay(request: RemoveOverlayRequest): Promise<WriteBackResult>;
    moveLayer(request: MoveLayerRequest): Promise<WriteBackResult>;
    removeLayer(request: RemoveLayerRequest): Promise<RemoveLayerResult>;
    insertLayer(request: InsertLayerRequest): Promise<WriteBackResult>;
    moveSfx(request: MoveSfxRequest): Promise<WriteBackResult>;
    removeSfx(request: RemoveSfxRequest): Promise<RemoveSfxResult>;
    insertSfx(request: InsertSfxRequest): Promise<WriteBackResult>;
    setCutSpeed(request: SetCutSpeedRequest): Promise<WriteBackResult>;
    setLayerTransform(request: SetLayerTransformRequest): Promise<WriteBackResult>;
    setLayerOpacity(request: SetLayerOpacityRequest): Promise<WriteBackResult>;
    setLayerBlend(request: SetLayerBlendRequest): Promise<WriteBackResult>;
    setSfxGain(request: SetSfxGainRequest): Promise<WriteBackResult>;
    setBgmFields(request: SetBgmFieldsRequest): Promise<WriteBackResult>;
    setOverlayVar(request: SetOverlayVarRequest): Promise<WriteBackResult>;
    setCaptionFields(request: SetCaptionFieldsRequest): Promise<WriteBackResult>;
}
