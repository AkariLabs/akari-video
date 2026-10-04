import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { splitCaptionLines as renderSplit } from '../../../../../packages/render-cut/src/captions.mjs';
import { splitCaptionLines as serverSplit } from '../../../../../packages/preview-server/public/caption-line-layout.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const extract = (source, start, end) => {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `caption splitter missing: ${start}`);
  return source.slice(begin, finish);
};

const handler = readHandlerSource();
// The webview code sits inside a TypeScript template literal, so its regex backslashes
// are doubled in the source. Evaluate the same JavaScript the template emits.
const webviewCode = extract(handler, 'const CAPTION_BOUNDARIES =', '// splitCaptionLines の分割点')
  .replaceAll('\\\\', '\\');
const webviewSplit = new Function(`${webviewCode}\nreturn splitCaptionLines;`)();

const hoverSource = read('../../akari-annotations/src/common/caption-hover-preview.ts');
const hoverCode = hoverSource.slice(hoverSource.indexOf('function splitCaptionLines('))
  .replace('text: string, maximum: number): string[]', 'text, maximum)')
  .replace('const lines: string[]', 'const lines');
const hoverSplit = new Function(`${hoverCode}\nreturn splitCaptionLines;`)();

const cases = [
  ['ほら、こんな感じで。', 20, ['ほら、こんな感じで。']],
  ['あいう、かきく、けこさしすせそ', 9, ['あいう、かきく、', 'けこさしすせそ']],
  ['今日は、とても良い天気なので散歩に行きましょう', 20, ['今日は、', 'とても良い天気なので散歩に行きましょう']],
  ['あいう、かきく けこさし', 8, ['あいう、', 'かきく けこさし']],
  ['、あいうえおかきくけこ', 5, ['、あいうえ', 'おかきくけ', 'こ']],
  ['ほら。こんな感じで。', 20, ['ほら。', 'こんな感じで。']],
  ['一行目\n二行目', 20, ['一行目', '二行目']],
  ['一行目\n\n二行目', 20, ['一行目', '', '二行目']],
  ['あいうえお かきくけこ', 8, ['あいうえお ', 'かきくけこ']],
  ['あいうえおかきくけこ', 5, ['あいうえお', 'かきくけこ']],
];

for (const [text, maximum, expected] of cases) {
  test(`caption line split parity: ${JSON.stringify(text)} / ${maximum}`, () => {
    for (const [name, split] of [
      ['render-cut', renderSplit], ['webview', webviewSplit],
      ['preview-server', serverSplit], ['caption-hover', hoverSplit],
    ]) {
      assert.deepEqual(split(text, maximum), expected, name);
    }
  });
}

test('grapheme mode keeps render-cut and webview in sync', () => {
  const text = '👩‍💻👩‍💻、👩‍💻👩‍💻👩‍💻';
  assert.deepEqual(webviewSplit(text, 4, true), renderSplit(text, 4, true));
});
