import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const here = fileURLToPath(new URL('../', import.meta.url));
const load = relative => JSON.parse(fs.readFileSync(path.join(here, relative), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat('date-time', value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value));
const generation = ajv.compile(load('generation-meta.schema.json'));
const asset = ajv.compile(load('asset-meta.schema.json'));

for (const [name, ok] of [['frame-valid', true], ['frame-invalid-kind', false], ['frame-invalid-role', false], ['frame-invalid-hash', false]]) {
  test(`generation meta ${name}`, () => assert.equal(generation(load(`fixtures/generation-meta/${name}.json`)), ok));
}
for (const [name, ok] of [['model-valid', true], ['world-valid', true], ['model-invalid-unit', false], ['world-invalid-kind', false]]) {
  test(`asset meta ${name}`, () => assert.equal(asset(load(`fixtures/asset-meta-frame-scene/${name}.json`)), ok));
}

test('all existing generation fixtures retain their result without frame', () => {
  const names = fs.readdirSync(path.join(here, 'fixtures/generation-meta')).filter(n => n.endsWith('.json') && !n.startsWith('frame-'));
  for (const name of names) assert.equal(generation(load(`fixtures/generation-meta/${name}`)), true, name);
});
