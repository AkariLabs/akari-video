import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { addUserEntry, applyVoiceDictionary, expandSnippet, loadVoiceDictionary, removeUserEntry,
  recordApplied, recordReverted, voiceDictionaryPaths } from '../src/index.mjs';
import { validateVoiceDictionary } from '../../schemas/bin/validate-voice-dictionary.mjs';

const withHome = async run => {
  const home = await mkdtemp(path.join(tmpdir(), 'voice-dictionary-'));
  try { await run({ AKARI_HOME: home }); } finally { await rm(home, { recursive: true, force: true }); }
};
test('同梱の全語が検証に通り、正規化キーが衝突しない', async () => withHome(async env => {
  const builtin = JSON.parse(await readFile(voiceDictionaryPaths({ env }).builtin, 'utf8'));
  assert.equal(validateVoiceDictionary(builtin).valid, true);
  assert.equal(builtin.entries.length, 8);
}));
test('語境界、決定論、冪等、範囲を保つ', async () => withHome(async env => {
  const resolved = loadVoiceDictionary({ env });
  const first = applyVoiceDictionary('てろっぷを出して', resolved, { final: true });
  assert.equal(first.text, 'テロップを出して');
  assert.deepEqual(first.applied[0].range, [0, 4]);
  assert.deepEqual(first, applyVoiceDictionary('てろっぷを出して', resolved));
  assert.equal(applyVoiceDictionary(first.text, resolved).text, first.text);
  assert.equal(applyVoiceDictionary('灯り', resolved).text, '灯り');
  assert.equal(applyVoiceDictionary('灯りビデオ', resolved).text, 'AKARI Video');
  assert.equal(applyVoiceDictionary('ｊｖ', resolved).text, 'Jev');
}));
test('正規形の複数語は適用記録を作らず、置換後の再適用も記録しない', async () => withHome(async env => {
  const resolved = loadVoiceDictionary({ env });
  for (const text of ['AKARI Videoを開いて', 'B ロールを入れて']) {
    assert.deepEqual(applyVoiceDictionary(text, resolved), { text, applied: [] });
  }
  const first = applyVoiceDictionary('あかりびでおを開いて', resolved);
  assert.equal(first.text, 'AKARI Videoを開いて');
  assert.equal(first.applied.length, 1);
  assert.deepEqual(applyVoiceDictionary(first.text, resolved), { text: first.text, applied: [] });
}));
test('自分の層が勝ち、同梱 id は消せない', async () => withHome(async env => {
  const added = await addUserEntry({ kind: 'fix', to: '表示文字', from: ['てろっぷ'] }, { env });
  assert.equal(added.ok, true);
  assert.equal(applyVoiceDictionary('てろっぷ', loadVoiceDictionary({ env })).text, '表示文字');
  assert.equal((await removeUserEntry('vd-builtin-telop', { env })).ok, false);
}));
test('壊れた層を無視し、同梱を使う', async () => withHome(async env => {
  const file = voiceDictionaryPaths({ env }).user;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{');
  const resolved = loadVoiceDictionary({ env });
  assert.equal(applyVoiceDictionary('てろっぷ', resolved).text, 'テロップ');
  assert.ok(resolved.layers[0].error);
}));
test('新しい版の自分の層を無視し理由を残す', async () => withHome(async env => {
  const file = voiceDictionaryPaths({ env }).user;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, entries: [] }));
  const resolved = loadVoiceDictionary({ env });
  assert.equal(resolved.layers[0].tooNew, true);
  assert.equal(applyVoiceDictionary('てろっぷ', resolved).text, 'テロップ');
}));
test('定型文は発話全体と許可された行き先だけ', async () => withHome(async env => {
  await addUserEntry({ kind: 'snippet', trigger: ['いつものやつ'], expand: '内容を確認する', scope: ['task'] }, { env });
  const resolved = loadVoiceDictionary({ env });
  assert.equal(expandSnippet('いつものやつ。', resolved, { target: 'task' }).expanded, '内容を確認する');
  assert.equal(expandSnippet('いつものやつをお願い', resolved, { target: 'task' }), undefined);
  assert.equal(expandSnippet('いつものやつ', resolved, { target: 'jev' }), undefined);
  assert.equal(expandSnippet('いつものやつ', resolved, { target: 'note' }), undefined);
}));
test('並行書き込みでも id が一意', async () => withHome(async env => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addUserEntry({ kind: 'fix', to: `語${i}`, from: [`よみ${i}`] }, { env })));
  assert.equal(results.every(result => result.ok), true);
  const book = JSON.parse(await readFile(voiceDictionaryPaths({ env }).user, 'utf8'));
  assert.equal(new Set(book.entries.map(entry => entry.id)).size, 20);
}));
test('検証不合格は元のファイルを保つ', async () => withHome(async env => {
  await addUserEntry({ kind: 'fix', to: '語', from: ['よみ'] }, { env });
  const file = voiceDictionaryPaths({ env }).user;
  const before = await readFile(file, 'utf8');
  assert.equal((await addUserEntry({ kind: 'fix', from: ['別'] }, { env })).ok, false);
  assert.equal(await readFile(file, 'utf8'), before);
}));
test('キャッシュは 1 秒未満で再確認せず、mtime 変更後に更新する', async () => withHome(async env => {
  let time = 10000;
  const first = loadVoiceDictionary({ env, now: () => time });
  const second = loadVoiceDictionary({ env, now: () => time + 500 });
  assert.equal(first, second);
  await addUserEntry({ kind: 'fix', to: '表示', from: ['独自語'] }, { env });
  time += 1500;
  const third = loadVoiceDictionary({ env, now: () => time });
  assert.notEqual(third, first);
  assert.equal(applyVoiceDictionary('独自語', third).text, '表示');
}));
test('確定適用を自分の hits と同梱 stats に分け、戻しても負数にしない', async () => withHome(async env => {
  const added = await addUserEntry({ kind: 'fix', to: '表示', from: ['独自語'] }, { env });
  recordApplied([{ id: added.entry.id, layer: 'user' }, { id: 'vd-builtin-telop', layer: 'builtin' }], { env });
  await new Promise(resolve => setTimeout(resolve, 1100));
  const paths = voiceDictionaryPaths({ env });
  assert.equal(JSON.parse(await readFile(paths.user, 'utf8')).entries[0].hits, 1);
  assert.equal(JSON.parse(await readFile(paths.stats, 'utf8'))['vd-builtin-telop'], 1);
  await recordReverted(added.entry.id, { env });
  await recordReverted(added.entry.id, { env });
  await recordReverted('vd-builtin-telop', { env });
  await recordReverted('vd-builtin-telop', { env });
  assert.equal(JSON.parse(await readFile(paths.user, 'utf8')).entries[0].hits, 0);
  assert.equal(JSON.parse(await readFile(paths.stats, 'utf8'))['vd-builtin-telop'], 0);
}));
