// narrationValidation.ts のテスト。契約 docs/contract-2026-07-20-edit-json-v1-narration.md §4
// （t/gain_db の劣化規約）の実装を検証する。ファイル欠落/デコード失敗の劣化（narrationTrack.ts 側）は
// 実ブラウザの fetch/decodeAudioData に依存するため、本パッケージには Node 用のブラウザ
// エミュレーションが無く、ここでは対象外（report.md の「未確認事項」に記載。L1 の代替検証は
// bench/evidence 配下の Playwright ベース確認を参照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNarrationSpecs } from '../dist/narrationValidation.js';

const TIMELINE_DURATION_SEC = 20;

test('validateNarrationSpecs: 正常な要素はそのまま通す（gain_db 省略は 0 になる）', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [{ id: 'n-0001', src: 'n-0001.mp3', t: 2.5 }],
    TIMELINE_DURATION_SEC
  );
  assert.deepEqual(skipped, []);
  assert.deepEqual(valid, [{ id: 'n-0001', src: 'n-0001.mp3', t: 2.5, gainDb: 0 }]);
});

test('validateNarrationSpecs: t が負値/非有限なら無視する（契約 §4）', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [
      { id: 'n-neg', src: 'a.mp3', t: -1 },
      { id: 'n-nan', src: 'b.mp3', t: NaN },
      { id: 'n-inf', src: 'c.mp3', t: Infinity },
    ],
    TIMELINE_DURATION_SEC
  );
  assert.equal(valid.length, 0);
  assert.equal(skipped.length, 3);
  assert.ok(skipped.every((s) => /invalid t/.test(s.reason)));
});

test('validateNarrationSpecs: t が timeline 長以上なら無視する（契約 §4）', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [{ id: 'n-late', src: 'a.mp3', t: 20 }],
    TIMELINE_DURATION_SEC
  );
  assert.equal(valid.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /timeline duration/);
});

test('validateNarrationSpecs: gain_db が範囲外の有限値ならクランプして採用する（棄却しない）', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [{ id: 'n-loud', src: 'a.mp3', t: 1, gainDb: 999 }],
    TIMELINE_DURATION_SEC
  );
  assert.equal(skipped.length, 0);
  assert.equal(valid[0].gainDb, 12);
});

test('validateNarrationSpecs: gain_db が非有限値なら無視する（契約 §4）', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [{ id: 'n-bad-gain', src: 'a.mp3', t: 1, gainDb: NaN }],
    TIMELINE_DURATION_SEC
  );
  assert.equal(valid.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /non-finite gain_db/);
});

test('validateNarrationSpecs: 1件が不正でも他の要素はプレビュー全体を壊さず通る', () => {
  const { valid, skipped } = validateNarrationSpecs(
    [
      { id: 'n-ok', src: 'a.mp3', t: 1, gainDb: -3 },
      { id: 'n-bad', src: 'b.mp3', t: -5 },
    ],
    TIMELINE_DURATION_SEC
  );
  assert.equal(valid.length, 1);
  assert.equal(valid[0].id, 'n-ok');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, 'n-bad');
});

test('validateNarrationSpecs: timelineDurationSec が Infinity なら「長以上」チェックをスキップする', () => {
  const { valid } = validateNarrationSpecs([{ id: 'n-any', src: 'a.mp3', t: 1e6 }], Infinity);
  assert.equal(valid.length, 1);
});
