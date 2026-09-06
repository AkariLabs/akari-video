import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { validAdjust, invalidAdjustCases } from './fixtures/adjust-v1-cases.mjs';

const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/adjustV1' });
test('adjustV1 accepts all sections and boundary values', () => {
  assert.equal(validate(validAdjust), true, JSON.stringify(validate.errors));
  for (const section of ['curves', 'wheels', 'hue']) assert.equal(validate({ sections: { [section]: false } }), true);
});
for (const [name, adjust, , check] of invalidAdjustCases.filter(row => row[3] !== 'order')) {
  test('schema rejects ' + name, () => assert.equal(validate(adjust), false));
}
for (const [name, path] of [['valid', null], ['order-invalid', 'adjust.curves.master[1].in'], ['wheels-invalid', 'adjust.wheels.lift.r'], ['hue-empty-invalid', 'adjust.hue.sat'], ['unknown-invalid', 'adjust.curves.master[0].extra']]) {
  test('validate-edit CLI adjust v1 ' + name, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/validate-edit.mjs', import.meta.url)), fileURLToPath(new URL('../examples/edit-v2-adjust-v1-' + name + '/edit.json', import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, path ? 1 : 0, result.stderr || String(result.error));
    if (path) assert.ok(result.stderr.includes(path), result.stderr);
  });
}
test('all eight look files conform to adjustV1 and exactly match index ids', () => {
  const root = new URL('../../../presets/looks/', import.meta.url);
  const rows = readFileSync(new URL('index.jsonl', root), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map(row => row.id)).size, 8);
  assert.deepEqual(readdirSync(root).filter(name => name.endsWith('.json')).sort(), rows.map(row => row.id + '.json').sort());
  for (const row of rows) {
    assert.equal(row.kind, 'look');
    for (const key of ['name', 'description', 'when_to_use']) assert.ok(row[key].trim());
    const look = JSON.parse(readFileSync(new URL(row.id + '.json', root), 'utf8'));
    assert.equal(look.id, row.id);
    assert.equal(validate(look.adjust), true, JSON.stringify(validate.errors));
    assert.deepEqual(Object.keys(look.adjust).sort(), ['basic', 'wheels']);
    assert.equal(JSON.stringify(look).includes('vignette'), false);
  }
});
test('capability ledger keeps the two parent adjust rows and the fx row', () => {
  const table = JSON.parse(readFileSync(new URL('../engine-capabilities.json', import.meta.url), 'utf8'));
  const rows = table.fields.filter(row => row.path === 'tracks[].items[].adjust');
  const fx = table.fields.filter(row => row.path === 'tracks[].items[].adjust.fx');
  assert.equal(fx.length, 1);
  assert.deepEqual([fx[0].gpu, fx[0].osr], ['consumed', 'consumed']);
  assert.equal(fx[0].evidence, 'packages/frame-engine/src/compositor/webgl2.ts runFxPasses');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.path === 'tracks[].items[].adjust'));
  assert.deepEqual(rows.map(row => row.applies_to), [['cuts', 'layers', 'baked'], ['overlays', 'captions', 'group']]);
});
