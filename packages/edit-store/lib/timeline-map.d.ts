/**
 * source↔output のタイムライン写像（パリティ契約 §2.1/§2.2 の土台、Phase 2-3 共有カーネル）。
 *
 * 書き込み側 SSOT の computeCutTrackSegments（at / track / speed / トランジション重なりの
 * カーソル意味論）の上に、再生用の出力セグメント列と写像関数を提供する。
 *
 * 消費者:
 *   - Web UI（packages/preview-server public/app.js）— edit-kernel.bundle.js（ESM）で import
 *   - shell annotations widget — computeCutTrackSegments を直接使用（従来どおり）
 *   - shell 動画面（previewBootstrapScript）— webview-kernel.js（IIFE、global: AkariEditKernel）
 *     のインライン注入で共有。v2 の絶対配置を常にマルチトラック平坦化する。
 */
import { EditCut } from './edit-store';
export interface TimelineTransitionPlate {
    start: number;
    end: number;
    mid: number;
    color: string;
    type: 'fade-black' | 'fade-white';
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
/**
 * 同一トラック上の隣接 cut が同時に存在するトランジション窓。
 * outgoing / incoming は窓の範囲へ切り詰め済みで、各 in/out はその窓に対応する
 * source 秒を保持する。progress は transitionProgressAt で 0..1 に正規化する。
 */
export interface TimelineTransitionWindow {
    start: number;
    end: number;
    duration: number;
    type: NonNullable<EditCut['transitionOut']>['type'];
    outgoing: TimelineSegment;
    incoming: TimelineSegment;
}
export interface TimelineMapResult {
    segments: TimelineSegment[];
    totalDuration: number;
    transitionPlates: TimelineTransitionPlate[];
    transitionWindows: TimelineTransitionWindow[];
    usesGapsOrTracks: boolean;
}
export declare function transitionProgressAt(window: TimelineTransitionWindow, outputT: number): number;
export declare function buildTimelineMap(cuts: readonly EditCut[], options?: {
    trackZ?: (track: number) => number;
    fps?: number;
    handleRoom?: (cutIndex: number) => {
        tailSeconds?: number;
        headSeconds?: number;
    } | undefined;
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
/**
 * ソース秒 → 出力秒。削除区間は次の保持区間の先頭へスナップし、素材末尾を
 * 超えた時刻は最終セグメントの終端へクランプする。
 */
export declare function sourceToOutput(segments: readonly TimelineSegment[], sourceT: number): number | null;
