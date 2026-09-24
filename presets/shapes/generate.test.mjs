import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { generateIndexText, indexText } from './generate.mjs';

test('catalog generation is byte identical and has 219 shapes, 45 lines, and 12 bubbles', () => {
  const disk = readFileSync(new URL('./index.jsonl', import.meta.url), 'utf8');
  assert.equal(generateIndexText(), generateIndexText());
  assert.equal(indexText, disk);
  const rows = indexText.trimEnd().split('\n').map(JSON.parse);
  assert.equal(rows.length, 276);
  assert.equal(rows.filter((r) => r.kind === 'line').length, 45);
  assert.equal(rows.filter((r) => r.kind === 'bubble').length, 12);
  assert.equal(rows.filter((r) => r.kind !== 'line').length, 231);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.equal(rows.filter((r) => !['line', 'bubble'].includes(r.kind)).length, 219);
});
