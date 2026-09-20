import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..', '..', '..');

test('shell・build:ext・unit lane に登録されている', async () => {
  const shell = JSON.parse(await readFile(join(root, 'apps', 'shell', 'package.json'), 'utf8'));
  assert.equal(shell.dependencies['akari-companion'], 'file:./extensions/akari-companion');
  const build = shell.scripts['build:ext'];
  assert.ok(build.includes('extensions/akari-companion'));
  assert.ok(build.indexOf('extensions/akari-companion') > build.indexOf('extensions/akari-annotations'));
  const lanes = await readFile(join(root, 'scripts', 'ci', 'run-unit-tests.mjs'), 'utf8');
  assert.ok(lanes.includes("ext('akari-companion')"));
});
