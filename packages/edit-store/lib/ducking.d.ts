/** @deprecated 新規コードは DEFAULT_DUCK_DB を使用する。shell 互換のため当面残す。 */
export declare const STATIC_DUCK_GAIN_DB = -12;
export interface DuckInterval {
    startSec: number;
    endSec: number;
}
export interface DuckIntervalSource {
    /** タイムライン秒（narration の t） */
    t: number;
    /** narration 音声の実尺（秒）。デコード時に得られる duration をそのまま渡す */
    durationSec: number;
}
/**
 * narration イベント群から「BGM を下げるべき区間」の一覧を組み立てる（契約 §3:
 * 「各 narration の区間 [t, t + 音声実尺] で BGM ゲインを固定 -12dB に下げる」）。
 * 不正な入力（非有限 / 負値 / 0以下の尺）は区間化せず無視する。
 */
export declare function computeDuckIntervals(sources: DuckIntervalSource[]): DuckInterval[];
/** atSec がいずれかの区間内か（区間は開始点を含み終了点を含まない半開区間として扱う） */
export declare function isWithinDuckInterval(intervals: DuckInterval[], atSec: number): boolean;
