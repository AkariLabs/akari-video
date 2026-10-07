import type { InkAspect, InkDocument } from './ink-model';

export const AKARI_ROUGH_CANVAS_SERVICE_PATH = '/services/akari-rough-canvas';
export const AkariRoughCanvasService = Symbol('AkariRoughCanvasService');

export interface RoughCanvasSubject {
    playhead: { outputT: number; src?: string; sourceT?: number; cutIndex?: number };
    selection: string[];
    doc: 'edit.json';
}
export interface RoughCanvasBackdrop {
    image: string;
    outputT: number;
    timelineId?: string;
    editSha256: string;
}
export interface SaveRoughCanvasMemoRequest {
    projectRootUri: string;
    id?: string;
    aspect: InkAspect;
    aspectSource: 'edit.json' | 'default';
    ink: InkDocument;
    paperPng: string;
    backdrop?: RoughCanvasBackdrop;
    memo?: string | null;
    subject: RoughCanvasSubject;
    speech?: { transcript: string; engine: 'typed'; openedRecT: number; span: [number, number] };
}
export interface RoughCanvasManifest {
    version: 0; id: string; createdAt: string; aspect: InkAspect;
    aspectSource: 'edit.json' | 'default'; background: null; audio: null;
    memo: string | null; status: 'recorded' | 'compiled'; compiledAnnotations: null;
    paper: { file: 'paper.png'; size: [number, number]; inkSha256: string };
    ink: 'ink.json';
    backdrop: { file: 'backdrop.png'; kind: 'preview-frame'; outputT: number;
        timelineId?: string; editSha256: string } | null;
    subject: RoughCanvasSubject; speech?: SaveRoughCanvasMemoRequest['speech'];
    exits: Array<{ kind: 'task' | 'send'; at: string }>;
    sealed: boolean;
}
export interface ReadRoughCanvasMemoResult {
    canvas: RoughCanvasManifest;
    ink: InkDocument;
    paperDataUrl?: string;
    backdropDataUrl?: string;
    warnings?: string[];
}
export interface AkariRoughCanvasService {
    saveMemo(request: SaveRoughCanvasMemoRequest): Promise<{ id: string | null }>;
    sealMemo(projectRootUri: string, id: string, exit: 'task' | 'send'): Promise<void>;
    readMemo(projectRootUri: string, id: string): Promise<ReadRoughCanvasMemoResult>;
    hashEdit(editUri: string): Promise<string>;
}
