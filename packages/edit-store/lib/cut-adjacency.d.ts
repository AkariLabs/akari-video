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
export declare function effectiveCutFps(fps: number): number;
/**
 * earlier の終端と later の開始を出力 fps へ量子化し、実重なりをフレーム数で返す。
 * 正数は重なり、0 は突き合わせ、負数はすき間を表す。
 */
export declare function cutOverlapFrames(earlier: Pick<CutAdjacencyEarlierLike, 'tlEnd'>, later: CutAdjacencyLaterLike, fps?: number): number;
export type TransitionHandleExtensionOutcome = 'already-overlapping' | 'full' | 'partial' | 'none';
export interface TransitionHandleExtensionPlan {
    appliedSeconds: number;
    effectiveSeconds: number;
    appliedFrames: number;
    outcome: TransitionHandleExtensionOutcome;
}
export interface TransitionHandleExtensionInput {
    declaredSeconds: number;
    earlierEndSeconds: number;
    laterStartSeconds: number;
    maxExtendSeconds: number;
    fps?: number;
}
/**
 * 突き合わせ境界へ宣言尺ぶんの重なりを作るため、outgoing を何フレーム延ばすか決める。
 * メディア長は知らず、呼び出し側が maxExtendSeconds として渡した上限だけを使う。
 */
export declare function planTransitionHandleExtension(input: TransitionHandleExtensionInput): TransitionHandleExtensionPlan;
/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
export declare function areCutsAdjacent(earlier: CutAdjacencyEarlierLike, later: CutAdjacencyLaterLike, fps?: number): boolean;
