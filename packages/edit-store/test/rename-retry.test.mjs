import assert from 'node:assert/strict';
import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeAtomic, writeProjectFilesGuarded } from '../lib/write-gate.js';
import { snapshot, restore } from '../lib/history-store.js';

const failure = code => Object.assign(new Error(`rename failed: ${code}`), { code });

async function project(t) {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'akari-rename-retry-'));
  t.after(() => fsPromises.rm(root, { recursive: true, force: true }));
  return root;
}

async function assertNoTemporaryFiles(root) {
  const names = await fsPromises.readdir(root);
  assert.deepEqual(names.filter(name => name.includes('.tmp')), []);
}

test('2 回 EPERM のあと成功すると全文を保存して tmp を消す', async t => {
  const root = await project(t);
  const target = path.join(root, 'edit.json');
  const originalRename = fsPromises.rename;
  const warnings = [];
  let attempts = 0;
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  t.mock.method(fsPromises, 'rename', async (...args) => {
    if (++attempts <= 2) throw failure('EPERM');
    return originalRename(...args);
  });

  await writeAtomic(target, '{"version":2}');
  assert.equal(attempts, 3);
  assert.equal(await fsPromises.readFile(target, 'utf8'), '{"version":2}');
  await assertNoTemporaryFiles(root);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /edit\.json.*2 回.*30 ms/);
  assert.equal(warnings[0].includes(root), false);
});

test('毎回 EPERM なら上限後に失敗して tmp を消す', async t => {
  const root = await project(t);
  const target = path.join(root, 'edit.json');
  const warnings = [];
  let attempts = 0;
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  t.mock.method(fsPromises, 'rename', async () => {
    attempts++;
    throw failure('EPERM');
  });

  await assert.rejects(writeAtomic(target, 'new'), { code: 'EPERM' });
  assert.equal(attempts, 7);
  await assertNoTemporaryFiles(root);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /edit\.json.*6 回.*630 ms/);
});

test('saved-by だけが失敗しても edit.json 保存は成功し警告は 1 つ', async t => {
  const root = await project(t);
  const originalRename = fsPromises.rename;
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  t.mock.method(fsPromises, 'rename', async (...args) => {
    if (path.basename(args[1]) === 'saved-by.json') throw failure('EIO');
    return originalRename(...args);
  });

  await writeProjectFilesGuarded(root, { 'edit.json': '{"version":0}' }, {
    appVersion: '1.2.3', debounceMs: 1,
    lintRunner: async () => ({ pass: true, errors: [], findings: [] })
  });
  assert.equal(await fsPromises.readFile(path.join(root, 'edit.json'), 'utf8'), '{"version":0}');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /saved-by\.json.*保存は完了.*EIO/);
  await assertNoTemporaryFiles(path.join(root, '.akari'));
});

test('saved-by の EPERM が上限まで続いても警告は重複しない', async t => {
  const root = await project(t);
  const originalRename = fsPromises.rename;
  const warnings = [];
  let stampAttempts = 0;
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  t.mock.method(fsPromises, 'rename', async (...args) => {
    if (path.basename(args[1]) === 'saved-by.json') {
      stampAttempts++;
      throw failure('EPERM');
    }
    return originalRename(...args);
  });

  await writeProjectFilesGuarded(root, { 'edit.json': '{"version":0}' }, {
    appVersion: '1.2.3', debounceMs: 1,
    lintRunner: async () => ({ pass: true, errors: [], findings: [] })
  });
  assert.equal(stampAttempts, 7);
  assert.equal(await fsPromises.readFile(path.join(root, 'edit.json'), 'utf8'), '{"version":0}');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /saved-by\.json.*6 回.*630 ms.*失敗/);
  await assertNoTemporaryFiles(path.join(root, '.akari'));
});

test('EPERM 以外は再試行せずそのまま投げる', async t => {
  const root = await project(t);
  const target = path.join(root, 'edit.json');
  const warnings = [];
  let attempts = 0;
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  t.mock.method(fsPromises, 'rename', async () => {
    attempts++;
    throw failure('EIO');
  });

  await assert.rejects(writeAtomic(target, 'new'), { code: 'EIO' });
  assert.equal(attempts, 1);
  assert.deepEqual(warnings, []);
  await assertNoTemporaryFiles(root);
});

test('履歴の restore も同じ再試行で保存する', async t => {
  const root = await project(t);
  await fsPromises.writeFile(path.join(root, 'edit.json'), 'before');
  const entry = await snapshot({ projectDir: root, label: 'before', files: ['edit.json'] });
  await fsPromises.writeFile(path.join(root, 'edit.json'), 'after');
  const originalRename = fsPromises.rename;
  let attempts = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(fsPromises, 'rename', async (...args) => {
    if (path.basename(args[1]) === 'edit.json' && ++attempts === 1) throw failure('EBUSY');
    return originalRename(...args);
  });

  await restore(root, entry.id, { files: ['edit.json'] });
  assert.equal(attempts, 2);
  assert.equal(await fsPromises.readFile(path.join(root, 'edit.json'), 'utf8'), 'before');
  await assertNoTemporaryFiles(root);
});
