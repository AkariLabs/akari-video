import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const at = source.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} が public/app.js に見つからない`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  assert.fail(`${name} の関数本体を閉じられない`);
}

const evaluate = vm.runInNewContext(`(caption, summary) => {
  ${extractFunction(appSource, 'isPortraitOutput')}
  ${extractFunction(appSource, 'captionLineBudget')}
  ${extractFunction(appSource, 'captionLineBudgetFor')}
  return captionLineBudgetFor(caption);
}`);

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
    assert.equal(evaluate({ text_style: { max_characters: 8 } }, summary), 8);
    assert.equal(evaluate({}, summary), 12);
    assert.equal(evaluate({ text_style: {} }, summary), 12);
    assert.equal(evaluate(undefined, summary), 12);
    assert.equal(evaluate({}, { output }), fallback);
    for (const value of [0, -1, 1.5, '12']) {
      const invalidStyle = { max_characters: value };
      assert.equal(evaluate({ text_style: invalidStyle }, summary), 12);
      assert.equal(evaluate({}, { output, default_text_style: invalidStyle }), fallback);
      assert.equal(evaluate({ text_style: invalidStyle }, { output }), fallback);
      for (const defaultValue of [0, -1, 1.5, '12']) {
        assert.equal(evaluate({ text_style: invalidStyle }, {
          output, default_text_style: { max_characters: defaultValue }
        }), fallback);
      }
      assert.equal(evaluate({ text_style: { max_characters: 8 } }, {
        output, default_text_style: invalidStyle
      }), 8);
    }
  }
  assert.equal(evaluate(undefined, undefined), 20);
});

test('reveal 自動昇格判定と静的行分割は字幕ごとの折り返し幅を使う', () => {
  assert.match(appSource, /splitCaptionLines\(displayText, captionLineBudgetFor\(active\)\)\.length > 1/u);
  assert.match(appSource, /const lines = splitCaptionLines\(displayText, captionLineBudgetFor\(active\)\);/u);
  assert.equal((appSource.match(/splitCaptionLines\(displayText, captionLineBudgetFor\(active\)\)/gu) ?? []).length, 2);
});
