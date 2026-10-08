import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkDistribution } from '../release/check-no-proprietary-licenses.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const catalogRoot = join(repo, 'catalog');
const shell = JSON.parse(readFileSync(join(repo, 'apps/shell/package.json'), 'utf8'));

function catalogFiles(directory = catalogRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? catalogFiles(file) : [file];
  });
}

test('同梱 catalog は音源の旧ライセンス表記だけを除き、フォントと他の項目を保つ', () => {
  const entry = shell.build.extraResources.find(item => item.from === '../../catalog' && item.to === 'catalog');
  assert.ok(entry);
  // check-packaged-imports は否定規則を解釈せず、正の規則だけで模擬 Resources を組む。
  // 先頭の **/* で browser を含む catalog 全体を宣言しておく。
  assert.equal(entry.filter[0], '**/*');

  const selected = new Set();
  const violations = checkDistribution({ build: { extraResources: [entry] } }, {
    readBytes(file) {
      selected.add(relative(catalogRoot, file).split(sep).join('/'));
      return readFileSync(file);
    },
  });
  assert.deepEqual(violations, []);

  const all = catalogFiles().map(file => relative(catalogRoot, file).split(sep).join('/'));
  const excluded = name => /^audio\/akari-sounds-[^/]+\//u.test(name) || name === 'audio/INDEX.md';
  assert.deepEqual([...selected].sort(), all.filter(name => !excluded(name)).sort());
  const fonts = all.filter(name => name.startsWith('font/'));
  assert.ok(fonts.length > 0);
  assert.ok(fonts.every(name => selected.has(name)));
  assert.ok(selected.has('browser/browser-engines.json'));
  assert.ok(![...selected].some(name => readFileSync(join(catalogRoot, name)).includes('LicenseRef-AKARI-')));
});
