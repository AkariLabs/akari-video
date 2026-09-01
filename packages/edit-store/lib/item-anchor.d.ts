import type { EditV2, ItemV2 } from './edit-v2';
import { type TimelineSegment } from './timeline-map';
export type AnchorCaption = {
    id: string;
    start: number;
    end: number;
    timeDomain?: 'source' | 'output';
};
export type ItemAnchorV2 = NonNullable<ItemV2['anchor']>;
export type ItemAnchorWarningReason = 'caption-not-found' | 'removed-range' | 'no-source-segments' | 'unsupported-kind';
export type ItemAnchorResolution = {
    at: number;
    duration: number;
} | {
    unresolvable: ItemAnchorWarningReason;
};
export interface ItemAnchorChange {
    id: string;
    before: {
        at: number;
        duration: number;
    };
    after: {
        at: number;
        duration: number;
    };
}
export interface ItemAnchorWarning {
    id: string;
    reason: ItemAnchorWarningReason;
}
type AnchoredItem = Pick<ItemV2, 'at' | 'duration'> & {
    anchor: ItemAnchorV2;
};
export declare function resolveItemAnchor(item: AnchoredItem, context: {
    caption: AnchorCaption;
    segments: readonly TimelineSegment[];
    fps: number;
    parentAtFrames: number;
}): ItemAnchorResolution;
/**
 * anchor を理解しない既存の v2 reader へ、解決キャッシュだけを渡すための射影。
 * anchor が無い入力は同じ参照を返す。
 */
export declare function withoutItemAnchors<T>(edit: T): T;
export declare function resolveItemAnchors(edit: EditV2, captions: readonly AnchorCaption[], options?: {
    fps?: number;
}): {
    edit: EditV2;
    changes: ItemAnchorChange[];
    warnings: ItemAnchorWarning[];
};
export {};
