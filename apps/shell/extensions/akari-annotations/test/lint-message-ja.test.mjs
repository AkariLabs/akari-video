import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINT_CHECK_JA,
  formatLintFailureForUi,
  japaneseLintSummary,
  lintCheckFromError
} from '../lib/common/lint-message-ja.js';

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

test('辞書に無い check は従来表示へ完全フォールバックする', () => {
  const detail = '[future.unknown] original english detail';
  assert.equal(japaneseLintSummary([detail]), undefined);
  assert.equal(
    formatLintFailureForUi('書き出しに失敗しました', [detail]),
    `書き出しに失敗しました: ${detail}`
  );
});
