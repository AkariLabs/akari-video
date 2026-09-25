import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { serializeEdit } from '../lib/canonical.js';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'edit-v2.json');
const sample = async () => {
  const value = JSON.parse(await readFile(fixturePath, 'utf8'));
  const item = value.tracks[3].items[0];
  value.sources.push({ id: 'person-mask', path: 'assets/masks/person.png' });
  item.maskFeather = 3;
  item.regions = [{ id: 'person-1', name: '人物 1', maskRef: 'person-mask', adjust: { basic: { exposure: 1 } } },
    { id: 'background', name: '背景', maskRef: 'person-mask', invert: true, adjust: { basic: { saturation: -1 } } }];
  return value;
};

test('regions and mask feather validate and canonical order survives a round trip', async () => {
  const value = await sample();
  const parsed = readEditV2(value);
  const text = serializeEdit(value);
  assert.ok(text.indexOf('"maskFeather"') < text.indexOf('"regions"'));
  assert.ok(text.indexOf('"id": "person-1", "name": "人物 1", "maskRef"') >= 0);
  assert.deepEqual(readEditV2(JSON.parse(text)).tracks[3].items[0].regions, parsed.tracks[3].items[0].regions);
  for (const [path, change] of [
    ['duplicate', item => { item.regions[1].id = 'person-1'; }],
    ['missing', item => { item.regions[0].maskRef = 'unknown'; }],
    ['range', item => { item.maskFeather = 101; }],
    ['filter', item => { item.regions[0].filter = { lut: 'mono', intensity: 2 }; }],
    ['name', item => { item.regions[0].name = ''; }],
  ]) {
    const bad = structuredClone(value); change(bad.tracks[3].items[0]);
    assert.throws(() => readEditV2(bad), /regions|maskFeather/, path);
  }
});
