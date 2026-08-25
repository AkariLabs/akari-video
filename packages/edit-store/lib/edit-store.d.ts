import { type TransitionHandleExtensionPlan } from './cut-adjacency';
export interface EditCut {
    in: number;
    out: number;
    src?: string;
    transform?: {
        x?: number;
        y?: number;
        scale?: number;
        rotate?: number;
    };
    opacity?: number;
    speed?: number;
    transitionOut?: {
        type: 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up';
        duration: number;
    };
    at?: number;
    track?: number;
}
export interface EditSource {
    id: string;
    path: string;
    proxy: string | null;
}
export interface EditBeat {
    id: string;
    src?: string;
    t: number;
    kind: string;
    strength: number;
    basis?: string;
}
export interface EditOverlay {
    id: string;
    start: number;
    duration: number;
    track: number;
    payload: Record<string, unknown>;
}
export type LayerBlendMode = 'normal' | 'screen' | 'multiply' | 'add' | 'difference' | 'darken' | 'lighten' | 'overlay' | 'hardlight' | 'softlight';
export interface EditLayer {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src: string;
    track?: number;
    preset?: string;
    transform?: {
        x?: number;
        y?: number;
        scale?: number;
        rotate?: number;
    };
    opacity?: number;
    blend?: LayerBlendMode;
    chromaKey?: {
        color: string;
        similarity?: number;
        blend?: number;
    };
}
export interface EditAudioSfx {
    id: string;
    t: number;
    duration: number;
    path: string;
    track?: number;
    gainDb?: number;
    in?: number;
    out?: number;
}
export interface EditAudioNarrationProvenance {
    provider: string;
    engine?: string;
    voice?: string;
    credit?: string;
    generated_at?: string;
    [key: string]: unknown;
}
/** audio.narration[] の legacy 投影形。 */
export interface EditAudioNarration {
    id: string;
    t: number;
    path: string;
    track?: number;
    gainDb?: number;
    script?: string;
    reading?: string;
    provenance?: EditAudioNarrationProvenance;
}
export interface CutTrackSegment {
    index: number;
    track: number;
    at: number;
    duration: number;
    end: number;
}
export interface EditAudioBgm {
    id: 'bgm';
    path: string;
    track?: number;
    fadeIn?: number;
    fadeOut?: number;
    gainDb?: number;
    ducking?: boolean;
}
export type TimelineTrackKind = 'cuts' | 'layers' | 'overlays' | 'captions' | 'audio';
export interface EditTimelineTrack {
    id: string;
    kind: TimelineTrackKind;
    ref?: number;
    label?: string;
    muted?: boolean;
    hidden?: boolean;
    locked?: boolean;
}
export interface SourceElement {
    text: string;
    start: number;
    end: number;
}
export declare function findMatchingBracket(source: string, openIndex: number): number;
export declare function splitTopLevelElements(innerText: string): SourceElement[];
export declare function computeCutTrackSegments(cuts: readonly EditCut[]): CutTrackSegment[];
export declare function trimCutInSource(source: string, cutIndex: number, nextIn: number, nextOut: number, maxOutSeconds?: number): string;
/**
 * ソーストリマーの slip 操作: out−in（尺）と t（タイムライン位置）を固定したまま
 * in/out を同量シフトする。trimCutInSource と異なり尺そのものは変化しないため、
 * at の再計算・freezeNextImplicitCutAt（暗黙 at の凍結）は不要
 * （後続クリップのタイムライン位置に一切影響しない）。
 */
export declare function slipCutInSource(source: string, cutIndex: number, nextIn: number, nextOut: number, maxOutSeconds?: number): string;
export declare function setCutSpeedInSource(source: string, cutIndex: number, speed: number | null): string;
export declare function updateCutTransformInSource(source: string, cutIndex: number, updates: {
    x?: number | null;
    y?: number | null;
    scale?: number | null;
    rotate?: number | null;
}): string;
export declare function updateCutOpacityInSource(source: string, cutIndex: number, opacity: number | null): string;
export declare function setCutTransitionOutInSource(source: string, cutIndex: number, transitionOut: {
    type: 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up';
    duration: number;
} | null): string;
export interface SetV2TransitionOutWithHandleInput {
    itemId: string;
    transitionOut: {
        type: 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up';
        duration: number;
    };
    earlierEndSeconds: number;
    laterStartSeconds: number;
    maxExtendSeconds: number;
    fps: number;
}
export interface SetV2TransitionOutWithHandleResult {
    source: string;
    plan: TransitionHandleExtensionPlan;
}
/**
 * v2 の transition_out 宣言と outgoing の source.out / duration 延長を 1 回の
 * byte-preserving 手術で行う。maxExtendSeconds は出力秒軸の上限で、素材実尺は呼び出し側が決める。
 */
