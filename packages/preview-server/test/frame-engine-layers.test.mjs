import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');

test('frame engine evaluation table supplies edit layers and keeps unsupported scope accurate', () => {
  assert.match(source, /layers:\s*\(Array\.isArray\(edit\?\.layers\)/u);
  assert.match(source, /cuts \+ layers/u);
  assert.doesNotMatch(source, /未対応: layers/u);
  assert.match(source, /plan\.base\.length === 0 && plan\.layers\.length === 0/u);
  assert.match(source, /CachedStillImageSource/u);
});
