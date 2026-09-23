import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('catalog site definitions pass schema and reference checks', () => {
  const result = spawnSync(process.execPath, [new URL('../bin/validate-sites.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: 9 sites/);
});

test('invalid site definition is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-site-schema-'));
  try {
    await mkdir(join(root, 'sites'));
    await writeFile(join(root, 'sites', 'bad.json'), JSON.stringify({ id: 'bad', entry_url: 'javascript:alert(1)' }));
    const result = spawnSync(process.execPath, [new URL('../bin/validate-sites.mjs', import.meta.url).pathname, root], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /スキーマ違反|must have required property|entry_url/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
