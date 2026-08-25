// v2 の混在トラックでは (kind, ref) だけの行ホーミングが homeless / 誤ヒットになり得る。
// アイテムが属する track id を優先して蓋をし、legacyKindOfV2Track の分類は変更しない。

import type { TimelineTrackKind } from './edit-store';

export interface ItemRowLayoutCandidate {
    id?: string;
    kind?: TimelineTrackKind;
    track: number;
}

export function resolveItemRowLayout<T extends ItemRowLayoutCandidate>(
    layouts: readonly T[],
    itemTrackId: string | undefined,
    kind: TimelineTrackKind,
    ref: number
): T | undefined {
    if (itemTrackId !== undefined) {
        const itemTrackLayout = layouts.find(layout => layout.id === itemTrackId);
        if (itemTrackLayout) {
            return itemTrackLayout;
        }
    }
    return layouts.find(layout => layout.kind === kind && layout.track === ref);
}
