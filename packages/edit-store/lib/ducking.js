"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATIC_DUCK_GAIN_DB = void 0;
exports.computeDuckIntervals = computeDuckIntervals;
exports.isWithinDuckInterval = isWithinDuckInterval;
exports.computeBgmDuckGainDb = computeBgmDuckGainDb;
/** プレビュー側の静的ダッキング近似量（契約 §3 表: 「固定の追加減衰（例: -12dB）」） */
exports.STATIC_DUCK_GAIN_DB = -12;
/**
 * narration イベント群から「BGM を下げるべき区間」の一覧を組み立てる（契約 §3:
 * 「各 narration の区間 [t, t + 音声実尺] で BGM ゲインを固定 -12dB に下げる」）。
 * 不正な入力（非有限 / 負値 / 0以下の尺）は区間化せず無視する。
 */
function computeDuckIntervals(sources) {
    return sources
        .filter((s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.durationSec) && s.durationSec > 0)
        .map((s) => ({ startSec: s.t, endSec: s.t + s.durationSec }));
}
/** atSec がいずれかの区間内か（区間は開始点を含み終了点を含まない半開区間として扱う） */
function isWithinDuckInterval(intervals, atSec) {
    return intervals.some((iv) => atSec >= iv.startSec && atSec < iv.endSec);
}
/**
 * bgm.ducking:true のときに、タイムライン上の atSec 時点で BGM へ追加すべき静的ダッキング量(dB)を返す。
 * 区間外・ducking 無効時は 0（= 元のゲインのまま。契約 §3「区間外は元に戻す」）。
 */
function computeBgmDuckGainDb(intervals, duckingEnabled, atSec) {
    if (!duckingEnabled)
        return 0;
    return isWithinDuckInterval(intervals, atSec) ? exports.STATIC_DUCK_GAIN_DB : 0;
}
