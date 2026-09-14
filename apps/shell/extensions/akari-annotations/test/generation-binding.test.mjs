import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { resolveGenerationState } from '../lib/common/generation-sidecar.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, { source = '素材', expected = sha256(source), writeSource = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'akari-generation-binding-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relative = 'assets/generated/clip.mp4';
  const absolute = join(root, relative);
  await mkdir(join(root, 'assets/generated'), { recursive: true });
  if (writeSource) await writeFile(absolute, source);
  const meta = { version: 1, kind: 'video', status: 'done', result: { sha256: expected } };
  await writeFile(`${absolute}.meta.json`, JSON.stringify(meta));
  return { root, relative, absolute, meta };
}

async function read(service, data) {
  const result = await service.readGenerationSidecars({
    projectRootUri: pathToFileURL(data.root).toString(), sourcePaths: [data.relative]
  });
  return result.entries[0];
}

test('sha が一致する素材は matches true と actual を返す', async t => {
  const data = await fixture(t);
  const entry = await read(new AkariAnnotationsServiceImpl(), data);
  assert.equal(entry.binding.matches, true);
  assert.equal(entry.binding.actual, entry.binding.expected);
});

test('sha が不一致の素材は orphan になる', async t => {
  const data = await fixture(t, { expected: sha256('別物') });
  const entry = await read(new AkariAnnotationsServiceImpl(), data);
  assert.equal(entry.binding.matches, false);
  assert.equal(resolveGenerationState(entry.meta, Date.now(), entry.binding), 'orphan');
});

test('素材ファイルが無ければ actual null と matches false を返す', async t => {
  const data = await fixture(t, { writeSource: false });
  const entry = await read(new AkariAnnotationsServiceImpl(), data);
  assert.equal(entry.binding.actual, null);
  assert.equal(entry.binding.matches, false);
});

test('同じ素材の 2 回目はキャッシュを使い、素材変更後は再計算する', async t => {
  const data = await fixture(t);
  const service = new AkariAnnotationsServiceImpl();
  const original = service.hashSourceFile.bind(service);
  let calls = 0;
  service.hashSourceFile = async path => {
    calls += 1;
    return original(path);
  };
  await read(service, data);
  await read(service, data);
  assert.equal(calls, 1);
  await writeFile(data.absolute, '変更後の長い素材');
  await read(service, data);
  assert.equal(calls, 2);
});
