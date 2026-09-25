import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { serializeEdit } from '../lib/canonical.js';
import Ajv2020 from 'ajv/dist/2020.js';

const fixture = new URL('./fixtures/edit-v2.json', import.meta.url);

test('photo mask, erase strokes, and flip validate and serialize in a stable order', async () => {
  const edit = JSON.parse(await readFile(fixture, 'utf8'));
  edit.sources.push({ id: 'still-mask', path: 'assets/masks/a.png', proxy: null });
  const item = edit.tracks[3].items[0];
  item.mask = 'still-mask';
  item.erase = [{ mode: 'erase', points: [[0.25, 0.5]], size: 0.1, hardness: 0.8 }];
  item.flip = { h: true, v: false };
  const parsed = readEditV2(edit);
  assert.deepEqual(parsed.tracks[3].items[0].erase, item.erase);
  const schema = JSON.parse(await readFile(new URL('../../schemas/edit.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(edit), true, JSON.stringify(validate.errors));
  const serialized = serializeEdit(edit);
  assert.ok(serialized.indexOf('"flip"') < serialized.indexOf('"mask"'));
  assert.ok(serialized.indexOf('"mask"') < serialized.indexOf('"erase"'));
  const invalid = structuredClone(edit);
  invalid.tracks[3].items[0].erase[0].points[0][0] = 2;
  assert.throws(() => readEditV2(invalid), /erase\[0\]\.points\[0\]\[0\]/u);
});
