import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const start = source.indexOf('  function commitEdit({ blur = true } = {}) {');
const end = source.indexOf('\n  function placeCaretAtEnd(', start);
assert.ok(start >= 0 && end > start);
const commitSource = source.slice(start, end);

function fixture({ changed = false, reject = false, rejectLater = false } = {}) {
  const sent = [];
  let rejectPending;
  let writePromise;
  const element = { textContent: changed ? '変更後' : '変更前', innerHTML: changed ? '変更後' : '変更前',
    blur() {}, hasAttribute: () => false, getAttribute: () => null, setAttribute() {}, removeAttribute() {} };
  const container = { dataset: { overlayId: 'telop' } };
  const edit = { element, container, overlayId: 'telop', originalText: '変更前', originalContents: [
    { element, html: '変更前', hadSplitUnits: false, splitUnits: '' }
  ], writeContext: { editPath: 'edit.json', engine: {} } };
  const context = {
    activeEdit: edit, document: { activeElement: null }, window: { akari: {} },
    syncMirrorLayers() {}, restoreAttribute() {}, invalidateOverlayHitPolicy() {},
    applyOverlayHitPolicy() {}, syncOverlayHitRegion() {},
    serializeFragment: () => `<div>${element.textContent}</div>`,
    enqueueWrite: (_context, _id, patch) => {
      sent.push(patch);
      writePromise = rejectLater
        ? new Promise((_, rejectWrite) => { rejectPending = rejectWrite; })
        : reject ? Promise.reject(new Error('library asset')) : Promise.resolve();
      writePromise.catch(() => undefined); // enqueueWrite attaches its own reporting handler.
      return { promise: writePromise };
    },
    reportWriteError() {}, Promise, Error,
  };
  const commitEdit = vm.runInNewContext(`${commitSource}\ncommitEdit`, context);
  return { commitEdit, element, container, sent, context, rejectPending: error => rejectPending(error),
    writePromise: () => writePromise };
}

test('テロップを変えずに確定すると書き戻しを送らない', async () => {
  const { commitEdit, sent } = fixture();
  await commitEdit();
  assert.equal(sent.length, 0);
});

test('テロップを変えて確定すると書き戻しを一度だけ送る', async () => {
  const { commitEdit, sent, writePromise } = fixture({ changed: true });
  const result = commitEdit();
  assert.equal(result, writePromise());
  await result;
  assert.equal(sent.length, 1);
  assert.equal(sent[0].html, '<div>変更後</div>');
});

test('書き戻しを断られたテロップの表示は編集前に戻る', async () => {
  const { commitEdit, element } = fixture({ changed: true, reject: true });
  await assert.rejects(commitEdit(), /library asset/u);
  assert.equal(element.innerHTML, '変更前');
});

test('void commitEdit で書き戻しを断られても unhandledRejection を起こさない', async () => {
  const { commitEdit, writePromise } = fixture({ changed: true, reject: true });
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    void commitEdit();
    await nextTurn();
    await nextTurn();
    assert.equal(unhandled.length, 0);
    assert.ok(writePromise());
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('書き戻し失敗までに同じテロップを再編集したら打ち直し中の文字を保つ', async () => {
  const { commitEdit, element, container, context, rejectPending } = fixture({ changed: true, rejectLater: true });
  const write = commitEdit();
  context.activeEdit = { container };
  element.innerHTML = '打ち直し中';
  rejectPending(new Error('library asset'));
  await assert.rejects(write, /library asset/u);
  assert.equal(element.innerHTML, '打ち直し中');
});
