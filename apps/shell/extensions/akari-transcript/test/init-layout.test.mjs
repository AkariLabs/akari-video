import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'utf8');

test('初期レイアウトは台本だけを右レールに構成する', () => {
  assert.match(source, /guardInitLayout\('akari-transcript'/);
  assert.match(source, /daihon = await this\.ensureWidget\(\)/);
  assert.match(source, /widget\.configure\(\)\.catch/);
  assert.doesNotMatch(source, /ensureCutsWidget|AkariCutsWidget/);
});
