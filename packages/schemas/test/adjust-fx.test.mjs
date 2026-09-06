import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { fxExamples, invalidFxCases } from './fixtures/adjust-fx-cases.mjs';

const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/adjustV1' });
for (const { name, check, url, edit } of fxExamples) {
  test('schema adjust fx example: ' + name, () => {
    assert.equal(validate(edit.tracks[0].items[0].adjust), !check, JSON.stringify(validate.errors));
  });
  test('validate-edit CLI adjust fx example: ' + name, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/validate-edit.mjs', import.meta.url)), fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(result.status, check ? 1 : 0, result.stderr || String(result.error));
    if (check) assert.ok(result.stderr.includes(check), result.stderr);
  });
}
test('schema adjust fx rejects closed-vocabulary, structure and range violations even when bypassed', () => {
  for (const [name, adjust] of invalidFxCases) {
    assert.equal(validate(adjust), false, name);
    if (adjust.fx !== undefined) assert.equal(validate({ ...adjust, sections: { fx: false } }), false, name);
  }
});
test('schema adjust fx accepts omission, defaults, empty arrays and inclusive boundaries', () => {
  for (const adjust of [{}, { fx: [] }, { sections: { fx: false } }, {
    fx: [{ id: 'vignette', amount: -1, midpoint: 0, roundness: -1, feather: 1 }, { id: 'blur', px: 50 }, { id: 'grain', amount: 1, size: 0.5 }, { id: 'sharpen', amount: 0 }],
  }, { fx: [{ id: 'vignette' }, { id: 'blur' }, { id: 'grain' }, { id: 'sharpen' }] }]) {
    assert.equal(validate(adjust), true, JSON.stringify(validate.errors));
  }
});
