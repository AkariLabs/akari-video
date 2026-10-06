import { type TimelineSegment } from './timeline-map';
import type { EditCut } from './edit-store';
import type { InternalEdit } from './internal-model';
type RawCaptionEdit = {
    output?: {
        fps?: number;
    };
    tracks: Array<{
        lane?: string;
        muted?: boolean;
        items?: Array<{
            at?: number;
            duration?: number;
            role?: string;
            mute?: boolean;
            link?: string;
            source?: {
                kind?: string;
                src?: string;
                in?: number;
                out?: number;
            };
        }>;
    }>;
};
/** Preserve visual projection and add voice ranges that visual cuts do not cover. */
export declare function buildCaptionTimelineSegments(cuts: readonly EditCut[], edit?: InternalEdit | RawCaptionEdit, options?: {
    fps?: number;
    trackZ?: (track: number) => number;
}): TimelineSegment[];
export {};
