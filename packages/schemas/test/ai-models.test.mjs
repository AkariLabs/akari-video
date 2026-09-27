import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const base = new URL('../', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, base), 'utf8'));

test('AI model supplements satisfy schema and keep source values in their sources', async () => {
  const [schema, catalog] = await Promise.all([read('ai-models.schema.json'), read('ai-models.json')]);
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  for (const row of catalog.models.filter(row => row.ref)) {
    for (const field of ['inputs', 'outputs', 'price']) assert.equal(field in row, false, `${row.id}: ${field}`);
  }
  assert.equal(catalog.models.some(row => row.id.includes('qwen-image-2.1')), false);
});

test('maker badges cover every model maker', async () => {
  const [catalog, makers] = await Promise.all([read('ai-models.json'), read('ai-makers.json')]);
  assert.deepEqual([...new Set(catalog.models.map(row => row.maker))].filter(key => !makers[key]), []);
  for (const maker of Object.values(makers)) {
    assert.match(maker.initials, /^.{1,2}$/u);
    assert.match(maker.background, /^#[0-9a-fA-F]{6}$/);
    assert.match(maker.color, /^#[0-9a-fA-F]{6}$/);
  }
});

test('the sole edited generation price keeps its schema shape', async () => {
  const [schema, catalog] = await Promise.all([read('gen-models.schema.json'), read('gen-models.json')]);
  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalog.models.find(row => row.id === 'fal:seedance-2.5-i2v').price,
    { unit: 'usd_per_second', by_resolution: { '480p': 0.2205, '720p': 0.473 }, audio_multiplier: null });
});