export declare function setV2TransitionOutWithHandleInSource(source: string, input: SetV2TransitionOutWithHandleInput): SetV2TransitionOutWithHandleResult;
export declare function reorderCutsInSource(source: string, fromIndex: number, toIndex: number): string;
export declare function splitCutInSource(source: string, cutIndex: number, atSeconds: number): string;
export declare function deleteCutInSource(source: string, cutIndex: number): {
    source: string;
    removedText: string;
};
export declare function insertCutInSource(source: string, cutIndex: number, elementText: string): string;
export declare function deleteLayerByIdInSource(source: string, layerId: string): {
    source: string;
    removedText: string;
    layerIndex: number;
};
export declare function deleteLayerInSource(source: string, layerIndex: number): {
    source: string;
    removedText: string;
};
export declare function insertLayerInSource(source: string, layerIndex: number, elementText: string): string;
export declare function deleteSfxInSource(source: string, sfxIndex: number): {
    source: string;
    removedText: string;
};
export declare function insertSfxInSource(source: string, sfxIndex: number, elementText: string): string;
export declare function moveCutInSource(source: string, cutIndex: number, nextAt: number, nextTrack?: number | null, trackState?: Record<string, number | null>): string;
/**
 * クリップ移動と、移動で空になった宣言済み cuts トラックの除去を同じ候補全文へ畳む。
 * trackIds は UI が移動前の件数から特定したものだけを受け取り、他種別・使用中トラックは守る。
 */
export declare function moveCutAndPruneTracksInSource(source: string, cutIndex: number, nextAt: number, nextTrack?: number | null, trackState?: Record<string, number | null>, trackIds?: readonly string[]): {
    source: string;
    prunedTracks?: {
        before: EditTimelineTrack[];
        after: EditTimelineTrack[];
    };
};
export declare function setCutAtValuesInSource(source: string, entries: Array<{
    cutIndex: number;
    at: number | null;
}>): string;
export declare function updateLayerInSource(source: string, layerId: string, updates: {
    t?: number;
    duration?: number;
    track?: number;
}): string;
export declare function updateLayerTransformInSource(source: string, layerId: string, updates: {
    x?: number | null;
    y?: number | null;
    scale?: number | null;
    rotate?: number | null;
}): string;
export declare function updateLayerOpacityInSource(source: string, layerId: string, opacity: number | null): string;
export declare function updateLayerBlendInSource(source: string, layerId: string, blend: string | null): string;
export declare function moveLayerInSource(source: string, layerId: string, nextT: number, nextDuration: number, nextTrack?: number, trackState?: Record<string, number | null>): string;
export declare function moveSfxInSource(source: string, sfxIndex: number, nextT: number, nextTrack?: number, trackState?: Record<string, number | null>): string;
/**
 * SE の in/out（素材秒）を書き戻す。動画クリップのトリム（trimCutInSource）と同じ操作感に
 * 合わせ、左端ドラッグ（in の変更）は t も連動させる呼び出し側の責務で nextT を渡す。
 * null は「フィールドを削除して省略時意味論（in=0 / out=素材末尾）へ戻す」（undo 用）。
 */
export declare function trimSfxInSource(source: string, sfxIndex: number, nextIn: number | null, nextOut: number | null, nextT?: number): string;
export declare function setSfxGainDbInSource(source: string, sfxIndex: number, gainDb: number | null): string;
export declare function updateBgmInSource(source: string, updates: {
    gainDb?: number | null;
    fadeIn?: number | null;
    fadeOut?: number | null;
    ducking?: boolean | null;
}): string;
export declare function moveOverlayInSource(source: string, overlayId: string, nextStart: number, nextTrack?: number | null, trackState?: Record<string, number | null>): string;
export declare function resizeOverlayInSource(source: string, overlayId: string, nextDuration: number): string;
export declare function insertOverlayInSource(source: string, overlay: Record<string, unknown>): string;
export declare function removeOverlayInSource(source: string, overlayId: string): string;
export declare function writeTimelineTracksInSource(source: string, tracks: EditTimelineTrack[]): string;
export declare function updateArrayElementByIndex(source: string, key: string, index: number, label: string, update: (element: string) => string): string;
export declare function updateOverlayVarInSource(source: string, overlayId: string, varName: string, nextValue: string): string;
