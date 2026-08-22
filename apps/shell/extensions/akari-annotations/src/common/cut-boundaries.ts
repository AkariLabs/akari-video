import { areCutsAdjacent } from '@akari-video/edit-store';

export interface CutBoundaryInput {
    index: number;
    track: number;
    tlStart: number;
    tlEnd: number;
    transitionOut?: { type: string; duration: number };
}

export interface CutBoundary {
    earlierIndex: number;
    laterIndex: number;
    track: number;
    boundaryT: number;
    transitionOut?: { type: string; duration: number };
}

/**
 * 隣接クリップ境界の抽出（allowedTransitionOverlap と同じ隣接判定基準）: 同一トラックの
 * セグメントを cuts 配列順のまま束ね、隣り合う 2 件ごとに 1 境界を返す。segments は
 * computeCutTrackSegments と同じ順序（cuts の走査順）で渡す前提 — その順序さえ保たれれば
 * 「間に同一トラックの別カットが挟まらない」という allowedTransitionOverlap の定義と一致する。
 */
export function computeCutBoundaries(
    segments: readonly CutBoundaryInput[],
    fps = 30
): CutBoundary[] {
    const byTrack = new Map<number, CutBoundaryInput[]>();
    for (const segment of segments) {
        const list = byTrack.get(segment.track);
        if (list) {
            list.push(segment);
        } else {
            byTrack.set(segment.track, [segment]);
        }
    }
    const boundaries: CutBoundary[] = [];
    for (const list of byTrack.values()) {
        for (let index = 1; index < list.length; index++) {
            const earlier = list[index - 1];
            const later = list[index];
            if (!areCutsAdjacent(earlier, later, fps)) {
                continue;
            }
            boundaries.push({
                earlierIndex: earlier.index,
                laterIndex: later.index,
                track: earlier.track,
                boundaryT: later.tlStart,
                transitionOut: earlier.transitionOut
            });
        }
    }
    boundaries.sort((a, b) => a.earlierIndex - b.earlierIndex);
    return boundaries;
}
