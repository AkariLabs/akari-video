import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { projectFileContentHash } from '../../../../../packages/edit-store/lib/index.js';
import { captionCommandHistory } from '../lib/browser/caption-command-history.js';
import { AkariEditHistoryService } from '../lib/browser/akari-edit-history-service.js';

test('成功した字幕コマンドは履歴 1 件となり undo と redo は元のバイト列を往復する', async () => {
  setLanguage('ja');
  const before = '{"captions":[]}\n';
  const after = '{\n  "captions": [{"id":"c-0001"}]\n}\n';
  let disk = after;
  const calls = [];
  const write = async request => {
    calls.push(request);
    if (request.expectedHashes.captions !== projectFileContentHash(disk))
      return { committed: false, conflict: true, files: ['captions.json'], message: '競合' };
    disk = request.captionsSource;
    return { committed: false };
  };
  let reloads = 0;
  const snapshot = { written: ['captions.json'], before: { 'captions.json': {
    text: before, hash: projectFileContentHash(before) } }, after: { 'captions.json': {
    text: after, hash: projectFileContentHash(after) } } };
  const history = new AkariEditHistoryService();
  history.push(captionCommandHistory(snapshot, '字幕に当てる', {
    editUri: 'file:///edit.json', captionsUri: 'file:///captions.json', projectRootUri: 'file:///'
  }, write, async () => { reloads++; }));
  assert.equal(history.canUndo, true);
  await history.undo();
  assert.equal(disk, before);
  assert.equal(calls[0].expectedHashes.captions, projectFileContentHash(after));
  await history.redo();
  assert.equal(disk, after);
  assert.equal(calls[1].expectedHashes.captions, projectFileContentHash(before));
  assert.equal(reloads, 2);
  setLanguage(undefined);
});

test('別の変更が入った後の undo は書かず読み直してエラーを出す', async () => {
  setLanguage('ja');
  const before = '前\n';
  const after = '後\n';
  let disk = '別の変更\n';
  let reloads = 0;
  const entry = captionCommandHistory({ written: ['captions.json'],
    before: { 'captions.json': { text: before, hash: projectFileContentHash(before) } },
    after: { 'captions.json': { text: after, hash: projectFileContentHash(after) } }
  }, '字幕に当てる', { editUri: 'file:///edit.json', projectRootUri: 'file:///' },
  async request => request.expectedHashes.captions === projectFileContentHash(disk)
    ? (disk = request.captionsSource, { committed: false })
    : { committed: false, conflict: true, files: ['captions.json'], message: '競合' },
  async () => { reloads++; });
  await assert.rejects(entry.undo(), /ほかの変更があったので取り消せませんでした/);
  assert.equal(disk, '別の変更\n');
  assert.equal(reloads, 1);
  setLanguage(undefined);
});

test('attach を含む一手は edit と字幕の両方の hash を比較して戻す', async () => {
  const captionsBefore = '字幕前\n';
  const captionsAfter = '字幕後\n';
  const editBefore = '編集前\n';
  const editAfter = '編集後\n';
  const disk = { captions: captionsAfter, edit: editAfter };
  const version = text => ({ text, hash: projectFileContentHash(text) });
  const entry = captionCommandHistory({ written: ['captions.json', 'edit.json'],
    before: { 'captions.json': version(captionsBefore), 'edit.json': version(editBefore) },
    after: { 'captions.json': version(captionsAfter), 'edit.json': version(editAfter) }
  }, 'マイスタイル', { editUri: 'file:///edit.json', projectRootUri: 'file:///' },
  async request => {
    assert.equal(request.expectedHashes.captions, projectFileContentHash(disk.captions));
    assert.equal(request.expectedHashes.edit, projectFileContentHash(disk.edit));
    disk.captions = request.captionsSource;
    disk.edit = request.editSource;
    return { committed: false };
  }, async () => {});
  await entry.undo();
  assert.deepEqual(disk, { captions: captionsBefore, edit: editBefore });
  await entry.redo();
  assert.deepEqual(disk, { captions: captionsAfter, edit: editAfter });
});

test('別名の字幕と edit は役割で undo と redo できる', async () => {
  const before = '前\n';
  const after = '後\n';
  let captions = after;
  let edit = after;
  const version = text => ({ text, hash: projectFileContentHash(text) });
  const entry = captionCommandHistory({ written: ['captions.b.json', 'edit.b.json'],
    roles: { captions: 'captions.b.json', edit: 'edit.b.json' },
    before: { 'captions.b.json': version(before), 'edit.b.json': version(before) },
    after: { 'captions.b.json': version(after), 'edit.b.json': version(after) }
  }, '別名字幕', { editUri: 'file:///edit.b.json', captionsUri: 'file:///captions.b.json',
    projectRootUri: 'file:///' }, async request => {
    assert.equal(request.expectedHashes.captions, projectFileContentHash(captions));
    assert.equal(request.expectedHashes.edit, projectFileContentHash(edit));
    captions = request.captionsSource;
    edit = request.editSource;
  }, async () => {});
  await entry.undo();
  assert.deepEqual([captions, edit], [before, before]);
  await entry.redo();
  assert.deepEqual([captions, edit], [after, after]);
});

test('attach だけで edit が変わる一手は字幕が同じでも履歴を戻せる', async () => {
  const caption = '同じ字幕\n';
  let edit = '編集後\n';
  const version = text => ({ text, hash: projectFileContentHash(text) });
  const entry = captionCommandHistory({ written: ['edit.json'],
    roles: { captions: 'captions.json', edit: 'edit.json' },
    before: { 'captions.json': version(caption), 'edit.json': version('編集前\n') },
    after: { 'captions.json': version(caption), 'edit.json': version(edit) }
  }, '効果音', { editUri: 'file:///edit.json', projectRootUri: 'file:///' },
  async request => {
    assert.deepEqual(request.expectedHashes, { edit: projectFileContentHash(edit) });
    assert.equal(request.captionsSource, undefined);
    edit = request.editSource;
  }, async () => {});
  await entry.undo();
  assert.equal(edit, '編集前\n');
});
