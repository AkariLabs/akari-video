import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(join(root, 'edit.schema.json'), 'utf8')));
const example = () => JSON.parse(readFileSync(join(root, 'examples/edit-v2-valid/edit.json'), 'utf8'));

test('photo regions and smoothness are closed and bounded', () => {
  const value = example();
  value.sources.push({ id: 'person-mask', path: 'assets/masks/person.png' });
  const item = value.tracks[3].items[0];
  item.maskFeather = 4;
  item.regions = [{ id: 'person-1', name: '人物 1', maskRef: 'person-mask', adjust: { basic: { exposure: 1 } } }];
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  for (const change of [region => { region.blur = 51; }, region => { region.unknown = true; },
    region => { region.filter = { lut: 'mono', intensity: 2 }; }, region => { region.name = ''; }]) {
    const invalid = structuredClone(value); change(invalid.tracks[3].items[0].regions[0]);
    assert.equal(validate(invalid), false);
  }
});
