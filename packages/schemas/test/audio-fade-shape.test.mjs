import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);
const fixture = () => JSON.parse(readFileSync(new URL(
  '../examples/edit-v2-cut-audio-split-valid/edit.json', import.meta.url
), 'utf8'));

test('audio fade shape vocabulary is optional and closed for v2 and legacy', () => {
  for (const definition of ['itemV2AudioMedia', 'bgm', 'sfxItem']) {
    for (const field of ['fade_in_shape', 'fade_out_shape']) {
      assert.deepEqual(schema.$defs[definition].properties[field].enum,
        ['linear', 'equal_power', 's_curve', 'slow']);
    }
  }
  const doc = fixture();
  const audio = doc.tracks.find(track => track.lane === 'audio').items[0];
  const original = JSON.stringify(doc);
  assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  assert.equal(JSON.stringify(doc), original);
  for (const shape of ['linear', 'equal_power', 's_curve', 'slow']) {
    audio.fade_in_shape = shape;
    audio.fade_out_shape = shape;
    assert.equal(validate(doc), true, `${shape}: ${JSON.stringify(validate.errors)}`);
  }
  audio.fade_in_shape = 'exp';
  assert.equal(validate(doc), false);
});
