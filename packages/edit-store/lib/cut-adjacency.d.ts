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
export declare const DEFAULT_CUT_ADJACENCY_FPS = 30;
export declare function effectiveCutFps(fps: number): number;
/**
 * earlier の終端と later の開始を出力 fps へ量子化し、実重なりをフレーム数で返す。
 * 正数は重なり、0 は突き合わせ、負数はすき間を表す。
 */
export declare function cutOverlapFrames(earlier: Pick<CutAdjacencyEarlierLike, 'tlEnd'>, later: CutAdjacencyLaterLike, fps?: number): number;
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
/** 隠れのりしろ窓の実効尺を秒の連続量で決める単一定義。 */
export declare function planTransitionHandleWindow(input: TransitionHandleWindowInput): TransitionHandleWindowPlan;
export declare const STILL_IMAGE_SOURCE_PATTERN: RegExp;
export declare function isStillImageSourcePath(path: unknown): boolean;
/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
export declare function areCutsAdjacent(earlier: CutAdjacencyEarlierLike, later: CutAdjacencyLaterLike, fps?: number): boolean;
