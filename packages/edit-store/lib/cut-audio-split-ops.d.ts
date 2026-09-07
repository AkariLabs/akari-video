import type { EditV2 } from './edit-v2';
/** Serialized v2 document; editing does not require a Project instance. */
export type EditV2Document = EditV2;
export type CutAudioSplitBlocker = 'not-found' | 'not-visual-media' | 'nested' | 'anchored' | 'speed' | 'freeze' | 'transition-crossfade' | 'already-split' | 'no-audio';
export declare function canSplitCutAudio(doc: EditV2Document, cutId: string, options?: {
    hasAudio?: boolean;
}): {
    ok: true;
} | {
    ok: false;
    blocker: CutAudioSplitBlocker;
    message: string;
};
export declare function splitCutAudio(doc: EditV2Document, options: {
    cutId: string;
    hasAudio?: boolean;
}): {
    document: EditV2Document;
    audioItemId: string;
    audioTrackId: string;
    createdTrack: boolean;
};
export declare function linkedAudioItemIdOf(doc: EditV2Document, cutId: string): string | undefined;
export declare function linkedCutIdOf(doc: EditV2Document, audioItemId: string): string | undefined;
export declare function unlinkCutAudio(doc: EditV2Document, options: {
    audioItemId: string;
}): EditV2Document;
export declare function moveLinkedCutAudio(doc: EditV2Document, options: {
    cutId: string;
    deltaFrames: number;
}): EditV2Document;
export declare function removeCutAudioLinked(doc: EditV2Document, options: {
    target: 'pair' | 'audio-only' | 'cut-only';
    cutId?: string;
    audioItemId?: string;
}): EditV2Document;
