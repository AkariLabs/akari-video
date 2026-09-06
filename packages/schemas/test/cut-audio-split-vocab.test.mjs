import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../edit.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const fixture = suffix => JSON.parse(readFileSync(new URL(
  `../examples/edit-v2-cut-audio-${suffix}/edit.json`, import.meta.url,
), 'utf8'));

for (const [suffix, valid] of [
  ['split-valid', true], ['link-missing-invalid', true],
  ['link-not-media-invalid', true], ['link-duplicate-invalid', true], ['true-invalid', false],
]) {
  test(`cut audio schema: ${suffix} is ${valid ? 'valid' : 'invalid'}`, () => {
    assert.equal(validate(fixture(suffix)), valid, JSON.stringify(validate.errors));
  });
}

test('cut audio fields retain their exact schema vocabulary and do not add defaults', () => {
  assert.deepEqual(schema.$defs.itemV2Media.properties.audio, { const: false });
  assert.deepEqual(schema.$defs.itemV2AudioMedia.properties.link, { type: 'string', minLength: 1, pattern: '\\S' });
  assert.deepEqual(schema.$defs.itemV2AudioMedia.properties.mute, { type: 'boolean' });
  assert.deepEqual(schema.$defs.itemV2AudioMedia.properties.role.enum, ['sfx', 'narration', 'bgm', 'speech']);
});

test('cut audio schema rejects wrong types and fields on the wrong item or source', () => {
  for (const value of [true, null, 0, 'false', {}]) {
    const doc = fixture('split-valid');
    doc.tracks[0].items[0].audio = value;
    assert.equal(validate(doc), false, `audio: ${JSON.stringify(value)}`);
  }
  for (const [field, values] of [['link', ['', ' \t\n', null, false, 7, {}]], ['mute', [null, 0, 'false', {}]]]) {
    for (const value of values) {
      const doc = fixture('split-valid');
      doc.tracks[1].items[0][field] = value;
      assert.equal(validate(doc), false, `${field}: ${JSON.stringify(value)}`);
    }
  }
  for (const source of [
    { kind: 'html', path: 'overlay.html' }, { kind: 'group' },
    { kind: 'shape', shape: 'rect' }, { kind: 'telop', preset: 'title' },
    { kind: 'filter', filter: { type: 'invert' } }, { kind: 'captions', path: 'captions.json' },
    { kind: 'caption', path: 'captions.json', id: 'c-0001' },
  ]) {
    const doc = fixture('split-valid');
    doc.tracks[0].items[0].source = source;
    assert.equal(validate(doc), false, `${source.kind}.audio`);
    assert.ok(validate.errors.some(error => error.keyword === 'additionalProperties'
      && error.params.additionalProperty === 'audio'));
  }
  for (const [track, field, value] of [[0, 'link', 'cut'], [0, 'mute', false], [0, 'role', 'speech'], [1, 'audio', false]]) {
    const doc = fixture('split-valid');
    doc.tracks[track].items[0][field] = value;
    assert.equal(validate(doc), false, `track ${track}: ${field}`);
  }
  for (const [field, value] of [['audio', false], ['link', 'cut'], ['mute', false]]) {
    const doc = fixture('split-valid');
    doc.tracks[1].items[0].source[field] = value;
    assert.equal(validate(doc), false, `audio source.${field}`);
  }
});

test('cut audio schema accepts both mute booleans and independent unlinked speech', () => {
  for (const mute of [true, false]) {
    const doc = fixture('split-valid');
    doc.tracks[1].items[0].mute = mute;
    delete doc.tracks[1].items[0].link;
    assert.equal(validate(doc), true, JSON.stringify(validate.errors));
  }
});
