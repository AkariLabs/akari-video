import { type CaptionSemanticDiagnostic, type CaptionSemanticsContext } from './caption-semantics';
export declare const CAPTION_LOOK_SHAPE_ANIMATION_IDS: string[];
export declare const CAPTION_LOOK_SHAPE_KEYS: {
    run: string[];
    look: string[];
    anchor: string[];
    styleSources: string[];
    source: string[];
    unresolvedRun: string[];
};
/** v1 の追加項目だけを検査する。旧い行の他の項目と runs v0 の形は許す。 */
export declare function validateCaptionLookV1Shape(captionsRoot: unknown): CaptionSemanticDiagnostic[];
export declare class CaptionsInvalidError extends Error {
    readonly diagnostics: CaptionSemanticDiagnostic[];
    readonly code = "AKARI_CAPTIONS_INVALID";
    constructor(diagnostics: CaptionSemanticDiagnostic[]);
}
export declare function assertCaptionsWritable(captionsRoot: CaptionSemanticsContext['captions'], ctx?: Omit<CaptionSemanticsContext, 'captions'>): void;
