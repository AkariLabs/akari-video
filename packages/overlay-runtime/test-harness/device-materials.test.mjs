import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('device material profiles preserve binary assets and isolate shared keyboard materials', t => {
  const script = fileURLToPath(new URL('../../../skills/overlay-authoring/dev-fixtures/test_device_materials.py', import.meta.url));
  const result = spawnSync(process.env.AKARI_MATERIAL_PYTHON || 'python3', [script], { encoding: 'utf8', timeout: 30_000 });
  if (result.error?.code === 'ENOENT') return t.skip('Python 3 is required for Blender material recipe tests');
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
