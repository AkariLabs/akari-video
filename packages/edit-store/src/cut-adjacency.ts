/**
 * cuts 配列順で隣り合う同一トラックの 2 クリップが、トランジション UI を持てる境界か判定する。
 * タイムライン UI と edit-lint は必ずこの関数を使い、フレーム量子化の条件式を複製しない。
 */

export interface CutAdjacencyTransitionLike {
    duration?: unknown;
}

export interface CutAdjacencyEarlierLike {
    tlEnd: number;
    transitionOut?: CutAdjacencyTransitionLike | null;
}

export interface CutAdjacencyLaterLike {
    tlStart: number;
}

const DEFAULT_CUT_ADJACENCY_FPS = 30;

function effectiveFps(fps: number): number {
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CUT_ADJACENCY_FPS;
}

/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
export function areCutsAdjacent(
    earlier: CutAdjacencyEarlierLike,
    later: CutAdjacencyLaterLike,
    fps = DEFAULT_CUT_ADJACENCY_FPS
): boolean {
    const resolvedFps = effectiveFps(fps);
    const earlierEndFrame = Math.round(earlier.tlEnd * resolvedFps);
    const laterStartFrame = Math.round(later.tlStart * resolvedFps);
    const overlapFrames = earlierEndFrame - laterStartFrame;
    const declaredDuration = earlier.transitionOut?.duration;
    const declaredOverlapFrames = typeof declaredDuration === 'number'
        && Number.isFinite(declaredDuration) && declaredDuration > 0
        ? Math.round(declaredDuration * resolvedFps)
        : 0;
    return overlapFrames === 0
        || (overlapFrames > 0 && overlapFrames <= declaredOverlapFrames);
}
