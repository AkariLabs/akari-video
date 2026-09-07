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
    original: VisualInterval;
    targetId: string;
    time: number;
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
/** Shared by the drag ghost and the atomic write so placement cannot turn into stacking. */
export declare function planVisualMove(cuts: readonly EditCut[], layers: readonly EditLayer[], tracks: readonly EditTimelineTrack[], item: VisualItem, targetId: string, time: number): VisualMovePlan;
/** Share row references without converting media types or dropping native/unknown properties. */
export declare function moveVisualItemInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], item: VisualItem, targetId: string, time: number, forceShared?: boolean): string;
/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
export declare function createVisualTrackInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], aboveId?: string, belowId?: string): {
    source: string;
    track: EditTimelineTrack;
};
/** Empty visual rows are not persisted after an edit. Other domains keep their own data readers. */
export declare function pruneEmptyVisualTracksInSource(source: string): string;
export type VisualRowDrop = {
    kind: 'none';
} | {
    kind: 'track';
    id: string;
    top: number;
    height: number;
} | {
    kind: 'between';
    aboveId?: string;
    belowId?: string;
    top: number;
};
/** Legacy Akari OS model: row interiors are slots; boundaries insert occupied rows. */
export declare function resolveVisualRowDrop(rows: readonly {
    id: string;
    top: number;
    height: number;
}[], y: number, sourceId?: string, sourceItemCount?: number): VisualRowDrop;
/** Moving a row's sole clip reuses that row; it does not create a transient V3. */
export declare function insertVisualItemInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], item: VisualItem, time: number, aboveId?: string, belowId?: string): string;
