/**
 * source↔output のタイムライン写像（パリティ契約 §2.1/§2.2 の土台、Phase 2-3 共有カーネル）。
 *
 * 書き込み側 SSOT の computeCutTrackSegments（at / track / speed / トランジション重なりの
 * カーソル意味論）の上に、再生用の出力セグメント列と写像関数を提供する。
 *
 * 消費者:
 *   - Web UI（packages/preview-server public/app.js）— timeline-map.bundle.js（ESM）で import
 *   - shell annotations widget — computeCutTrackSegments を直接使用（従来どおり）
 *   - shell 動画面（previewBootstrapScript の webview インライン実装）は未接続の複製が残る。
 *     既知の意味論差: インライン版の gaps/tracks モードは暗黙 at にトランジション重なりを
 *     載せない（本モジュールは書き込み側と同じく載せる）。webview への注入共有は次フェーズ
 *
 * モード判定は webview 実装と同一:
 *   - cuts に at 指定 or track≠0 が無い → シーケンシャル（トランジション重なり + プレート算出）
 *   - ある → マルチトラック平坦化（境界分割 + 中点勝者。既定は小さい track 番号が勝つ =
 *     webview の zForTrack フォールバックと同順。宣言トラック順を持つ呼び出し側は trackZ で上書き）
 */
import { EditCut } from './edit-store';
export interface TimelineTransitionPlate {
    start: number;
    end: number;
    mid: number;
    color: string;
}
export interface TimelineSegment {
    kind: 'src' | 'gap';
    outStart: number;
    outEnd: number;
    /** 元 cuts[] のインデックス（gap は null） */
    cutIndex: number | null;
    src?: string;
    /** outStart 時点のソース秒（src のみ） */
    in?: number;
    /** outEnd 時点のソース秒（src のみ） */
    out?: number;
    speed?: number;
    track?: number;
    transitionOut?: EditCut['transitionOut'] | null;
}
export interface TimelineMapResult {
    segments: TimelineSegment[];
    totalDuration: number;
    transitionPlates: TimelineTransitionPlate[];
    usesGapsOrTracks: boolean;
}
export declare function cutsUseGapsOrTracks(cuts: readonly EditCut[]): boolean;
export declare function buildTimelineMap(cuts: readonly EditCut[], options?: {
    trackZ?: (track: number) => number;
}): TimelineMapResult;
/**
 * 出力秒 → ソース秒。トランジション重なり区間（隣接 src が重なる出力時刻）は
 * 先行セグメントが勝つ（webview / 旧 Web UI の「先に終わる方を先に見る」走査と同順）。
 * gap 上は sourceT: null。末尾を超えた時刻は最終セグメントへクランプする。
 */
export declare function outputToSource(segments: readonly TimelineSegment[], outputT: number): {
    segment: TimelineSegment | null;
    sourceT: number | null;
};
