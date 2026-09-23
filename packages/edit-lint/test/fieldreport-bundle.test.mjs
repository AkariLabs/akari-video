import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('bundled engine capability table remains byte-identical to the schema source', async () => {
  const source = await readFile(new URL('../../schemas/engine-capabilities.json', import.meta.url));
  const bundled = await readFile(new URL('../src/engine-capabilities.json', import.meta.url));
  assert.deepEqual(bundled, source);
});

test('desktop packaging includes the edit-lint fallback table', async () => {
  const shell = JSON.parse(await readFile(new URL('../../../apps/shell/package.json', import.meta.url)));
  const resource = shell.build.extraResources.find(entry => entry.to === 'packages/edit-lint');
  assert.ok(resource?.filter.includes('src/**/*'));
});
