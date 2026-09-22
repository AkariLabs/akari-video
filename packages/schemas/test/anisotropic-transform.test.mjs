import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
for (const name of ['cutTransform', 'layerTransform']) {
  const validate = ajv.compile({ $defs: schema.$defs, $ref: `#/$defs/${name}` });
  test(`${name} permits positive axes, rejects zero and negative values`, () => {
    assert.equal(validate({ scale: 3, scaleX: 2, scaleY: .5 }), true);
    for (const axis of ['scaleX', 'scaleY']) for (const value of [0, -1, '2']) assert.equal(validate({ [axis]: value }), false);
  });
}
const group = ajv.compile({ $defs: schema.$defs, $ref: '#/$defs/itemV2Group' });
test('group forbids either explicit axis even when equal', () => {
  const item = { id: 'g', at: 0, duration: 60, source: { kind: 'group' } };
  assert.equal(group({ ...item, transform: { scale: 2 } }), true);
  for (const transform of [{ scaleX: 2 }, { scaleY: 2 }, { scaleX: 2, scaleY: 2 }]) {
    assert.equal(group({ ...item, transform }), false);
    assert.equal(group({ ...item, keyframes: [{ t: 0, transform }, { t: 30, transform: { scale: 2 } }] }), false);
  }
});
