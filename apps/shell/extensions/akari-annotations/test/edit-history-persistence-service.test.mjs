import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const uri = path => pathToFileURL(path).toString();

test('履歴 RPC は両ファイルを一覧し guarded writer 経由で復元する', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-history-rpc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'edit.json'), '{"version":1,"fps":30,"source":"a.mp4","cuts":[],"overlays":[],"audio":{"sfx":[],"narration":[]}}\n');
  await writeFile(join(root, 'captions.json'), '[]\n');
  const service = new AkariAnnotationsServiceImpl();
  const saved = await service.snapshotEditHistory({ projectRootUri: uri(root), label: '保存点' });
  await writeFile(join(root, 'captions.json'), '[{"id":"changed"}]\n');
  const entries = await service.listEditHistory({ projectRootUri: uri(root) });
  assert.equal(entries[0].id, saved.id);
  await service.restoreEditHistory({ projectRootUri: uri(root), id: saved.id });
  assert.equal(await readFile(join(root, 'captions.json'), 'utf8'), '[]\n');
  assert.equal((await service.listEditHistory({ projectRootUri: uri(root) })).length, 2);
});
