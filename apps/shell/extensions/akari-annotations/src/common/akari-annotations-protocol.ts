export const AKARI_ANNOTATIONS_SERVICE_PATH = '/services/akari-annotations';
export const AkariAnnotationsService = Symbol('AkariAnnotationsService');

export interface AnnotationResponse {
    summary: string;
    action: 'edited' | 'declined';
    respondedAt: string;
}

export interface Annotation {
    id: string;
    createdAt: string;
    sourceT: number;
    sourceRange: [number, number] | null;
    timelineT: number | null;
    target: string | null;
    text: string;
    input: 'typed' | 'voice';
    audio: string | null;
    strokes: null;
    poses: null;
    status: 'open' | 'addressed' | 'resolved';
    response: AnnotationResponse | null;
}

export interface CreateAnnotationRequest {
    reviewUri: string;
    projectRootUri: string;
    sourceT: number;
    timelineT: number | null;
    target: string | null;
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
}

export interface ResizeOverlayRequest {
    editUri: string;
    projectRootUri: string;
    overlayId: string;
    duration: number;
}

export interface WriteBackResult {
    committed: boolean;
}

export interface AkariAnnotationsService {
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
    resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }>;
    trimCut(request: TrimCutRequest): Promise<WriteBackResult>;
    reorderCuts(request: ReorderCutsRequest): Promise<WriteBackResult>;
    shiftCaption(request: ShiftCaptionRequest): Promise<WriteBackResult>;
    moveOverlay(request: MoveOverlayRequest): Promise<WriteBackResult>;
    resizeOverlay(request: ResizeOverlayRequest): Promise<WriteBackResult>;
}
