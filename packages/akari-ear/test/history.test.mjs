import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHistory, voiceDictionaryPaths } from '../src/index.mjs';

test('既定オフはファイルを作らず、オンでは trial を除外して保持数と期限を守る', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'ear-history-'));
  const env = { AKARI_HOME: home };
  try {
    let now = Date.UTC(2026, 9, 7);
    const history = createHistory({ env, now: () => now });
    history.record({ id: 'off', final: true, purpose: 'note', raw: '語', text: '語' });
    await history.flush();
    await assert.rejects(stat(voiceDictionaryPaths({ env }).history), { code: 'ENOENT' });
    history.setEnabled(true);
    history.record({ id: 'trial', final: true, purpose: 'trial', raw: '語', text: '語' });
    for (let i = 0; i < 201; i++) history.record({ id: `u${i}`, final: true, purpose: 'note', raw: '語', text: '語' });
    await history.flush();
    assert.equal((await history.list()).length, 200);
    assert.equal((await history.list())[0].id, 'u1');
    now += 8 * 24 * 60 * 60 * 1000;
    history.record({ id: 'new', final: true, purpose: 'note', raw: '語', text: '語' });
    await history.flush();
    assert.equal((await history.list()).length, 1);
    await history.clear();
    await assert.rejects(readFile(voiceDictionaryPaths({ env }).history), { code: 'ENOENT' });
  } finally { await rm(home, { recursive: true, force: true }); }
});
