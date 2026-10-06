import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { applyCutRanges, restoreCutRange } from '@akari-video/edit-store';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { clampRowCutRange, normalizeCutRanges } = require('../lib/common/daihon-cut-plan.js');
const { normalizeFillerWord } = require('../lib/common/daihon-filler.js');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const methods = ['cutUnrecognized', 'cutFiller', 'cutRows', 'applyCutEntries',
  'restoreCutSpan', 'applyCutRangeEditor', 'withHistory'];
const methodSource = methods.map(name => {
  const start = source.indexOf(`    protected async ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf('\n    protected ', start + 1);
  assert.ok(end > start, `${name} has a following method`);
  return source.slice(start, end);
}).join('\n');
const compiled = ts.transpileModule(`class CutHarness { ${methodSource} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

const before = `${JSON.stringify({
  version: 2, output: { width: 320, height: 180, fps: 30 },
  sources: [{ id: 'main', path: 'main.mp4' }],
  tracks: [{ id: 'visual', lane: 'visual', items: [
    { id: 'clip', at: 0, duration: 300, source: { kind: 'media', src: 'main', in: 0, out: 10 } }
  ] }]
}, null, 2)}\n`;
const row = { id: 'row-1', src: 'main', start: 2, end: 4, text: 'あの話',
  words: [{ text: 'あの', start: 2, end: 3 }, { text: '話', start: 3, end: 4 }] };

function harness(initial = before) {
  let edit = initial;
  let applyCalls = 0;
  let restoreCalls = 0;
  const history = [];
  const notifications = [];
  const toasts = [];
  const CutHarness = new Function('clampRowCutRange', 'normalizeCutRanges', 'normalizeFillerWord',
    'daihonHistoryService', `${compiled}; return CutHarness;`)(
      clampRowCutRange, normalizeCutRanges, normalizeFillerWord, () => ({ push: entry => history.push(entry) }));
  const widget = new CutHarness();
  const uri = name => ({ toString: () => name });
  Object.assign(widget, {
    editUri: uri('edit'), captionsUri: uri('captions'), rootUri: uri('root'), rows: [row],
    sourceIdForRow: () => 'main', closePop() {}, closeCutRangeEditor() {},
    readText: async target => target.toString() === 'edit' ? edit : 'captions-before',
    async reload() {}, refreshCutTimeline() {}, showCutToast: message => toasts.push(message),
    notify: message => notifications.push(message), errorMessage: error => String(error),
    annotationsService: {
      async applyCutRanges(request) {
        applyCalls++;
        assert.equal(request.editUri, 'edit');
        const result = applyCutRanges(edit, request.ranges);
        edit = result.source;
        return result;
      },
      async restoreCutRange(request) {
        restoreCalls++;
        const result = restoreCutRange(edit, request.range);
        edit = result.source;
        return result;
      },
      async writeEditSnapshot(request) { edit = request.editSource; }
    }
  });
  return { widget, history, notifications, toasts, get edit() { return edit; },
    get applyCalls() { return applyCalls; }, get restoreCalls() { return restoreCalls; } };
}

for (const [name, invoke] of [
  ['フィラー', widget => widget.cutFiller(row, 0)],
  ['??', widget => widget.cutUnrecognized(row, { start: 5, end: 6 })],
  ['行', widget => widget.cutRows([row])],
  ['無音範囲エディタ', widget => widget.applyCutRangeEditor(row,
    { kind: 'silence', gap: { start: 5, end: 6 } }, { from: 5, to: 6 })]
]) {
  test(`${name}の映像カットは RPC と履歴が各 1 件で、undo が元の edit.json に戻す`, async () => {
    const run = harness();
    await invoke(run.widget);
    assert.equal(run.applyCalls, 1);
    assert.equal(run.restoreCalls, 0);
    assert.equal(run.history.length, 1);
    assert.notEqual(run.edit, before);
    assert.deepEqual(run.notifications, []);
    if (name === '行') assert.deepEqual(run.toasts, ['「あの話」をカットしました']);
    await run.history[0].undo();
    assert.equal(run.edit, before);
  });
}

test('長い行のカット通知は本文の先頭 12 文字と省略記号を出す', async () => {
  const longRow = { ...row, text: 'あいうえおかきくけこさしす' };
  const run = harness();
  run.widget.rows = [longRow];
  await run.widget.cutRows([longRow]);
  assert.deepEqual(run.toasts, ['「あいうえおかきくけこさし…」をカットしました']);
});

test('カット済み区間の復元は RPC と履歴が各 1 件で、undo が復元前の edit.json に戻す', async () => {
  const cut = applyCutRanges(before, [{ in: 2, out: 3, kind: 'filler', captionId: 'main' }]).source;
  const run = harness(cut);
  await run.widget.restoreCutSpan({ restoreRange: { in: 2, out: 3, kind: 'filler', captionId: 'main' } });
  assert.equal(run.applyCalls, 0);
  assert.equal(run.restoreCalls, 1);
  assert.equal(run.history.length, 1);
  assert.equal(run.edit, before);
  assert.deepEqual(run.notifications, []);
  await run.history[0].undo();
  assert.equal(run.edit, cut);
});
