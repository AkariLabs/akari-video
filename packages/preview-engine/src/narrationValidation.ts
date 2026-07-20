// audio.narration[] の劣化規約（docs/contract-2026-07-20-edit-json-v1-narration.md §4）のうち、
// t / gain_db に関する部分をプレビュー再生前に検証・正規化する。ファイル欠落・デコード失敗は
// 実際に fetch/decode を試みる narrationTrack.ts 側の責務（ここでは扱わない — このモジュールは
// DOM 非依存の純粋関数のみで完結させ、Node で直接テストできるようにする）。
import { clampGainDb } from './duckingGain.js';
import type { TimelineNarrationSpec } from './types.js';

export interface ResolvedNarrationSpec {
  id: string;
  src: string;
  t: number;
  /** クランプ済みの gain_db（省略時は 0） */
  gainDb: number;
}

export interface NarrationValidationWarning {
  id: string;
  reason: string;
}

export interface NarrationValidationResult {
  valid: ResolvedNarrationSpec[];
  /** 契約 §4 により無視された要素（t 不正 / gain_db 非有限）。ファイル欠落等は含まない */
  skipped: NarrationValidationWarning[];
}

/**
 * narration 要素を契約 §4 の劣化規約に従って検証する:
 * - t が非有限値・負値・timeline 長以上 → その要素を無視
 * - gain_db が非有限値（NaN/Infinity） → その要素を無視
 * - gain_db が [-60, 12] の範囲外（有限値） → クランプして採用（棄却しない）
 *
 * @param timelineDurationSec 非有限（Infinity）を渡すと「timeline 長以上」チェックをスキップする
 */
export function validateNarrationSpecs(
  specs: readonly TimelineNarrationSpec[],
  timelineDurationSec: number
): NarrationValidationResult {
  const valid: ResolvedNarrationSpec[] = [];
  const skipped: NarrationValidationWarning[] = [];

  for (const spec of specs) {
    if (!Number.isFinite(spec.t) || spec.t < 0) {
      skipped.push({ id: spec.id, reason: `invalid t (non-finite or negative): ${spec.t}` });
      continue;
    }
    if (Number.isFinite(timelineDurationSec) && spec.t >= timelineDurationSec) {
      skipped.push({
        id: spec.id,
        reason: `t (${spec.t}s) is at/beyond timeline duration (${timelineDurationSec}s)`,
      });
      continue;
    }
    const gainDb = clampGainDb(spec.gainDb);
    if (gainDb == null) {
      skipped.push({ id: spec.id, reason: `non-finite gain_db: ${spec.gainDb}` });
      continue;
    }
    valid.push({ id: spec.id, src: spec.src, t: spec.t, gainDb });
  }

  return { valid, skipped };
}
