export interface TimelineTrackDropLayout {
    readonly id: string;
    readonly lane: 'visual' | 'audio';
    readonly acceptsItems: boolean;
    /** edit.json tracks[] 上の位置。配列順が z の唯一の権威。 */
    readonly rawIndex: number;
    /** UI の互換表示番号。書き込み先は id / rawIndex で決める。 */
    readonly track: number;
    readonly top: number;
    readonly height: number;
}

export interface TimelineTrackDropHit {
    readonly track: number;
    readonly top: number;
    readonly height: number;
    readonly rejected: boolean;
    readonly targetTrackId?: string;
    readonly insertIndex?: number;
}

/** 映像クリップの着地先。段の境界付近だけを新しいトラックへの差し込み先にする。 */
export function hitTestTimelineTrackDrop(
    localY: number,
    layouts: readonly TimelineTrackDropLayout[],
    originalTrack: number
): TimelineTrackDropHit {
    const ordered = [...layouts]
        .filter(layout => Number.isFinite(layout.top) && layout.height > 0 && layout.rawIndex >= 0)
        .sort((left, right) => left.top - right.top);
    const visual = ordered.filter(layout => layout.lane === 'visual');
    const eligible = visual.filter(layout => layout.acceptsItems);
    const fallback = eligible.find(layout => layout.track === originalTrack) ?? eligible[0];
    if (!fallback || visual.length === 0) {
        return { track: originalTrack, top: 0, height: 0, rejected: true };
    }

    for (let index = 0; index < visual.length - 1; index++) {
        const upper = visual[index];
        const lower = visual[index + 1];
        const boundary = (upper.top + upper.height + lower.top) / 2;
        if (Math.abs(localY - boundary) <= 4) {
            return { track: fallback.track, top: boundary, height: fallback.height,
                rejected: false, insertIndex: upper.rawIndex };
        }
    }

    const containing = ordered.find(layout =>
        localY >= layout.top && localY < layout.top + layout.height);
    if (containing) {
        if (containing.lane === 'visual' && containing.acceptsItems) {
            return targetHit(containing);
        }
        return rejectedHit(fallback);
    }

    const topmost = visual[0];
    const bottommost = visual[visual.length - 1];
    const bottomEdge = bottommost.top + bottommost.height;
    if (localY < topmost.top) {
        return {
            track: fallback.track,
            top: topmost.top,
            height: fallback.height,
            rejected: false,
            insertIndex: topmost.rawIndex + 1
        };
    }
    const nextAudio = ordered.find(layout => layout.lane === 'audio' && layout.top >= bottomEdge);
    if (localY >= bottomEdge && (nextAudio === undefined || localY < nextAudio.top)) {
        return {
            track: fallback.track,
            top: bottomEdge,
            height: fallback.height,
            rejected: false,
            insertIndex: bottommost.rawIndex
        };
    }

    // visual 群の内側にある LANE_GAP は挿入帯にしない。最も近い通常段へ吸着させる。
    if (localY >= topmost.top && localY < bottomEdge) {
        const nearest = eligible.reduce((best, candidate) =>
            distanceToLayout(localY, candidate) < distanceToLayout(localY, best) ? candidate : best);
        return targetHit(nearest);
    }
    return rejectedHit(fallback);
}

function targetHit(layout: TimelineTrackDropLayout): TimelineTrackDropHit {
    return {
        track: layout.track,
        top: layout.top,
        height: layout.height,
        rejected: false,
        targetTrackId: layout.id
    };
}

function rejectedHit(layout: TimelineTrackDropLayout): TimelineTrackDropHit {
    return {
        track: layout.track,
        top: layout.top,
        height: layout.height,
        rejected: true,
        targetTrackId: layout.id
    };
}

function distanceToLayout(value: number, layout: TimelineTrackDropLayout): number {
    if (value < layout.top) return layout.top - value;
    const bottom = layout.top + layout.height;
    return value >= bottom ? value - bottom : 0;
}
