import { EditTimelineTrack } from './edit-store';
export declare function isVisualMediaTrack(track: EditTimelineTrack): boolean;
/** Share row references without converting media types or dropping native/unknown properties. */
export declare function moveVisualItemInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], item: {
    kind: 'cut';
    index: number;
} | {
    kind: 'layer';
    id: string;
}, targetId: string, time: number): string;
/** Insert an empty shared row using a globally unused visual ref; never shift native streams independently. */
export declare function createVisualTrackInSource(source: string, fallbackTracks: readonly EditTimelineTrack[], aboveId?: string): {
    source: string;
    track: EditTimelineTrack;
};
