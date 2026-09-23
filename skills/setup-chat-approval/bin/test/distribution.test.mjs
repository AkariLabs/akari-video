import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

test('配布先の doctor と find-chat-id は遅延ロードする', t => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'akari-chat-distribution-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../', import.meta.url));
  const target = path.join(scratch, 'bin');
  mkdirSync(target);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
    }
  }
  const repo = path.resolve(source, '..', '..', '..');
  const env = { ...process.env, AKARI_MONOREPO: repo, AKARI_INSTALL_DIR: path.join(scratch, 'missing-app'), AKARI_HOME: path.join(scratch, 'home') };
  for (const name of ['doctor.mjs', 'find-chat-id.mjs']) {
    const entry = path.join(target, name);
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(entry).href], { env, encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    const run = spawnSync(process.execPath, [entry, scratch], { env, encoding: 'utf8' });
    assert.equal(run.status, name === 'doctor.mjs' ? 0 : 1, run.stderr);
    const missing = spawnSync(process.execPath, [entry, scratch], { env: { ...env, AKARI_MONOREPO: '' }, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /セットアップするには/);
    assert.doesNotMatch(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  }
});
