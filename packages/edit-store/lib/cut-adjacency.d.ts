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
/**
 * ギャップ 0、または earlier の宣言済み transitionOut.duration で説明できる重なりだけを
 * 隣接とみなす。秒の誤差ではなく、出力 fps で量子化したフレーム数を比較する。
 */
export declare function areCutsAdjacent(earlier: CutAdjacencyEarlierLike, later: CutAdjacencyLaterLike, fps?: number): boolean;
