import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { applyCutRanges, canRestoreCutRange } from '@akari-video/edit-store';
import { restoreImpact, sameCutSpanIdentity } from '../lib/common/daihon-cut-spans.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf('    protected openCutSpanPop(');
const end = source.indexOf('    protected async restoreCutSpan(', start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`class PopupHarness { ${source.slice(start, end)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const PopupHarness = new Function('canRestoreCutRange', 'restoreImpact', 'sameCutSpanIdentity',
  `${compiled}; return PopupHarness;`)(canRestoreCutRange, restoreImpact, sameCutSpanIdentity);

function popup(edit, spans, selected) {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tag => ({ tag, textContent: '', children: [],
    append(...children) { this.children.push(...children); } }) };
  try {
    const widget = new PopupHarness();
    const pop = { children: [], append(...children) { this.children.push(...children); } };
    Object.assign(widget, { cutEditSource: edit, cutSpans: spans, editFps: 30, rowGaps: [],
      openPop: () => pop, popButton: label => ({ label, disabled: false, title: '' }),
      formatTime: seconds => `0:${seconds.toFixed(2)}` });
    widget.openCutSpanPop({}, { id: 'row' }, selected);
    return pop;
  } finally {
    globalThis.document = previousDocument;
  }
}

const span = (kind, inside, range) => ({ rowId: 'row', kind, in: inside[0], out: inside[1],
  sourceId: 'main', restoreRange: { in: range[0], out: range[1], captionId: 'main', kind: 'row' } });
const edit = JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'main', path: 'main.mp4' }], tracks: [{ id: 'visual', lane: 'visual', items: [
    { id: 'clip', at: 0, duration: 30, source: { kind: 'media', src: 'main', in: 0, out: 1 } },
    { id: 'clip-split', at: 30, duration: 30, source: { kind: 'media', src: 'main', in: 3, out: 4 } },
  ] }] });

test('隣接する語をまとめて戻すポップは件数と実際の復元範囲を示す', () => {
  const selected = span('word', [1, 2], [1, 3]);
  const other = span('word', [2, 3], [1, 3]);
  const pop = popup(edit, [selected, other], selected);
  assert.ok(pop.children.some(child => child.textContent
    === '前後の 1 か所も一緒に戻ります（0:1.00〜0:3.00）'));
});

test('古いクロージャから開いたポップは最新の復元範囲と隣接件数を使う', () => {
  const selected = span('word', [1, 2], [1, 3]);
  selected.index = 0;
  const other = span('word', [2, 3], [1, 3]);
  other.index = 1;
  const stale = { ...selected, restoreRange: { ...selected.restoreRange, out: 2 } };
  const pop = popup(edit, [selected, other], stale);
  assert.ok(pop.children.some(child => child.textContent
    === '前後の 1 か所も一緒に戻ります（0:1.00〜0:3.00）'));
  assert.equal(pop.children.find(child => child.label === '↩ 戻す').disabled, false);
});

test('古い形式の編集データでは戻すボタンを理由付きで灰色にする', () => {
  const selected = span('word', [1, 2], [1, 2]);
  const pop = popup(JSON.stringify({ version: 1, fps: 30, cuts: [] }), [selected], selected);
  const restore = pop.children.find(child => child.label === '↩ 戻す');
  assert.equal(restore.disabled, true);
  assert.match(restore.title, /古い形式/);
  assert.match(restore.title, /⌘Z の履歴/);
});

test('動く見た目と後続編集も、それぞれの理由をポップに示す', () => {
  const source = JSON.parse(edit);
  source.tracks[0].items = [{ id: 'moving', at: 0, duration: 120,
    source: { kind: 'media', src: 'main', in: 0, out: 4 },
    keyframes: [{ t: 0, transform: { scale: 1 } }, { t: 120, transform: { scale: 2 } }] }];
  const cut = { in: 1, out: 2, kind: 'row', captionId: 'main' };
  const moving = applyCutRanges(JSON.stringify(source), [cut]).source;
  const selected = span('row', [1, 2], [1, 2]);
  const appearance = popup(moving, [selected], selected).children.find(child => child.label === '↩ 戻す');
  assert.equal(appearance.disabled, true);
  assert.match(appearance.title, /動きや見た目/);

  delete source.tracks[0].items[0].keyframes;
  const edited = JSON.parse(applyCutRanges(JSON.stringify(source), [cut]).source);
  edited.tracks[0].items[1].at += 1;
  const later = popup(JSON.stringify(edited), [selected], selected).children.find(child => child.label === '↩ 戻す');
  assert.equal(later.disabled, true);
  assert.match(later.title, /あとに編集/);
});

test('消えた item の元の設定が無いときは戻すを灰色にし理由を示す', () => {
  const source = JSON.parse(edit);
  source.tracks[0].items = [
    { id: 'a', at: 0, duration: 30, source: { kind: 'media', src: 'main', in: 0, out: 1 } },
    { id: 'b', at: 30, duration: 30, transform: { scale: 1.5 },
      source: { kind: 'media', src: 'main', in: 1, out: 2 } },
    { id: 'c', at: 60, duration: 30, source: { kind: 'media', src: 'main', in: 2, out: 3 } },
  ];
  const cut = applyCutRanges(JSON.stringify(source),
    [{ in: 1, out: 2, kind: 'row', captionId: 'main' }]).source;
  const selected = span('row', [1, 2], [1, 2]);
  const pop = popup(cut, [selected], selected);
  const restore = pop.children.find(child => child.label === '↩ 戻す');
  assert.equal(restore.disabled, true);
  assert.match(restore.title, /切った部分の元の設定が編集データに残っていない/);
  assert.ok(pop.children.some(child => child.textContent === restore.title));
});
