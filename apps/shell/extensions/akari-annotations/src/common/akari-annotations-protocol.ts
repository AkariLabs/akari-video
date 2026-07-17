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

export interface AkariAnnotationsService {
    createAnnotation(request: CreateAnnotationRequest): Promise<CreateAnnotationResult>;
    resolveAnnotation(request: ResolveAnnotationRequest): Promise<{ annotation: Annotation }>;
}
