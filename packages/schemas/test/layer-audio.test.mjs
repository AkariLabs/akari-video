import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const layer = () => ({ id: 'pip', kind: 'video', src: 'pip.mov', t: 1, duration: 3 });
const compile = useDefaults => new Ajv2020({ strict: false, useDefaults }).compile({
  $defs: schema.$defs, $ref: '#/$defs/layerItem',
});
test('legacy layer audio omission stays valid and defaults to audible at 0 dB', () => {
  const value = layer(), before = JSON.stringify(value);
  assert.equal(compile(false)(value), true);
  assert.equal(JSON.stringify(value), before);
  assert.equal(compile(true)(value), true);
  assert.equal(value.audio, true);
  assert.equal(value.gain_db, 0);
});
test('layer audio accepts booleans and gain endpoints, rejecting wrong types and ranges', () => {
  const validate = compile(false);
  for (const audio of [true, false]) for (const gain_db of [-60, 0, 12]) {
    assert.equal(validate({ ...layer(), audio, gain_db }), true);
  }
  for (const audio of [0, null, 'false']) assert.equal(validate({ ...layer(), audio }), false);
  for (const gain_db of [-60.1, 12.1, null, '0']) assert.equal(validate({ ...layer(), gain_db }), false);
});
