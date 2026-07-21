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

export interface WriteBackResult {
    committed: boolean;
}

export interface DeleteCutResult extends WriteBackResult {
    /** 削除した cuts 要素の原文（undo で insertCut に渡す） */
    removedText: string;
}

export interface AkariAnnotationsService {
    getClipThumbnail(request: GetClipThumbnailRequest): Promise<GetClipThumbnailResult>;
    getClipWaveform(request: GetClipWaveformRequest): Promise<GetClipWaveformResult>;
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
    resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }>;
    trimCut(request: TrimCutRequest): Promise<WriteBackResult>;
    reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult>;
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
}
