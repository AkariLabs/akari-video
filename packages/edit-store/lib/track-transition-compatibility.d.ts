/**
 * gap-aware track engine で transition_out を宣言できるかを判定する共有カーネル。
 * edit-lint とタイムライン UI は必ずこの関数を使い、条件式を複製しない。
 */
export interface TrackTransitionCutLike {
    track?: unknown;
    transition_out?: unknown;
}
export interface TrackTransitionTrackLike {
    kind?: unknown;
    ref?: unknown;
}
export interface UnsupportedDeclaredTrackTransition {
    cutIndex: number;
    trackRef: number;
}
export declare function usesDefaultCompatibilityTrackOrder(tracks: unknown): boolean;
/**
 * cutIndex の transition_out が gap-aware 経路で表現不能なら対象 track ref を返す。
 * transition_out の有無は見ないため、宣言前ガードにも既存宣言の検出にも同じ関数を使える。
 */
export declare function unsupportedTrackTransitionTarget(cuts: unknown, tracks: unknown, cutIndex: number): number | undefined;
export declare function findUnsupportedDeclaredTrackTransitions(cuts: unknown, tracks: unknown): UnsupportedDeclaredTrackTransition[];
