import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { bundleProjectReferences } from '../src/bundle.mjs';
import {
  readProjectReferences,
  recordProjectReference,
  removeProjectReference,
  resolveLibraryFallback,
} from '../src/project-references.mjs';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('project references: tolerant read, idempotent upsert, stable sort, and remove', async () => {
  const { root } = setupFixtureEnv();
  const project = path.join(root, 'project');
  const ledger = path.join(project, '.akari', 'asset-references.json');
  await mkdir(path.dirname(ledger), { recursive: true });

  assert.deepEqual(await readProjectReferences(project), []);
  await writeFile(ledger, '{ broken', 'utf8');
  assert.deepEqual(await readProjectReferences(project), []);

  await recordProjectReference(project, { id: 'zeta', category: 'still' });
  await recordProjectReference(project, { id: 'alpha', category: 'still' });
  await recordProjectReference(project, { id: 'theme', category: 'audio' });
  await recordProjectReference(project, { id: 'alpha', category: 'still' });
  assert.deepEqual(await readProjectReferences(project), [
    { id: 'theme', category: 'audio' },
    { id: 'alpha', category: 'still' },
    { id: 'zeta', category: 'still' },
  ]);

  const stored = JSON.parse(await readFile(ledger, 'utf8'));
  assert.equal(stored.version, 0);
  assert.deepEqual(stored.references, await readProjectReferences(project));
  assert.deepEqual(
    (await readdir(path.dirname(ledger))).filter((name) => name.endsWith('.tmp')),
    [],
  );

  await removeProjectReference(project, { id: 'alpha', category: 'still' });
  assert.deepEqual(await readProjectReferences(project), [
    { id: 'theme', category: 'audio' },
    { id: 'zeta', category: 'still' },
  ]);
});

test('resolveLibraryFallback accepts only a declared regular file inside the library root', async () => {
  const { root, home } = setupFixtureEnv();
  const assetsDir = path.join(home, 'assets');
  const file = path.join(assetsDir, 'still', 'card', 'nested', 'frame.png');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'frame', 'utf8');
  const references = [{ id: 'card', category: 'still' }];

  assert.equal(resolveLibraryFallback({
    declaredPath: 'assets/still/card/nested/frame.png',
    references,
    akariAssetsDir: assetsDir,
  }), file);
  assert.equal(resolveLibraryFallback({
    declaredPath: 'assets/still/card/../../outside.png',
    references,
    akariAssetsDir: assetsDir,
  }), null);
  assert.equal(resolveLibraryFallback({
    declaredPath: 'assets/still/other/nested/frame.png',
    references,
    akariAssetsDir: assetsDir,
  }), null);
  assert.equal(resolveLibraryFallback({
    declaredPath: path.join(root, 'absolute.png'),
    references,
    akariAssetsDir: assetsDir,
  }), null);
});

test('resolve reference mode records both new-fetch and cache-hit paths without copying', async () => {
  const { env, root, baseDir, catalog, catalogPath } = setupFixtureEnv();
  const project = path.join(root, 'project');
  const rawFile = path.join(baseDir, 'audio', 'mini-raw', 'v1', 'tone.wav');
  await mkdir(path.dirname(rawFile), { recursive: true });
  await writeFile(rawFile, 'tone', 'utf8');
  catalog.items.push({
    id: 'mini-raw',
    category: 'audio',
    title: 'Raw fixture',
    price: 0,
    files: [{ name: 'tone.wav', key: 'audio/mini-raw/v1/tone.wav' }],
  });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await mkdir(project, { recursive: true });

  const first = await resolveAsset('mini-raw', { env, project, reference: true });
  assert.equal(first.cached, false);
  assert.equal(first.referenced, true);
  assert.equal(Object.hasOwn(first, 'projectDir'), false);
  assert.equal(existsSync(path.join(project, 'assets', 'audio', 'mini-raw')), false);

  const second = await resolveAsset('mini-raw', { env, project, reference: true });
  assert.equal(second.cached, true);
  assert.equal(second.referenced, true);
  assert.equal(Object.hasOwn(second, 'projectDir'), false);
  assert.deepEqual(await readProjectReferences(project), [
    { id: 'mini-raw', category: 'audio' },
  ]);
});

test('bundle dry-run is inert; execution materializes successes and preserves failures', async () => {
  const { env, root, baseDir, catalog, catalogPath } = setupFixtureEnv();
  const project = path.join(root, 'project');
  await mkdir(project, { recursive: true });
  const rawFile = path.join(baseDir, 'audio', 'mini-raw', 'v1', 'tone.wav');
  await mkdir(path.dirname(rawFile), { recursive: true });
  await writeFile(rawFile, 'tone', 'utf8');
  catalog.items.push({
    id: 'mini-raw',
    category: 'audio',
    title: 'Raw fixture',
    price: 0,
    files: [{ name: 'tone.wav', key: 'audio/mini-raw/v1/tone.wav' }],
  });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const cachedMeta = path.join(env.AKARI_HOME, 'assets', 'still', 'mini-still', 'meta.json');
  await mkdir(path.dirname(cachedMeta), { recursive: true });
  await writeFile(cachedMeta, '{"id":"mini-still"}\n', 'utf8');
  await recordProjectReference(project, { id: 'mini-still', category: 'still' });
  await recordProjectReference(project, { id: 'mini-raw', category: 'audio' });
  await recordProjectReference(project, { id: 'not-in-catalog', category: 'audio' });

  const dryRun = await bundleProjectReferences({ project, env, dryRun: true });
  assert.deepEqual(dryRun.planned, [
    { id: 'mini-raw', category: 'audio' },
    { id: 'not-in-catalog', category: 'audio' },
    { id: 'mini-still', category: 'still' },
  ]);
  assert.deepEqual(dryRun.materialized, []);
  assert.deepEqual(dryRun.failures, []);
  assert.equal(existsSync(path.join(project, 'assets')), false);
  assert.equal((await readProjectReferences(project)).length, 3);

  const bundled = await bundleProjectReferences({ project, env });
  assert.deepEqual(bundled.materialized.map(({ category, id }) => ({ category, id })), [
    { id: 'mini-raw', category: 'audio' },
    { id: 'mini-still', category: 'still' },
  ]);
  assert.equal(bundled.failures.length, 1);
  assert.deepEqual(bundled.failures[0].reference, {
    id: 'not-in-catalog',
    category: 'audio',
  });
  assert.ok(existsSync(path.join(project, 'assets', 'audio', 'mini-raw', 'tone.wav')));
  assert.ok(existsSync(path.join(project, 'assets', 'still', 'mini-still', 'meta.json')));
  assert.deepEqual(await readProjectReferences(project), [
    { id: 'not-in-catalog', category: 'audio' },
  ]);

  await rm(project, { recursive: true, force: true });
});
