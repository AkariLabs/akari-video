import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const readJson = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false })
  .compile(await readJson('../edit.schema.json'));
const validPath = '../examples/edit-v2-caption-animator-valid/';
const invalidPath = '../examples/edit-v2-caption-animator-unknown-ref-invalid/';

test('caption animator valid example accepts chars ramp with two offset keyframes', async () => {
  const edit = await readJson(`${validPath}edit.json`);
  assert.equal(validate(edit), true, JSON.stringify(validate.errors));
  const item = edit.tracks[0].items[0];
  assert.equal(item.source.kind, 'captions');
  assert.equal(item.animator[0].basis, 'chars');
  assert.equal(item.animator[0].shape, 'ramp');
  assert.deepEqual(item.keyframes.map(point => [point.t, point.animator.a1.offset]), [[0, -0.3], [15, 1]]);
});

test('caption animator invalid example isolates an unknown reference, not a schema violation', async () => {
  const valid = await readJson(`${validPath}edit.json`);
  const invalid = await readJson(`${invalidPath}edit.json`);
  // JSON Schema validates shape; edit-lint owns references scoped to an item.
  assert.equal(validate(invalid), true, JSON.stringify(validate.errors));
  const point = invalid.tracks[0].items[0].keyframes[1];
  assert.deepEqual(Object.keys(point.animator), ['missing']);
  point.animator.a1 = point.animator.missing;
  delete point.animator.missing;
  assert.deepEqual(invalid, valid);
  assert.deepEqual(await readJson(`${invalidPath}captions.json`), await readJson(`${validPath}captions.json`));
});
