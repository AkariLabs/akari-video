export interface ChipHitAreaEntry {
    group: string;
    leftPercent: number;
    widthPercent: number;
}

export interface ChipHitPadding {
    padLeftPx: number;
    padRightPx: number;
}

export interface ChipHitPaddingOptions {
    containerWidthPx: number;
    minHitWidthPx: number;
}

export type TimelineEdgeMode = 'start' | 'move' | 'end';

/**
 * 同一レーン・同一サブ行の隣接チップを中点で分け、実 DOM 幅を変えずに左右の当たり領域を計画する。
 * 戻り値の並びは entries と同じ。
 */
export function planChipHitPadding(
    entries: readonly ChipHitAreaEntry[],
    options: ChipHitPaddingOptions
): ChipHitPadding[] {
    const widthScale = Math.max(0, options.containerWidthPx) / 100;
    const plans = entries.map(() => ({ padLeftPx: 0, padRightPx: 0 }));
    if (!(widthScale > 0) || !(options.minHitWidthPx > 0)) {
        return plans;
    }
    const groups = new Map<string, number[]>();
    entries.forEach((entry, index) => {
        const indexes = groups.get(entry.group) ?? [];
        indexes.push(index);
        groups.set(entry.group, indexes);
    });
    for (const indexes of groups.values()) {
        indexes.sort((left, right) => entries[left].leftPercent - entries[right].leftPercent || left - right);
        indexes.forEach((entryIndex, sortedIndex) => {
            const entry = entries[entryIndex];
            const leftPx = entry.leftPercent * widthScale;
            const widthPx = Math.max(0, entry.widthPercent * widthScale);
            const desiredPad = Math.max(0, (options.minHitWidthPx - widthPx) / 2);
            const previousIndex = indexes[sortedIndex - 1];
            const nextIndex = indexes[sortedIndex + 1];
            const previousGap = previousIndex === undefined
                ? Number.POSITIVE_INFINITY
                : leftPx - (entries[previousIndex].leftPercent + entries[previousIndex].widthPercent) * widthScale;
            const nextGap = nextIndex === undefined
                ? Number.POSITIVE_INFINITY
                : entries[nextIndex].leftPercent * widthScale - (leftPx + widthPx);
            plans[entryIndex] = {
                padLeftPx: Math.min(desiredPad, Math.max(0, previousGap) / 2),
                padRightPx: Math.min(desiredPad, Math.max(0, nextGap) / 2)
            };
        });
    }
    return plans;
}

/** 拡張したチップでは左右端と中央がすべて正幅になるよう、当たり幅を最大 3 等分する。 */
export function clipEdgeZonePx(
    rectWidthPx: number,
    expanded: boolean,
    defaultEdgeZonePx: number,
    minTrimHandleHitPx: number
): number {
    if (!expanded) {
        return defaultEdgeZonePx;
    }
    return Math.min(minTrimHandleHitPx, Math.max(0, Math.floor(rectWidthPx / 3)));
}

export function resolveTimelineEdgeMode(
    localXPx: number,
    rectWidthPx: number,
    edgeZonePx: number
): TimelineEdgeMode {
    const rightDistancePx = rectWidthPx - localXPx;
    if (localXPx <= edgeZonePx && localXPx <= rightDistancePx) {
        return 'start';
    }
    return rightDistancePx <= edgeZonePx ? 'end' : 'move';
}

export interface InitialVisualTrackScrollOptions {
    stripHeightPx: number;
    viewportHeightPx: number;
    laneTopPx: number;
    laneHeightPx: number;
    marginPx?: number;
}

/** 溢れたタイムラインで最初の visual トラックを完全表示できる初期 scrollTop を返す。 */
export function planInitialVisualTrackScroll(options: InitialVisualTrackScrollOptions): number | undefined {
    const { stripHeightPx, viewportHeightPx, laneTopPx, laneHeightPx } = options;
    if (!(viewportHeightPx > 0) || stripHeightPx <= viewportHeightPx) {
        return undefined;
    }
    const maxScroll = Math.max(0, stripHeightPx - viewportHeightPx);
    const margin = Math.max(0, options.marginPx ?? 8);
    const usableTopMargin = laneHeightPx > viewportHeightPx
        ? 0
        : Math.min(margin, Math.max(0, viewportHeightPx - laneHeightPx));
    return Math.min(maxScroll, Math.max(0, laneTopPx - usableTopMargin));
}
