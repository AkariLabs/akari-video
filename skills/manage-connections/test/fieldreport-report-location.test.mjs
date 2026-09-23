import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('doctor writes its HTML inside .akari/reports without adding a root file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-doctor-'));
  try {
    await mkdir(join(root, '.akari'));
    await copyFile(new URL('../../../templates/project-default/.akari/connections.json', import.meta.url), join(root, '.akari', 'connections.json'));
    const before = await readdir(root);
    const result = spawnSync(process.execPath, [new URL('../bin/doctor.mjs', import.meta.url).pathname, root], {
      encoding: 'utf8',
      env: { ...process.env, AKARI_CREDENTIALS_FILE: join(root, '.akari', 'missing-credentials.env') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(root), before);
    await access(join(root, '.akari', 'reports', 'connections-report.html'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
