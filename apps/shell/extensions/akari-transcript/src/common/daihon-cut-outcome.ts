import { applyCutRanges, type CutRange } from '@akari-video/edit-store';

export interface DaihonCutOutcome {
    cutCount: number;
    refused: number;
    partial: boolean;
    syncVideoMissing: boolean;
}

/** Preview the same ranges against the source edit to classify changes without reading warning prose. */
export function assessCutOutcome(source: string, ranges: readonly CutRange[]): DaihonCutOutcome | undefined {
    let cutCount = 0;
    let refused = 0;
    let partial = false;
    let syncVideoMissing = false;
    try {
        for (const range of ranges) {
            const edit = JSON.parse(source) as { sync_groups?: Array<{ members?: Array<{ source?: string }> }> };
            const grouped = edit.sync_groups?.some(group => group.members?.some(member => member.source === range.captionId)) ?? false;
            const result = applyCutRanges(source, [range]);
            if (result.removedFrames > 0) {
                cutCount++;
                partial ||= result.warnings.length > 0;
            } else {
                refused++;
                syncVideoMissing ||= grouped;
            }
        }
    } catch {
        return undefined;
    }
    return { cutCount, refused, partial, syncVideoMissing };
}
