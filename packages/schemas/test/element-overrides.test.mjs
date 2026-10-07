import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/itemSourceHtmlV2' });
const source = elements => ({ kind: 'html', path: 'a.html', elements });

test('HTML element addresses accept only the declared grammar and style shape', () => {
  assert.equal(validate(source({ '.bar[2]': { style: { height: '260px' } }, '#logo[0]': { style: {} } })), true);
  for (const address of ['div', '.a b[0]', '.bar', '.bar[-1]', '.bar[01]']) {
    assert.equal(validate(source({ [address]: { style: { height: '1px' } } })), false, address);
  }
  assert.equal(validate(source({ '.bar[0]': { style: {}, text: 'future' } })), false);
  assert.equal(validate(source({ '.bar[0]': { style: { height: 260 } } })), false);
});
