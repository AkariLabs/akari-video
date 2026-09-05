import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INSPECTOR_LUT_PRESET_IDS } from '../lib/browser/inspector/adjust-fields.js';

function parseLutIds(jsonl) {
  return jsonl.split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line))
    .filter(entry => entry.kind === 'lut').map(entry => entry.id);
}

const catalog = readFileSync(new URL('../../../../../presets/luts/index.jsonl', import.meta.url), 'utf8');

test('inspector LUT presets match the catalog in order', () => {
  assert.deepEqual([...INSPECTOR_LUT_PRESET_IDS], parseLutIds(catalog));
});

test('a missing LUT is named in the synchronization assertion diff', () => {
  const missing = 'film-warm';
  const sample = catalog.split(/\r?\n/u)
    .filter(line => line.trim() && JSON.parse(line).id !== missing).join('\n');
  assert.throws(() => assert.deepEqual(parseLutIds(sample), [...INSPECTOR_LUT_PRESET_IDS]), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.ok(error.message.includes(missing), error.message);
    return true;
  });
});
