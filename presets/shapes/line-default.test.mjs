import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { generateIndexText, indexText } from './generate.mjs';

const require = createRequire(import.meta.url);
const { shapeSourceFromPreset } = require('../../packages/edit-store/lib/shape-preset.js');

test('new line presets place at 10px without changing other shape defaults', () => {
  assert.equal(generateIndexText(), indexText);
  assert.equal(readFileSync(new URL('./index.jsonl', import.meta.url), 'utf8'), indexText);
  const rows = indexText.trimEnd().split('\n').map(JSON.parse);
  const lines = rows.filter(row => row.kind === 'line');
  assert.equal(lines.length, 45);
  assert.ok(lines.every(row => row.defaults.strokeWidth === 10));
  const placed = shapeSourceFromPreset(lines[0], new Map(rows.map(row => [row.id, row])));
  assert.equal(placed.params.strokeWidth, 10);
  assert.equal(rows.find(row => row.kind === 'stroke').defaults.strokeWidth, 4);
  assert.equal(rows.find(row => row.kind === 'bubble').defaults.strokeWidth, 5);
});
