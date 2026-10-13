import { type CaptionRun } from './caption-runs';
import type { TimelineMapResult } from './timeline-map';
import type { EditCut } from './edit-store';
export interface CaptionSemanticDiagnostic {
    code: string;
    severity: 'error' | 'warning' | 'info';
    path: string;
    message: string;
    layer: 'document' | 'project' | 'path';
}
export interface CaptionSemanticsContext {
    captions: {
        captions?: Array<Record<string, unknown>>;
        unresolved_runs?: Array<{
            run?: CaptionRun;
        }>;
    } | Array<Record<string, unknown>> | null;
    edit?: {
        cuts?: EditCut[];
        sources?: Array<{
            id: string;
        }>;
    };
    timeline?: TimelineMapResult | readonly EditCut[];
    path?: 'preview' | 'render-cut' | 'osr' | 'gpu';
    gpuMotionIds?: ReadonlySet<string>;
    assetHashes?: Readonly<Record<string, string | undefined>>;
}
export declare function validateCaptionsSemantics(ctx: CaptionSemanticsContext): CaptionSemanticDiagnostic[];
export declare function renderableCaptionRuns(caption: {
    text: string;
    display_text?: string;
    runs?: CaptionRun[];
}, document: CaptionSemanticsContext['captions']): CaptionRun[];
