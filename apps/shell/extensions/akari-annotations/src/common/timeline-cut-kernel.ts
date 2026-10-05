import { closeGapAt, compactTrackGaps, extractRange, liftRange, rippleDeleteItems,
    rippleTrimToPlayhead, splitAtFrame, type EditV2, type RippleResult } from '@akari-video/edit-store';

export type TimelineCutCommand =
    | { kind: 'split'; frame: number; itemIds?: readonly string[]; lockedTrackIds: readonly string[] }
    | { kind: 'range'; range: { start: number; end: number }; ripple: boolean; lockedTrackIds: readonly string[] }
    | { kind: 'gap'; trackId: string; frame: number; lockedTrackIds: readonly string[] }
    | { kind: 'items'; itemIds: readonly string[]; oneSide: boolean; lockedTrackIds: readonly string[] }
    | { kind: 'trim'; frame: number; side: 'prev' | 'next'; lockedTrackIds: readonly string[] }
    | { kind: 'compact'; fromItemId?: string; lockedTrackIds: readonly string[] };

export const timelineCutKernel = { splitAtFrame, liftRange, extractRange, closeGapAt,
    rippleDeleteItems, rippleTrimToPlayhead, compactTrackGaps };

export function runTimelineCutKernel(edit: EditV2, command: TimelineCutCommand,
    kernel: typeof timelineCutKernel = timelineCutKernel): RippleResult {
    const lockedTrackIds = command.lockedTrackIds;
    switch (command.kind) {
        case 'split': return kernel.splitAtFrame(edit, command.frame,
            { lockedTrackIds, ...(command.itemIds ? { itemIds: command.itemIds } : {}) });
        case 'range': return command.ripple
            ? kernel.extractRange(edit, command.range, { lockedTrackIds })
            : kernel.liftRange(edit, command.range, { lockedTrackIds });
        case 'gap': return kernel.closeGapAt(edit, command.trackId, command.frame, { lockedTrackIds });
        case 'items': return kernel.rippleDeleteItems(edit, command.itemIds,
            { lockedTrackIds, oneSide: command.oneSide });
        case 'trim': return kernel.rippleTrimToPlayhead(edit, command.frame, command.side, { lockedTrackIds });
        case 'compact': return kernel.compactTrackGaps(edit,
            { lockedTrackIds, ...(command.fromItemId ? { fromItemId: command.fromItemId } : {}) });
    }
}
