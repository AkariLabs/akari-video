import { EditTimelineTrack, EditCut, EditLayer } from './edit-store';
export declare function isVisualMediaTrack(track: EditTimelineTrack): boolean;
export type VisualItem = {
    kind: 'cut';
    index: number;
} | {
    kind: 'layer';
    id: string;
};
export interface VisualInterval {
    item: VisualItem;
    key: string;
    rowId: string;
    start: number;
    end: number;
}
export type VisualMovePlan = {
    accepted: false;
    reason: string;
} | {
    accepted: true;
    mode: 'move' | 'swap';
    original: VisualInterval;
    targetId: string;
    time: number;
    swap?: {
        interval: VisualInterval;
        rowId: string;
        time: number;
    };
};
export declare const visualIntervalsOverlap: (start: number, end: number, other: {
    start: number;
    end: number;
}) => boolean;
/** One visual row may contain consecutive media, but never simultaneous media. */
export declare function visualTrackIntervals(cuts: readonly EditCut[], layers: readonly EditLayer[], tracks: readonly EditTimelineTrack[]): VisualInterval[];
/** Same half-open collision rule as the legacy timeline's free-slot placement. */
export declare function findVisualFreeSlot(intervals: readonly {
    start: number;
    end: number;
}[], desired: number, duration: number): number;
/** Shared by the drag ghost and the atomic write so swapping cannot turn into stacking. */
export declare function planVisualMove(cuts: readonly EditCut[], layers: readonly EditLayer[], tracks: readonly EditTimelineTrack[], item: VisualItem, targetId: string, time: number): VisualMovePlan;
/** Share row references without converting media types or dropping native/unknown properties. */
export declare function moveVisualItemInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], item: VisualItem, targetId: string, time: number): string;
/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
export declare function createVisualTrackInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], aboveId?: string): {
    source: string;
    track: EditTimelineTrack;
};
