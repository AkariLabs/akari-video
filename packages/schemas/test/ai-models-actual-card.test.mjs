import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const read = async name => JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));

test('品質の既定値と AKARI の寸法を schema が検査する', async () => {
  const [schema, catalog] = await Promise.all([read('ai-models.schema.json'), read('ai-models.json')]);
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  const change = mutate => {
    const copy = structuredClone(catalog);
    mutate(copy.models.find(row => row.id === 'fal:gpt-image-2.5-flare'));
    assert.equal(validate(copy), false);
  };
  change(row => { delete row.price.default_quality; });
  change(row => { row.price.default_quality = 'auto'; });
  change(row => { row.outputs.akari_sizes['16:9'] = '1088×608'; });
  change(row => { row.outputs.akari_sizes['16:9'] = '0x608'; });
});
