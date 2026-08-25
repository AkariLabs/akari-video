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

export const DEFAULT_CUT_ADJACENCY_FPS = 30;

export function effectiveCutFps(fps: number): number {
    return Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_CUT_ADJACENCY_FPS;
}

/**
 * earlier の終端と later の開始を出力 fps へ量子化し、実重なりをフレーム数で返す。
 * 正数は重なり、0 は突き合わせ、負数はすき間を表す。
 */
export function cutOverlapFrames(
    earlier: Pick<CutAdjacencyEarlierLike, 'tlEnd'>,
    later: CutAdjacencyLaterLike,
    fps = DEFAULT_CUT_ADJACENCY_FPS
): number {
    const resolvedFps = effectiveCutFps(fps);
    return Math.round(earlier.tlEnd * resolvedFps) - Math.round(later.tlStart * resolvedFps);
}

export interface TransitionHandleWindowInput {
    declaredSeconds: number;
    /** outgoing の out より後ろに残る素材尺（出力秒）。不明なら Infinity。 */
    outgoingTailRoomSeconds: number;
    /** incoming の in より前に残る素材尺（出力秒）。 */
    incomingHeadRoomSeconds: number;
    outgoingDurationSeconds: number;
    incomingDurationSeconds: number;
}

export interface TransitionHandleWindowPlan {
    effectiveSeconds: number;
    halfSeconds: number;
    outcome: 'full' | 'clamped' | 'none';
}

const nonNegativeRoom = (value: number): number => value === Number.POSITIVE_INFINITY
    ? value
    : Number.isFinite(value) && value > 0 ? value : 0;

/** 隠れのりしろ窓の実効尺を秒の連続量で決める単一定義。 */
export function planTransitionHandleWindow(input: TransitionHandleWindowInput): TransitionHandleWindowPlan {
    const declaredSeconds = Number.isFinite(input.declaredSeconds) && input.declaredSeconds > 0
        ? input.declaredSeconds : 0;
    const effectiveSeconds = Math.max(0, Math.min(
        declaredSeconds,
        2 * nonNegativeRoom(input.outgoingTailRoomSeconds),
        2 * nonNegativeRoom(input.incomingHeadRoomSeconds),
        2 * nonNegativeRoom(input.outgoingDurationSeconds),
        2 * nonNegativeRoom(input.incomingDurationSeconds)
    ));
    return {
        effectiveSeconds,
        halfSeconds: effectiveSeconds / 2,
        outcome: effectiveSeconds <= 0 ? 'none'
            : effectiveSeconds < declaredSeconds ? 'clamped' : 'full'
    };
}

export const STILL_IMAGE_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/iu;

export function isStillImageSourcePath(path: unknown): boolean {
    return typeof path === 'string' && STILL_IMAGE_SOURCE_PATTERN.test(path);
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
    const resolvedFps = effectiveCutFps(fps);
    const overlapFrames = cutOverlapFrames(earlier, later, resolvedFps);
    const declaredDuration = earlier.transitionOut?.duration;
    const declaredOverlapFrames = typeof declaredDuration === 'number'
        && Number.isFinite(declaredDuration) && declaredDuration > 0
        ? Math.round(declaredDuration * resolvedFps)
        : 0;
    return overlapFrames === 0
        || (overlapFrames > 0 && overlapFrames <= declaredOverlapFrames);
}
