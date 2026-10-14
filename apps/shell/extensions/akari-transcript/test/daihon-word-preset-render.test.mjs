import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import { readAllSourceText } from './helpers/daihon-source.mjs';
import test from 'node:test';

const source = readAllSourceText();

test('台本の語 span は旧強調と run の色・台紙を小さく示す', () => {
  assert.match(source, /span\.dataset\.emphasisPreset = typeof preset === 'string' \? preset : 'run'/u);
  assert.match(source, /--daihon-word-preset-color/u);
  assert.match(source, /--daihon-word-preset-bg/u);
  assert.match(source, /\.akari-daihon-word\[data-emphasis-preset\]/u);
  assert.match(source, /data-mark-background.*background:var\(--daihon-word-preset-bg\)/u);
  assert.match(source, /caption\.words\.map\(word => word\.text\)\.join\(''\) === caption\.text/u);
});

test('台本の地と字の相対輝度が近い印は下線だけにする', () => {
  const { readableWordMarkColor } = createI18nRequire(import.meta.url)('../lib/common/daihon-word-mark-color.js');
  assert.equal(readableWordMarkColor('#202020', '#242424'), false);
  assert.equal(readableWordMarkColor('#202020', 'rgb(36, 36, 36)'), false);
  assert.equal(readableWordMarkColor('#ffffff', '#202020'), true);
});

test('印だけが変わった行は描き直しの対象になる', () => {
  const { changedWordMarkRows } = createI18nRequire(import.meta.url)('../lib/common/daihon-word-mark-color.js');
  const before = new Map([['a', [{ color: '#111111' }]], ['b', ['neon']]]);
  const after = new Map([['a', [{ color: '#ffff00' }]], ['b', ['neon']]]);
  assert.deepEqual([...changedWordMarkRows(before, after)], ['a']);
  assert.deepEqual([...changedWordMarkRows(new Map([['a', ['neon']]]), new Map())], ['a']);
  assert.match(source, /changedWordMarks\.has\(row\.id\)/u);
});

test('印が同じ行は描き直しの対象にならない', () => {
  const { changedWordMarkRows } = createI18nRequire(import.meta.url)('../lib/common/daihon-word-mark-color.js');
  assert.deepEqual([...changedWordMarkRows(new Map([['a', [{ color: '#fff', background: '#000' }]]]),
    new Map([['a', [{ color: '#fff', background: '#000' }]]]))], []);
});

test('台紙のある語は選択中と再生中にも文字を読める', () => {
  assert.match(source, /data-mark-background\] \{ background:var\(--daihon-word-preset-bg\); color:var\(--daihon-word-preset-color/u);
  assert.match(source, /data-emphasis-preset\]\.wordsel \{ outline:2px/u);
  assert.match(source, /data-emphasis-preset\]\.now \{ box-shadow:inset/u);
});

test('台紙のある印の色は語の状態規則より後で同等以上の詳細度を持つ', () => {
  const style = source.match(/const STYLE = `([\s\S]*?)`;/u)?.[1];
  assert.ok(style);
  const rules = [...style.matchAll(/([^{}]+)\{([^{}]+)\}/gu)]
    .map((match, index) => ({ selector: match[1].trim(), declarations: match[2], index }));
  const mark = rules.find(rule => rule.selector ===
    '.akari-daihon-row .akari-daihon-word[data-emphasis-preset][data-mark-background]');
  assert.ok(mark);
  assert.match(mark.declarations, /background:var\(--daihon-word-preset-bg\)/u);
  assert.match(mark.declarations, /color:var\(--daihon-word-preset-color/u);
  const specificity = selector => (selector.match(/\.[\w-]+|\[[^\]]+\]|:hover/gu) ?? []).length;
  const states = [
    '.akari-daihon-word.past',
    '.akari-daihon-row:not(.active) .akari-daihon-word.seen',
    '.akari-daihon-word.now',
    '.akari-daihon-word:hover',
    '.akari-daihon-word.wordsel'
  ];
  for (const selector of states) {
    const state = rules.find(rule => rule.selector === selector);
    assert.ok(state, selector);
    assert.ok(mark.index > state.index, selector);
    assert.ok(specificity(mark.selector) >= specificity(state.selector), selector);
  }
});

test('台本は source ごとに候補を絞り実測秒の重なりで旧強調を選ぶ', () => {
  assert.match(source, /caption\.timeDomain === 'output'/u);
  assert.match(source, /item\.src === caption\.src/u);
  assert.match(source, /Math\.min\(word\.end, emphasis\.t_end\) - Math\.max\(word\.start, emphasis\.t_start\) > 0\.000001/u);
});

test('選んだ文字の適用と解除はそれぞれの履歴名を使う', () => {
  assert.match(source, /runCaptionCommand\(t\('transcript\.daihon\.editor\.changeSelectedWordsLookLabel'\)/u);
  assert.match(source, /runCaptionCommand\(t\('transcript\.daihon\.editor\.restoreSelectedWordsLookLabel'\)/u);
  assert.equal(globalThis.t('transcript.daihon.editor.changeSelectedWordsLookLabel'), '選んだ文字の見た目を変更');
  assert.equal(globalThis.t('transcript.daihon.editor.restoreSelectedWordsLookLabel'),
    '選んだ文字を字幕全体の見た目に戻す');
});
