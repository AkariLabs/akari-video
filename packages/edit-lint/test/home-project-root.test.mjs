import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/edit-lint.mjs', import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(join(os.tmpdir(), 'edit-lint-home-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const work = join(home, 'work');
  await mkdir(join(home, '.akari'), { recursive: true });
  await mkdir(work);
  const edit = join(work, 'edit.json');
  await writeFile(edit, JSON.stringify({ version: 2, output: { width: 320, height: 180, fps: 30 }, tracks: [] }));
  return { home, work, edit };
}

function lint(edit, home, akariHome) {
  const env = { ...process.env, HOME: home, AKARI_HOME: akariHome, TMPDIR: os.tmpdir() };
  if (akariHome === undefined) delete env.AKARI_HOME;
  const result = spawnSync(process.execPath, [cli, edit], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 2, result.stderr);
  assert.equal(result.error, undefined);
}

test('AKARI_HOME is skipped and lint is written beside a detached edit', async (t) => {
  const { home, work, edit } = await fixture(t);
  lint(edit, home, join(home, '.akari'));
  assert.equal(existsSync(join(work, '.akari', 'lint.json')), true);
  assert.equal(existsSync(join(home, '.akari', 'lint.json')), false);
});

test('the default HOME/.akari is skipped when AKARI_HOME is unset', async (t) => {
  const { home, work, edit } = await fixture(t);
  lint(edit, home, undefined);
  assert.equal(existsSync(join(work, '.akari', 'lint.json')), true);
  assert.equal(existsSync(join(home, '.akari', 'lint.json')), false);
});

test('a nested edit still writes to its real project ancestor', async (t) => {
  const { home, work, edit } = await fixture(t);
  await mkdir(join(work, '.akari'));
  const nested = join(work, 'nested');
  await mkdir(nested);
  const nestedEdit = join(nested, 'edit.json');
  await writeFile(nestedEdit, await readFile(edit));
  lint(nestedEdit, home, join(home, '.akari'));
  assert.equal(existsSync(join(work, '.akari', 'lint.json')), true);
  assert.equal(existsSync(join(nested, '.akari', 'lint.json')), false);
  assert.equal(existsSync(join(home, '.akari', 'lint.json')), false);
});
