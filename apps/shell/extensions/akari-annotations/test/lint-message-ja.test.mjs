import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { setLanguage } from '@akari-video/i18n';

import {
  LINT_CHECK_JA,
  LINT_WARNING_SUMMARY_CHECKS,
  formatLintFailureForUi,
  japaneseLintSummary,
  japaneseLintWarningSummary,
  lintSummary,
  lintWarningSummary,
  lintCheckFromError
} from '../lib/common/lint-message-ja.js';

setLanguage('ja');
after(() => setLanguage(undefined));

test('output-domain 総尺超過の警告 check は日本語辞書にある', () => {
  assert.match(
    LINT_CHECK_JA['captions.output-domain-exceeds-duration'],
    /動画終端までにクランプ/u,
  );
});

test('対象 check は日本語要約の後ろに従来の英語詳細を残す', () => {
  const detail = '[cuts.track-transition-unsupported] gap-aware track engine cannot represent xfade';
  const message = formatLintFailureForUi('保存後の検証で問題が見つかりました', [detail], [{
    severity: 'error', check: 'cuts.track-transition-unsupported'
  }]);
  assert.match(message, /PiP または複数トラックの合成では書き出せません/);
  assert.match(message, /詳細: \[cuts\.track-transition-unsupported\] gap-aware track engine/);
});

test('captions.overlap は findings が無くても errors の check id から日本語化する', () => {
  const detail = '[captions.overlap] caption overlaps another caption';
  assert.equal(lintCheckFromError(detail), 'captions.overlap');
  assert.match(japaneseLintSummary([detail]), /字幕の表示時間が重なっています/);
});

test('cut-visibility は字幕 id を含む日本語詳細だけを表示する', () => {
  const message = '字幕 c-0004 は映像のカットでほとんど見えません（半分未満しか残っていません）';
  assert.match(LINT_CHECK_JA['captions.cut-visibility'], /映像のカット/u);
  assert.equal(formatLintFailureForUi('保存後の検証で問題が見つかりました',
    [`[captions.cut-visibility] ${message}`],
    [{ severity: 'error', check: 'captions.cut-visibility', message }]),
  `保存後の検証で問題が見つかりました: ${message}`);
});

test('複数 error でも先頭だけを表示し、日本語詳細なら check を重ねない', () => {
  const first = { severity: 'error', check: 'captions.example', message: '字幕 c-0002: 表示時間を確認してください' };
  const second = { severity: 'error', check: 'captions.cut-visibility',
    message: '字幕 c-0004 は映像のカットでほとんど見えません' };
  assert.equal(formatLintFailureForUi('保存後の検証で問題が見つかりました',
    [`[${first.check}] ${first.message}`, `[${second.check}] ${second.message}`], [first, second]),
  `保存後の検証で問題が見つかりました: ${first.message}`);
  const english = '[future.unknown] first English error';
  assert.equal(formatLintFailureForUi('保存後の検証で問題が見つかりました',
    [english, `[${second.check}] ${second.message}`], [
      { severity: 'error', check: 'future.unknown', message: 'first English error' }, second
    ]), `保存後の検証で問題が見つかりました: ${english}`);
});

test('辞書に無い check は従来表示へ完全フォールバックする', () => {
  const detail = '[future.unknown] original english detail';
  assert.equal(japaneseLintSummary([detail]), undefined);
  assert.equal(
    formatLintFailureForUi('書き出しに失敗しました', [detail]),
    `書き出しに失敗しました: ${detail}`
  );
});

test('失敗用要約は warning を使わず、未知 error の原文を transition warning で隠さない', () => {
  const warning = {
    severity: 'warning',
    check: 'cuts.transition-out.zero-overlap',
  };
  assert.equal(japaneseLintSummary([], [warning]), undefined);
  const detail = '[future.failure] actual failure detail';
  assert.equal(
    formatLintFailureForUi('保存後の検証で問題が見つかりました', [detail], [warning]),
    `保存後の検証で問題が見つかりました: ${detail}`,
  );
});

test('pass 時の warning 要約対象は transition の 2 check に固定する', () => {
  assert.deepEqual(LINT_WARNING_SUMMARY_CHECKS, [
    'cuts.transition-out.zero-overlap',
    'cuts.transition-out.layer-evacuated',
  ]);
  assert.match(japaneseLintWarningSummary([{
    severity: 'warning', check: 'cuts.transition-out.zero-overlap'
  }]), /のりしろにできる素材の余りがないため効きません/u);
  assert.match(japaneseLintWarningSummary([{
    severity: 'warning', check: 'cuts.transition-out.layer-evacuated'
  }]), /PiP 経路へ退避/u);
  assert.equal(japaneseLintWarningSummary([{
    severity: 'warning', check: 'captions.output-domain-exceeds-duration'
  }]), undefined);
  assert.match(LINT_CHECK_JA['cuts.transition-out.layer-evacuated'], /PiP 経路へ退避/u);
});

test('未知種の warning だけでは保存時の要約を出さない', () => {
  assert.equal(lintWarningSummary([{
    severity: 'warning', check: 'cuts.transition-out.unknown-type'
  }]), undefined);
  assert.match(LINT_CHECK_JA['cuts.transition-out.unknown-type'], /知らない種類のトランジション/u);
});

test('all known lint checks and detail label are translated in English', () => {
  setLanguage('en');
  try {
    const checks = [
      'cuts.track-transition-unsupported', 'cuts.transition-out.non-adjacent',
      'cuts.transition-out.zero-overlap', 'cuts.transition-out.layer-evacuated',
      'cuts.transition-out.freeze',
      'captions.overlap', 'captions.output-domain-exceeds-duration',
      'cuts.track-overlap', 'references.files', 'overlays.timeline', 'audio.sfx.timeline'
    ];
    for (const check of checks) {
      const message = lintSummary([`[${check}] original detail`]);
      assert.ok(message, check);
      assert.doesNotMatch(message, /[\u3040-\u30ff\u3400-\u9fff]/u, check);
      assert.equal(message, LINT_CHECK_JA[check]);
    }
    assert.match(formatLintFailureForUi('Validation failed', ['[captions.overlap] detail']), / Details: /u);
    assert.match(formatLintFailureForUi('保存後の検証で問題が見つかりました', ['[captions.overlap] detail']),
      /^Validation found problems after saving:/u);
  } finally { setLanguage('ja'); }
});
