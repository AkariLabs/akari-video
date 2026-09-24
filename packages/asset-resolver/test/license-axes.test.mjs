import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { deriveLicenseAxes } from '../src/license-axes.mjs';

const cases = [
  [{ spdx: 'CC0-1.0' }, 'allowed', false],
  [{ spdx: 'LicenseRef-AKARI-Assets-v0' }, 'allowed', false],
  [{ spdx: 'LicenseRef-AKARI-Sounds-Terms-v0' }, 'allowed', false],
  [{ spdx: 'MIT' }, 'allowed', false],
  [{ spdx: 'OFL-1.1' }, 'allowed', false],
  [{ spdx: 'CC-BY-4.0' }, 'allowed', true],
  [{ spdx: 'CC-BY-SA-4.0' }, 'allowed', true],
  [{ spdx: 'CC-BY-NC-4.0', scope: 'commercial-ok' }, 'prohibited', true],
  [{ spdx: 'CC-BY-NC-4.0', attribution_required: false }, 'prohibited', true],
  [{ scope: 'commercial-ok' }, 'allowed', null],
  [{ scope: 'non-commercial' }, 'prohibited', null],
  [{ scope: 'commercial-ok', attribution_required: false }, 'allowed', false],
  [{ scope: 'attribution' }, 'allowed', true],
  [{ spdx: 'unknown', scope: 'unknown' }, 'unknown', null],
  [{ spdx: 'unknown', attribution_required: true }, 'unknown', true],
  [{ spdx: 'CC0-1.0', commercial: 'prohibited', attributionRequired: true }, 'prohibited', true],
  [{ spdx: 'CC-BY-4.0', commercial: 'unknown', attributionRequired: null }, 'unknown', null],
  [null, 'unknown', null],
];

test('license axes cover SPDX, legacy scope and explicit overrides', () => {
  for (const [license, commercial, attributionRequired] of cases) {
    assert.deepEqual(deriveLicenseAxes(license), { commercial, attributionRequired });
  }
});

async function metas(dir) {
  const rows = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) rows.push(...await metas(join(dir, entry.name)));
    else if (entry.name === 'meta.json') rows.push(join(dir, entry.name));
  }
  return rows;
}

test('all bundled and catalog metadata is inventoried; unknown names are visible', async () => {
  const root = resolve(import.meta.dirname, '../../..');
  const files = [...await metas(join(root, 'assets')), ...await metas(join(root, 'catalog'))];
  const unknown = [];
  for (const file of files) {
    const meta = JSON.parse(await readFile(file, 'utf8'));
    if (deriveLicenseAxes(meta.license).commercial === 'unknown') unknown.push(file.slice(root.length + 1));
  }
  assert.ok(files.length >= 67);
  console.log(`license inventory: ${files.length} metadata files; unknown: ${JSON.stringify(unknown.sort())}`);
});
