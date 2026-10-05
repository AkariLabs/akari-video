import type { AudioMediaItemV2, EditV2, ItemV2, TrackV2 } from './edit-v2';
export type RippleMode = 'cut' | 'shift' | 'fixed';
export interface FrameRange {
    start: number;
    end: number;
}
export interface RippleOptions {
    lockedTrackIds?: readonly string[];
    modeOverride?: Record<string, RippleMode>;
}
export interface RippleResult {
    edit: EditV2;
    changed: boolean;
    removedFrames?: number;
    blocked?: string[];
    reason?: string;
}
type TimelineItem = ItemV2 | AudioMediaItemV2;
export declare function resolveTrackRippleMode(track: TrackV2): RippleMode;
export declare function setTrackRippleMode(edit: EditV2, trackId: string, mode: RippleMode): EditV2;
/** Returns the retained piece of one item. The source clock is seconds; the item clock is frames. */
export declare function sliceTimelineItem<T extends TimelineItem>(item: T, start: number, end: number, fps: number, ids?: Set<string>): T;
/** Retained pieces after deleting one item's overlap with a frame interval. */
export declare function removeTimelineItemRange<T extends TimelineItem>(item: T, range: FrameRange, fps: number, ids: Set<string>): T[];
export declare function splitAtFrame(edit: EditV2, frame: number, opts?: RippleOptions & {
    itemIds?: readonly string[];
    trackIds?: readonly string[];
}): RippleResult;
export declare function liftRange(edit: EditV2, range: FrameRange, opts?: RippleOptions): RippleResult;
export declare function extractRange(edit: EditV2, range: FrameRange, opts?: RippleOptions): RippleResult;
export declare function rippleDeleteItems(edit: EditV2, itemIds: readonly string[], opts?: RippleOptions & {
    oneSide?: boolean;
}): RippleResult;
export declare function findGapAt(edit: EditV2, trackId: string, frame: number): FrameRange | undefined;
export declare function closeGapAt(edit: EditV2, trackId: string, frame: number, opts?: RippleOptions): RippleResult;
export declare function editPoints(edit: EditV2, opts?: RippleOptions): number[];
export declare function rippleTrimToPlayhead(edit: EditV2, frame: number, side: 'prev' | 'next', opts?: RippleOptions): RippleResult;
export declare function compactTrackGaps(edit: EditV2, opts?: RippleOptions & {
    fromItemId?: string;
    includeAnchored?: boolean;
}): RippleResult;
export {};
