export type VisualTrackKind = 'cuts' | 'layers' | 'overlays' | 'captions' | 'audio';
export interface VisualTrackOrderEntry {
    kind: VisualTrackKind;
    ref?: number;
}
export interface VisualTrackOrderSource {
    cuts?: unknown[];
    layers?: unknown[];
    overlays?: unknown[];
    captions?: unknown[];
    hasCaptions?: boolean;
    hasInlineCaptions?: boolean;
    audio?: {
        sfx?: unknown[];
    };
}
export interface InternalTrackOrderEntry {
    id: string;
    z: number;
}
/**
 * timeline.tracks が省略されたときの下→上の既定順を、実データだけから決定的に導出する。
 * webview へ Function#toString() で注入できるよう、外部ヘルパに依存しない純関数に保つ。
 */
export declare function deriveVisualTrackOrder(source: VisualTrackOrderSource): VisualTrackOrderEntry[];
/**
 * timeline.tracks（先頭 = 最下段）における visual track の z-index を返す。
 * captions は singleton なので ref を比較せず、それ以外は kind + ref の完全一致で解決する。
 */
export declare function resolveVisualTrackZ(tracks: readonly VisualTrackOrderEntry[], kind: VisualTrackKind, ref?: number): number;
/**
 * 正規化後の tracks（先頭 = 最下段）における z-index を返す。
 *
 * `InternalTrack.z` は読み込み層が配列添字へ正規化しているが、消費側がその値を別の
 * 並びへ持ち越さないよう、ここでも配列順を唯一の権威として解決する。preview と
 * render-cut はこの関数を共有する。
 */
export declare function resolveInternalTrackZ(tracks: readonly InternalTrackOrderEntry[], trackId: string): number;
