import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, setLanguage } from '@akari-video/i18n';
import { createCaptionLookMigrationOffer, changedCaptionLookRows } from '../lib/browser/caption-look-migration-offer.js';

const original = JSON.stringify({ captions: [{ id: 'c1', text: '猫', start: 0, end: 2, src: 's1' }],
  emphasis_words: [{ id: 'e1', word: '猫', src: 's1', t_start: 0, t_end: 1 }] }) + '\n';
const migrated = original.replace('"emphasis_words"', '"moved_words"');
const diff = [{ path: 'emphasis_words', before: JSON.parse(original).emphasis_words, after: [] }];

function fixture(options = {}) {
  let current = original, hash = 'old', remembered = false, prompts = 0, writes = 0, conflict = 0;
  let history;
  const offer = createCaptionLookMigrationOffer();
  const deps = {
    projectRootUri: 'file:///project', editUri: 'file:///project/edit.json',
    captionsUri: 'file:///project/captions.json', captionsName: 'captions.json', editName: 'edit.json',
    getRemembered: async () => remembered,
    remember: async () => { remembered = true; },
    migrate: async request => {
      if (request.input.dryRun && options.dryFail) return { ok: false, invalid: true, diagnostics: [] };
      if (request.input.dryRun) return { ok: true, diff: options.diff ?? diff,
        before: { 'captions.json': { text: current, hash }, 'edit.json': { text: '{}', hash: 'edit' } },
        after: {}, written: [], changed: [], notices: [] };
      if (request.expectedHashes.captions !== hash) return { ok: false, conflict: true, files: ['captions.json'] };
      const before = { 'captions.json': { text: current, hash }, 'edit.json': { text: '{}', hash: 'edit' } };
      current = migrated; hash = 'new'; writes++;
      return { ok: true, written: ['captions.json'], before,
        after: { 'captions.json': { text: current, hash }, 'edit.json': before['edit.json'] },
        changed: ['captions.json'], notices: [] };
    },
    ask: async () => { prompts++; options.afterDry?.(() => { current = '外部変更'; hash = 'external'; });
      return options.choice ?? 'fix'; },
    notifySaved: async () => Boolean(options.undo),
    notifyConflict: () => { conflict++; },
    pushHistory: entry => { history = entry; },
    undo: async entry => { if (entry === history) await entry.undo(); },
    write: async request => {
      assert.equal(request.expectedHashes.captions, hash);
      current = request.captionsSource; hash = 'old';
      return {};
    },
    reload: async () => {}, historyLabel: '固定'
  };
  return { offer, deps, state: () => ({ current, remembered, prompts, writes, conflict, history }) };
}

test('未移行が零行なら提案を出さない', async () => {
  const f = fixture({ diff: [] }); await f.offer(f.deps);
  assert.equal(f.state().prompts, 0);
});

test('dry-run が失敗したら通知せず書かない', async () => {
  const f = fixture({ dryFail: true }); await f.offer(f.deps);
  assert.equal(f.state().prompts, 0); assert.equal(f.state().writes, 0);
});

test('あとでを選んだプロジェクトには再提案しない', async () => {
  const f = fixture({ choice: 'later' }); await f.offer(f.deps);
  await createCaptionLookMigrationOffer()(f.deps);
  assert.equal(f.state().prompts, 1); assert.equal(f.state().remembered, true);
});

test('固定の後は再提案せず、一回の undo で元のバイト列へ戻る', async () => {
  const f = fixture({ undo: true }); await f.offer(f.deps);
  await createCaptionLookMigrationOffer()(f.deps);
  assert.equal(f.state().current, original);
  assert.equal(f.state().writes, 1); assert.equal(f.state().prompts, 1);
  assert.equal(f.state().remembered, true);
});

test('dry-run の後の外部変更は書かずに競合だけ知らせる', async () => {
  const f = fixture({ afterDry: change => change() }); await f.offer(f.deps);
  assert.equal(f.state().writes, 0); assert.equal(f.state().current, '外部変更');
  assert.equal(f.state().conflict, 1);
});

test('通知を閉じただけなら次の起動で一度だけ再提案する', async () => {
  const f = fixture({ choice: undefined });
  f.deps.ask = async () => { f.deps.askCount = (f.deps.askCount ?? 0) + 1; return undefined; };
  await f.offer(f.deps); await f.offer(f.deps);
  await createCaptionLookMigrationOffer()(f.deps);
  assert.equal(f.deps.askCount, 2);
  assert.equal(f.state().remembered, false);
});

test('root の強調だけの差分も属する行を数える', () => {
  assert.equal(changedCaptionLookRows(diff, original), 1);
});

test('固定後に別の操作が入った元に戻すは取り消しの案内を出す', () => {
  const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(this\.historyService\.isTop\(entry\)\) await this\.performUndo\(\);\s*else this\.showNotice\(t\('annotations\.captionLookMigration\.offer\.undoAfterOtherChangesNotice'\)\)/u);
  setLanguage('ja');
  try { assert.match(t('annotations.captionLookMigration.offer.undoAfterOtherChangesNotice'), /取り消しで戻してください/u); }
  finally { setLanguage(undefined); }
});
