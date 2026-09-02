import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'edit.schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const fixture = name => JSON.parse(readFileSync(join(root, 'examples', name, 'edit.json'), 'utf8'));

test('valid clip FX example accepts canonical v2 source/item placement', () => {
  const value = fixture('edit-audio-clip-fx-valid');
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test('invalid clip FX example rejects ranges, vocabulary, and denoise method', () => {
  const value = fixture('edit-audio-clip-fx-invalid');
  assert.equal(validate(value), false);
  const paths = new Set(validate.errors?.map(error => error.instancePath));
  for (const path of [
    '/audio/bgm/speed', '/audio/bgm/pitch_semitones', '/audio/bgm/formant',
    '/audio/bgm/denoise/method', '/audio/bgm/denoise/strength', '/audio/bgm/lowcut_hz',
  ]) assert.ok(paths.has(path), `${path}\n${JSON.stringify(validate.errors, null, 2)}`);
});
