import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../asset-meta.schema.json', import.meta.url)));
const validate = new Ajv2020({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/license' });
const old = { spdx: 'CC0-1.0', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: true };

test('legacy license remains valid; optional axes accept only the declared values', () => {
  assert.equal(validate(old), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...old, commercial: 'prohibited', attributionRequired: null }), true);
  assert.equal(validate({ ...old, commercial: 'maybe' }), false);
  assert.equal(validate({ ...old, attributionRequired: 'yes' }), false);
});
