import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { captionLineBudgetFor } from '../public/caption-line-layout.js';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('字幕の折り返し幅は字幕ごと・既定スタイル・縦横の既定の順で選ぶ', () => {
  // render-cut src/captions.mjs の mergeCaptionTextStyles の実測（max_characters）:
  // default 12 + caption 0    -> 12
  // default 12 + caption 1.5  -> 12
  // default 12 + caption "12" -> 12
  // default 12 + caption 8    -> 8
  // 各スタイルを先に正規化するため、不正な字幕ごとの値は既定値を上書きしない。
  for (const [output, fallback] of [
    [{ width: 1080, height: 1920 }, 10],
    [{ width: 1920, height: 1080 }, 20],
  ]) {
    const summary = { output, default_text_style: { max_characters: 12 } };
    assert.equal(captionLineBudgetFor({ text_style: { max_characters: 8 } }, summary), 8);
    assert.equal(captionLineBudgetFor({}, summary), 12);
    assert.equal(captionLineBudgetFor({ text_style: {} }, summary), 12);
    assert.equal(captionLineBudgetFor(undefined, summary), 12);
    assert.equal(captionLineBudgetFor({}, { output }), fallback);
    for (const value of [0, -1, 1.5, '12']) {
      const invalidStyle = { max_characters: value };
      assert.equal(captionLineBudgetFor({ text_style: invalidStyle }, summary), 12);
      assert.equal(captionLineBudgetFor({}, { output, default_text_style: invalidStyle }), fallback);
      assert.equal(captionLineBudgetFor({ text_style: invalidStyle }, { output }), fallback);
      for (const defaultValue of [0, -1, 1.5, '12']) {
        assert.equal(captionLineBudgetFor({ text_style: invalidStyle }, {
          output, default_text_style: { max_characters: defaultValue }
        }), fallback);
      }
      assert.equal(captionLineBudgetFor({ text_style: { max_characters: 8 } }, {
        output, default_text_style: invalidStyle
      }), 8);
    }
  }
  assert.equal(captionLineBudgetFor(undefined, undefined), 20);
});

test('reveal 自動昇格判定と静的行分割は字幕ごとの折り返し幅を使う', () => {
  assert.match(appSource, /splitCaptionLines\(displayText, captionLineBudgetFor\(active, summary\)\)\.length > 1/u);
  assert.match(appSource, /const lines = splitCaptionLines\(displayText, captionLineBudgetFor\(active, summary\)\);/u);
  assert.equal((appSource.match(/splitCaptionLines\(displayText, captionLineBudgetFor\(active, summary\)\)/gu) ?? []).length, 2);
});
