import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveNewestPackageFile } from '../bin/core/install-root.mjs';
import { runFixture } from './helpers/issue-79-fixture.mjs';

test('edit-store は暗黙候補の新版を選び、上方探索と env は優先する', async (context) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-79-roots-'));
  context.after(() => fs.rm(home, { recursive: true, force: true }));
  const old = path.join(home, '.akari/app');
  const resources = path.join(home, 'Resources');
  const vendor = path.join(resources, 'packages/akari-launcher/vendor');
  const explicit = path.join(home, 'explicit');
  const from = path.join(home, 'project/.claude/skills/compile-review-session/bin/core/x.mjs');
  const relative = 'edit-store/lib/index.js';
  const add = async (root, version) => {
    const file = path.join(root, 'packages', relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'module.exports = {};');
    if (version) {
      const manifest = root === vendor
        ? path.join(resources, 'packages/akari-launcher/package.json')
        : path.join(root, 'packages/akari-launcher/package.json');
      await fs.mkdir(path.dirname(manifest), { recursive: true });
      await fs.writeFile(manifest, JSON.stringify({ version }));
    }
    return file;
  };
  const oldFile = await add(old, '0.1.40');
  const newFile = await add(resources, '0.1.79');
  await add(vendor);
  const shim = path.join(home, '.akari/cli/bin/akari');
  await fs.mkdir(path.dirname(shim), { recursive: true });
  await fs.writeFile(shim, `exec node "${path.join(resources, 'packages/akari-launcher/bin/akari.mjs')}" "$@"`);
  const options = { from, env: {}, homeDir: home };
  assert.equal(resolveNewestPackageFile(relative, options), newFile);
  await fs.rm(path.join(resources, 'packages/akari-launcher/package.json'));
  assert.equal(resolveNewestPackageFile(relative, options), oldFile, '版不明は後ろ');
  await fs.rm(newFile);
  await fs.writeFile(path.join(resources, 'packages/akari-launcher/package.json'), JSON.stringify({ version: '0.1.80' }));
  assert.equal(resolveNewestPackageFile(relative, options), path.join(vendor, 'packages', relative), 'vendor は親 launcher の版を読む');
  const explicitFile = await add(explicit);
  assert.equal(resolveNewestPackageFile(relative, { ...options, env: { AKARI_INSTALL_DIR: explicit } }), explicitFile);
  const ancestor = path.join(home, 'project');
  const ancestorFile = await add(ancestor);
  assert.equal(resolveNewestPackageFile(relative, { ...options, env: { AKARI_INSTALL_DIR: explicit } }), ancestorFile);
});

test('コピーしたスキルは新しい Resources の edit-store で adjust を無警告で読む', async () => {
  const outcome = await runFixture();
  assert.equal(outcome.result.status, 'prepared', outcome.result.reason);
  assert.doesNotMatch(outcome.report, /adjust.*無視|未定義キー.*adjust/);
  assert.equal(outcome.snapshotUnchanged, true);
});

test('未知キーだけを落として警告し、snapshot のバイト列を保持する', async () => {
  const outcome = await runFixture({ unknown: true });
  assert.equal(outcome.result.status, 'prepared', outcome.result.reason);
  assert.match(outcome.report, /edit\.json\.tracks\[0\]\.items\[2\]\.zzz_unknown/);
  assert.equal(outcome.snapshotUnchanged, true);
});

test('型の誤りは救済せずに失敗する', async () => {
  const outcome = await runFixture({ badType: true });
  assert.equal(outcome.result.status, 'failed');
  assert.doesNotMatch(outcome.report, /未定義キーを無視/);
  assert.equal(outcome.snapshotUnchanged, true);
});
