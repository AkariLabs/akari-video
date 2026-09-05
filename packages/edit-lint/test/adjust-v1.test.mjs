import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintProject } from '../src/edit-lint.mjs';
import { validAdjust, invalidAdjustCases, editWithAdjust } from '../../schemas/test/fixtures/adjust-v1-cases.mjs';

async function lint(adjust) {
  const root = await mkdtemp(join(tmpdir(), 'akari-adjust-v1-'));
  try {
    await writeFile(join(root, 'edit.json'), JSON.stringify(editWithAdjust(adjust)));
    await writeFile(join(root, 'main.mp4'), '');
    return await lintProject(root, { writeReports: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('lint accepts all adjustV1 section boundary values without new capability paths', async () => {
  const result = await lint(validAdjust);
  assert.deepEqual(result.findings.filter(f => f.check.startsWith('adjust.')), []);
  assert.deepEqual(result.findings.filter(f => f.check === 'engine.capability-unknown'), []);
});
for (const [name, adjust, path, check] of invalidAdjustCases) {
  test('lint rejects ' + name + ' with stable check and exact path', async () => {
    const result = await lint({ ...adjust, sections: { curves: false, wheels: false, hue: false } });
    assert.ok(result.findings.some(f => f.check === 'adjust.' + path.split('.')[0] + '.' + check && f.path === 'edit.json#tracks[0].items[0].adjust.' + path), JSON.stringify(result.findings));
  });
}
