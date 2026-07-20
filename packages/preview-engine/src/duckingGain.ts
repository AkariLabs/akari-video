// narration 静的ダッキング近似（契約 docs/contract-2026-07-20-edit-json-v1-narration.md §3、
// docs/contract-2026-07-14-edit-json-v1-audio.md §3-4 の "静的近似 -12dB" と同じ思想）。
// DOM 非依存の純粋関数のみ（Node の `node --test` で直接検証できる）。

/** audio.bgm / audio.sfx / audio.narration の gain_db クランプ範囲（両契約で共通） */
export const AUDIO_GAIN_DB_MIN = -60;
export const AUDIO_GAIN_DB_MAX = 12;

/** プレビュー側の静的ダッキング近似量（契約 §3 表: 「固定の追加減衰（例: -12dB）」） */
export const STATIC_DUCK_GAIN_DB = -12;

/**
 * gain_db を契約のクランプ規約に従って正規化する。
 * - 省略（undefined） → 既定 0
 * - 非有限値（NaN/Infinity） → null（呼び出し側は該当要素を無視する — 契約 §4）
 * - 範囲外の有限値 → [-60, 12] にクランプ（契約 §4「棄却ではなくクランプ」）
 */
export function clampGainDb(gainDb: number | undefined): number | null {
  const value = gainDb ?? 0;
  if (!Number.isFinite(value)) return null;
  return Math.min(AUDIO_GAIN_DB_MAX, Math.max(AUDIO_GAIN_DB_MIN, value));
}

/** dB → 線形ゲイン（契約 §3: `10^(gain_db/20)`、AVFoundation/ffmpeg 側と同一変換式） */
export function dbToLinear(gainDb: number): number {
  return Math.pow(10, gainDb / 20);
}

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
export function computeDuckIntervals(sources: DuckIntervalSource[]): DuckInterval[] {
  return sources
    .filter(
      (s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.durationSec) && s.durationSec > 0
    )
    .map((s) => ({ startSec: s.t, endSec: s.t + s.durationSec }));
}

/** atSec がいずれかの区間内か（区間は開始点を含み終了点を含まない半開区間として扱う） */
export function isWithinDuckInterval(intervals: DuckInterval[], atSec: number): boolean {
  return intervals.some((iv) => atSec >= iv.startSec && atSec < iv.endSec);
}

/**
 * bgm.ducking:true のときに、タイムライン上の atSec 時点で BGM へ追加すべき静的ダッキング量(dB)を返す。
 * 区間外・ducking 無効時は 0（= 元のゲインのまま。契約 §3「区間外は元に戻す」）。
 */
export function computeBgmDuckGainDb(
  intervals: DuckInterval[],
  duckingEnabled: boolean,
  atSec: number
): number {
  if (!duckingEnabled) return 0;
  return isWithinDuckInterval(intervals, atSec) ? STATIC_DUCK_GAIN_DB : 0;
}
