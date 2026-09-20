import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';
import { applyCompanionEdit } from '../lib/browser/companion-apply-edit.js';

const URI = uriModule.default ?? uriModule;

const editUri = new URI('file:///project/edit.json');
const captionsUri = new URI('file:///project/captions.json');
const root = new URI('file:///project');
const encoder = new TextEncoder();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashText = text => sha(encoder.encode(text));

function fixture(overrides = {}) {
  const files = new Map([
    [editUri.toString(), '{}'],
    [captionsUri.toString(), '[]']
  ]);
  const history = [];
  const notices = [];
  const writes = [];
  const deps = {
    currentProjectSessionId: () => 'session-1',
    currentLocation: () => ({ editUri, captionsUri, root }),
    readFileBytes: async uri => encoder.encode(files.get(uri.toString()) ?? ''),
    sha256Hex: async bytes => sha(bytes),
    writeEditSnapshot: async request => {
      writes.push(request);
      if (request.editSource !== undefined) files.set(editUri.toString(), request.editSource);
      if (request.captionsSource !== undefined) files.set(captionsUri.toString(), request.captionsSource);
      return { committed: false };
    },
    pushHistory: entry => history.push(entry),
    notify: message => notices.push(message),
    ...overrides
  };
  return { deps, files, history, notices, writes };
}

function args(changes = {}) {
  return {
    projectSessionId: 'session-1', label: 'replace',
    edit: { baseSha256: hashText('{}'), nextText: '{"version":1}' },
    ...changes
  };
}

test('session 不一致を拒む', async () => {
  const { deps, writes } = fixture({ currentProjectSessionId: () => 'other' });
  assert.equal((await applyCompanionEdit(args(), deps)).error, 'stale-session');
  assert.equal(writes.length, 0);
});

test('8MB 超を拒む', async () => {
  const { deps } = fixture();
  const nextText = JSON.stringify({ value: 'x'.repeat(8 * 1024 * 1024) });
  assert.equal((await applyCompanionEdit(args({ edit: {
    baseSha256: hashText('{}'), nextText
  } }), deps)).error, 'too-large');
});

test('中身なしと壊れた JSON を invalid-args にする', async () => {
  const { deps } = fixture();
  assert.equal((await applyCompanionEdit({ projectSessionId: 'session-1', label: 'empty' }, deps)).error, 'invalid-args');
  assert.equal((await applyCompanionEdit(args({ edit: {
    baseSha256: hashText('{}'), nextText: '{'
  } }), deps)).error, 'invalid-args');
});

test('現在のハッシュと違うと両方を書かない', async () => {
  const { deps, writes } = fixture();
  const result = await applyCompanionEdit(args({
    edit: { baseSha256: 'stale', nextText: '{"version":1}' },
    captions: { baseSha256: hashText('[]'), nextText: '[{"id":1}]' }
  }), deps);
  assert.equal(result.error, 'stale');
  assert.equal(result.value.editSha256, hashText('{}'));
  assert.equal(result.value.captionsSha256, hashText('[]'));
  assert.equal(writes.length, 0);
});

test('書き込み例外を rejected にする', async () => {
  const { deps } = fixture({ writeEditSnapshot: async () => { throw new Error('lint failed'); } });
  assert.deepEqual(await applyCompanionEdit(args(), deps), {
    ok: false, error: 'rejected', value: { reasons: ['lint failed'] }
  });
});

test('両文書を 1 回で書き履歴を 1 件積む', async () => {
  const { deps, history, writes, files } = fixture();
  const nextEdit = '{"version":1}';
  const nextCaptions = '[{"id":1}]';
  const result = await applyCompanionEdit(args({
    edit: { baseSha256: hashText('{}'), nextText: nextEdit },
    captions: { baseSha256: hashText('[]'), nextText: nextCaptions }
  }), deps);
  assert.deepEqual(result, {
    ok: true,
    value: { editSha256: hashText(nextEdit), captionsSha256: hashText(nextCaptions) }
  });
  assert.equal(writes.length, 1);
  assert.equal(history.length, 1);
  assert.equal(history[0].label, 'replace');
  assert.equal(files.get(editUri.toString()), nextEdit);
  assert.equal(files.get(captionsUri.toString()), nextCaptions);
});

test('undo 時に別変更があれば書き戻さず通知して失敗する', async () => {
  const { deps, history, writes, files, notices } = fixture();
  await applyCompanionEdit(args(), deps);
  files.set(editUri.toString(), '{"other":true}');
  await assert.rejects(history[0].undo, /変更されています/u);
  assert.equal(writes.length, 1);
  assert.equal(files.get(editUri.toString()), '{"other":true}');
  assert.equal(notices.length, 1);
});

test('redo 時も別変更があれば書き戻さず通知して失敗する', async () => {
  const { deps, history, writes, files, notices } = fixture();
  await applyCompanionEdit(args(), deps);
  await history[0].undo();
  assert.equal(files.get(editUri.toString()), '{}');
  files.set(editUri.toString(), '{"other":true}');
  await assert.rejects(history[0].redo, /変更されています/u);
  assert.equal(writes.length, 2);
  assert.equal(notices.length, 1);
});
