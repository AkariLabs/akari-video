import assert from 'node:assert/strict';
import fsPromises, { mkdir, readdir, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { mock, test } from 'node:test';
import { readProjectReferences, recordProjectReference, removeProjectReference } from '../src/project-references.mjs';
import { setupFixtureEnv } from './helpers.mjs';

test('parallel reference updates keep every entry and leave no lock or temp file', async () => {
  const { root } = setupFixtureEnv();
  const project = path.join(root, 'project');
  const references = Array.from({ length: 12 }, (_, index) => ({
    category: 'still', id: `card-${index}`,
  }));
  await Promise.all(references.map(reference => recordProjectReference(project, reference)));
  assert.deepEqual(await readProjectReferences(project), references.sort((a, b) => a.id.localeCompare(b.id)));
  const directory = path.join(project, '.akari');
  assert.deepEqual((await readdir(directory)).filter(name =>
    name.endsWith('.lock') || name.endsWith('.tmp')), []);

  await Promise.all(references.slice(0, 6).map(reference => removeProjectReference(project, reference)));
  assert.deepEqual(await readProjectReferences(project), references.slice(6));
  assert.deepEqual((await readdir(directory)).filter(name =>
    name.endsWith('.lock') || name.endsWith('.tmp')), []);
});

test('stale lock is reclaimed before updating the ledger', async () => {
  const { root } = setupFixtureEnv();
  const project = path.join(root, 'project');
  const directory = path.join(project, '.akari');
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, 'asset-references.json.lock');
  await writeFile(lock, 'abandoned');
  const old = new Date(Date.now() - 11_000);
  await utimes(lock, old, old);
  await recordProjectReference(project, { category: 'still', id: 'recovered' });
  assert.deepEqual(await readProjectReferences(project), [{ category: 'still', id: 'recovered' }]);
  assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.lock')), []);
});

test('transient rename errors are retried without leaving a temp file', async () => {
  const { root } = setupFixtureEnv();
  const project = path.join(root, 'project');
  const originalRename = fsPromises.rename;
  let attempts = 0;
  const spy = mock.method(fsPromises, 'rename', async (...args) => {
    attempts++;
    if (attempts <= 2) {
      const error = new Error('temporary rename interference');
      error.code = 'EPERM';
      throw error;
    }
    return originalRename(...args);
  });
  try {
    await recordProjectReference(project, { category: 'still', id: 'retry-card' });
    assert.equal(attempts, 3);
    assert.deepEqual(await readProjectReferences(project), [{ category: 'still', id: 'retry-card' }]);
    assert.deepEqual((await readdir(path.join(project, '.akari'))).filter(name =>
      name.endsWith('.lock') || name.endsWith('.tmp')), []);
  } finally {
    spy.mock.restore();
  }
});

test('persistent rename EPERM falls back to overwriting the locked ledger', async () => {
  const { root } = setupFixtureEnv();
  const project = path.join(root, 'project');
  await recordProjectReference(project, { category: 'still', id: 'first-card' });
  let attempts = 0;
  const spy = mock.method(fsPromises, 'rename', async () => {
    attempts++;
    const error = new Error('destination held open');
    error.code = 'EPERM';
    throw error;
  });
  try {
    await recordProjectReference(project, { category: 'still', id: 'second-card' });
    assert.equal(attempts, 9);
    assert.deepEqual(await readProjectReferences(project), [
      { category: 'still', id: 'first-card' },
      { category: 'still', id: 'second-card' },
    ]);
    assert.deepEqual((await readdir(path.join(project, '.akari'))).filter(name =>
      name.endsWith('.lock') || name.endsWith('.tmp')), []);
  } finally {
    spy.mock.restore();
  }
});
