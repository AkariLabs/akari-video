import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { generateTextstyleCatalogSource } from '../scripts/gen-textstyle-catalog.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const catalogRoot = join(repositoryRoot, 'presets/textstyle');

test('生成済み TEXTSTYLE_CATALOG は正本からの再生成結果と一致する', async () => {
  const tracked = await readFile(join(packageRoot, 'src/generated/textstyle-catalog.ts'), 'utf8');
  assert.equal(tracked, await generateTextstyleCatalogSource(catalogRoot));
});

test('index と個別 JSON の style・id・format が一致する', async () => {
  const entries = (await readFile(join(catalogRoot, 'index.jsonl'), 'utf8'))
    .split(/\r?\n/u)
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
  assert.equal(entries.length, 12);
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/u);
    const preset = JSON.parse(await readFile(join(catalogRoot, `${entry.id}.json`), 'utf8'));
    assert.equal(preset.id, entry.id);
    assert.equal(preset.format, 'akari-textstyle');
    assert.deepEqual(entry.style, preset.style, entry.id);
  }
});
