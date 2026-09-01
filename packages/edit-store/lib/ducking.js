"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATIC_DUCK_GAIN_DB = void 0;
exports.computeDuckIntervals = computeDuckIntervals;
exports.isWithinDuckInterval = isWithinDuckInterval;
const envelope_1 = require("./envelope");
/** @deprecated 新規コードは DEFAULT_DUCK_DB を使用する。shell 互換のため当面残す。 */
exports.STATIC_DUCK_GAIN_DB = envelope_1.DEFAULT_DUCK_DB;
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
