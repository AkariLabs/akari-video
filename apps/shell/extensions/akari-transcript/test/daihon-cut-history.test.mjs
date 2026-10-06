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
  'restoreCutSpan', 'showCutToast', 'showToast', 'notify', 'notifyError', 'applyCutRangeEditor', 'withHistory'];
const methodSource = methods.map(name => {
  const start = source.indexOf(`    protected ${['showCutToast', 'showToast', 'notify', 'notifyError'].includes(name) ? '' : 'async '}${name}(`);
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
    sourceIdForRow: () => 'main', audioOnlyCutReason: () => undefined,
    closePop() {}, closeCutRangeEditor() {},
    readText: async target => target.toString() === 'edit' ? edit : 'captions-before',
    async reload() {}, refreshCutTimeline() {}, showCutToast: message => toasts.push(message),
    notify: message => notifications.push(message), notifyError: message => notifications.push(message),
    errorMessage: error => String(error),
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
  const cut = applyCutRanges(before, [{ in: 2, out: 3, kind: 'filler', captionId: 'main', label: 'えー' }]).source;
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

test('範囲修正の再カットが失敗しても、復元済みの変更を履歴 1 件から undo できる', async () => {
  const cut = applyCutRanges(before, [{ in: 2, out: 3, kind: 'filler', captionId: 'main', label: 'えー' }]).source;
  const run = harness(cut);
  run.widget.annotationsService.applyCutRanges = async () => { throw new Error('再カット失敗'); };
  await run.widget.applyCutRangeEditor(row, { kind: 'silence', gap: { start: 5, end: 6 } },
    { from: 5, to: 6 }, { range: { in: 2, out: 3, captionId: 'main' } });
  assert.equal(run.restoreCalls, 1);
  assert.equal(run.history.length, 1);
  assert.equal(run.edit, before);
  assert.ok(run.notifications.some(message => message.includes('再カット失敗')));
  await run.history[0].undo();
  assert.equal(run.edit, cut);
});

test('トーストの取り消すは履歴に別の操作が積まれると消える', () => {
  const run = harness();
  const previousDocument = globalThis.document;
  const elements = [];
  const element = tag => ({ tag, className: '', dataset: {}, children: [], removed: false,
    append(...children) { this.children.push(...children); },
    querySelector(selector) { return selector === 'button' ? this.children.find(child => child.tag === 'button') : undefined; },
    setAttribute() {},
    remove() { this.removed = true; },
    addEventListener(_event, listener) { this.click = listener; } });
  globalThis.document = { createElement: element, createTextNode: text => ({ text }) };
  let changed;
  run.widget.historyService = { onDidChange: callback => {
    changed = callback;
    return { dispose() {} };
  } };
  run.widget.node = { append: node => elements.push(node), querySelector: () => undefined };
  delete run.widget.showCutToast;
  try {
    run.widget.showCutToast('カットしました', () => {});
    const button = elements[0].children[0].children[1];
    assert.equal(button.textContent, '取り消す');
    changed();
    assert.equal(button.removed, true);
  } finally {
    if (run.widget.toastTimer) clearTimeout(run.widget.toastTimer);
    run.widget.cutToastCleanup?.();
    globalThis.document = previousDocument;
  }
});

test('エラーのトーストは自動で消えず閉じる操作を持つ', () => {
  const run = harness();
  const previousDocument = globalThis.document;
  const element = tag => ({ tag, dataset: {}, children: [], removed: false,
    append(...children) { this.children.push(...children); },
    get childElementCount() { return this.children.filter(child => child.tag && !child.removed).length; },
    setAttribute() {}, remove() { this.removed = true; },
    addEventListener(_event, listener) { this.click = listener; } });
  globalThis.document = { createElement: element, createTextNode: text => ({ text }) };
  run.widget.node = { append() {}, querySelector: () => undefined };
  try {
    const toast = run.widget.showToast('保存できません', true);
    assert.equal(toast.className, 'akari-daihon-toast error');
    assert.equal(toast.children.at(-1).textContent, '✕');
    assert.equal(run.widget.toastTimer, undefined);
    toast.children.at(-1).click();
    assert.equal(toast.removed, true);
  } finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});

test('エラーと成功は同じ積み重ねに並び、成功の取り消すを押せる', () => {
  const run = harness();
  const oldDocument = globalThis.document, oldSetTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  const scheduled = [], cleared = [], undoCalls = [];
  const element = tag => ({ tag, className: '', dataset: {}, children: [], removed: false, parent: null,
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    querySelector(selector) {
      const descendants = node => (node.children ?? []).flatMap(child => [child, ...descendants(child)]);
      return descendants(this).find(child => selector === 'button' ? child.tag === 'button'
        : selector === '.akari-daihon-toast-stack' ? child.className === 'akari-daihon-toast-stack'
          : selector === '.akari-daihon-toast:not(.error)' && child.className === 'akari-daihon-toast');
    },
    querySelectorAll(selector) {
      return this.children.filter(child => selector === '.akari-daihon-toast.error'
        && child.className === 'akari-daihon-toast error');
    },
    get childElementCount() { return this.children.filter(child => child.tag).length; },
    setAttribute() {},
    remove() { this.removed = true; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); },
    addEventListener(_event, listener) { this.click = listener; } });
  globalThis.document = { createElement: element, createTextNode: text => ({ text }) };
  globalThis.setTimeout = (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; };
  globalThis.clearTimeout = timer => cleared.push(timer);
  run.widget.node = element('root');
  run.widget.historyService = { undo: () => undoCalls.push('undo'), onDidChange: () => ({ dispose() {} }) };
  delete run.widget.notify;
  delete run.widget.notifyError;
  delete run.widget.showCutToast;
  try {
    run.widget.notifyError('保存できません');
    const stack = run.widget.node.children[0], errorToast = stack.children[0];
    assert.equal(stack.className, 'akari-daihon-toast-stack');
    assert.equal(errorToast.className, 'akari-daihon-toast error');
    assert.equal(scheduled.length, 0, 'エラーは自動で消えない');
    run.widget.pendingUndoAt = Date.now();
    run.widget.notify('字幕を更新しました');
    const successToast = stack.children[1];
    assert.equal(run.widget.node.children.length, 1, '通知は一つの容器に入る');
    assert.deepEqual(stack.children, [errorToast, successToast], '別々の縦の行に並ぶ');
    assert.equal(successToast.children[1].textContent, '取り消す');
    assert.equal(scheduled[0].delay, 4500);
    assert.equal(errorToast.children.at(-1).textContent, '✕');
    successToast.children[1].click();
    assert.deepEqual(undoCalls, ['undo']);
    assert.deepEqual(stack.children, [errorToast], '取り消したあともエラーは残る');
    run.widget.notify('表示を変更しました');
    const nextSuccess = stack.children[1];
    run.widget.notify('別の通知');
    assert.equal(nextSuccess.removed, true, '次の通常通知で入れ替わる');
    assert.equal(stack.children.length, 2);
    assert.equal(stack.children[0], errorToast);
    scheduled.at(-1).callback();
    assert.deepEqual(stack.children, [errorToast], '通常通知だけ数秒後に消える');
    run.widget.notifyError('二つ目のエラー');
    assert.equal(errorToast.removed, false, '次のエラーでも前のエラーを残す');
    errorToast.children.at(-1).click();
    assert.equal(errorToast.removed, true);
    stack.children[0].children.at(-1).click();
    assert.equal(stack.removed, true, '最後の通知を閉じると容器も消える');
    assert.ok(cleared.length > 0, '通常通知の入れ替え時には前のタイマーを止める');
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }
});
