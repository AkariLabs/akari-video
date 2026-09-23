import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { aggregateLibraryUsage, appendLibraryUsage, readLibraryUsage, usagePath } from '../src/library-usage.mjs';

test('使用記録は 1 配置につき 1 行追記し、壊れた行と消えたプロジェクトを集計から除く', async t => {
  const temp = await fs.mkdtemp(path.join(tmpdir(), 'akari-usage-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const env = { AKARI_HOME: path.join(temp, 'home'), AKARI_LIBRARY_ROOT: path.join(temp, 'library'), AKARI_CREATOR_ROOT: path.join(temp, 'creator') };
  const first = path.join(temp, 'first'), second = path.join(temp, 'second');
  await fs.mkdir(first); await fs.mkdir(second);
  await appendLibraryUsage({ category: 'audio', id: 'tone', project: first }, env);
  await appendLibraryUsage({ category: 'audio', id: 'tone', project: second }, env);
  await fs.appendFile(usagePath(env), '{broken}\n{"at":"oops"}\n');
  const lines = (await fs.readFile(usagePath(env), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 4);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), ['at', 'category', 'id', 'project']);
  assert.equal((await readLibraryUsage(env))['audio/tone'].count, 2);
  assert.deepEqual((await readLibraryUsage(env))['audio/tone'].projects, [await fs.realpath(first), await fs.realpath(second)]);
  await fs.rm(second, { recursive: true });
  assert.equal((await readLibraryUsage(env))['audio/tone'].count, 1);
  assert.equal(aggregateLibraryUsage('bad\n').audio, undefined);
});
