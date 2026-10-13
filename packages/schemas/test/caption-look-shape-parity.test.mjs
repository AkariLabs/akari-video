import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../captions.schema.json', import.meta.url), 'utf8'));
const schemaAccepts = new Ajv2020({ strict: false }).compile(schema);
const { validateCaptionLookV1Shape, CAPTION_LOOK_SHAPE_KEYS,
  CAPTION_LOOK_SHAPE_ANIMATION_IDS } = createRequire(import.meta.url)('../../edit-store/lib/caption-look-shape.js');
const row = extra => ({ id: 'c-0001', start: 0, end: 2, text: '猫', speaker: null,
  sourceRef: null, edited: false, ...extra });
const make = run => ({ captions: [row({ runs: [run] })] });
const base = () => ({ id: 'r-0001', from: 0, to: 1, look: { color: '#fff' } });
const change = (fn) => { const run = base(); fn(run); return make(run); };

const examples = [
  ['fire が bogus', change(run => { run.fire = 'bogus'; })],
  ['id が zzz', change(run => { run.id = 'zzz'; })],
  ['look が数値', change(run => { run.look = 5; })],
  ['look に id がない', change(run => { delete run.id; })],
  ['anchor が文字列', change(run => { run.anchor = 'x'; })],
  ['unresolved_runs が文字列', { ...make(base()), unresolved_runs: 'x' }],
  ['正しい v1 の look', make(base())],
  ['正しい v1 の motion', change(run => { run.motion = { in: { id: 'pop' } }; })],
  ['正しい v1 の anchor', change(run => { run.anchor = { start: 0, end: 1, domain: 'source' }; })],
  ['正しい v1 の出所', change(run => { run.style_sources = { look: {
    kind: 'my', id: 'x', original_hash: 'a', applied_hash: 'b' } }; })],
  ['正しい v0 の style', make({ from: 0, to: 1, style: { color: '#fff' } })],
  ['正しい v0 の animation', make({ from: 0, to: 1, animation: { in: { id: 'pop' } } })],
];

for (const [name, value] of examples) test(`スキーマと手書きの形の検査が一致する: ${name}`, () => {
  const schemaRejects = !schemaAccepts(value);
  const shapeRejects = validateCaptionLookV1Shape(value).some(item => item.severity === 'error');
  assert.equal(shapeRejects, schemaRejects, JSON.stringify(schemaAccepts.errors));
});

test('v1 の鍵の集合がスキーマと手書きの検査で一致する', () => {
  for (const [name, definition] of Object.entries({ run: 'captionRun', look: 'captionRunLook',
    anchor: 'captionRunAnchor', styleSources: 'styleSources', source: 'styleSource',
    unresolvedRun: 'unresolvedRun' })) {
    assert.deepEqual([...CAPTION_LOOK_SHAPE_KEYS[name]].sort(),
      Object.keys(schema.$defs[definition].properties).sort(), name);
  }
});

test('動きの id はスキーマの enum の全値だけを通す', () => {
  const ids = schema.$defs.textAnimationId.enum;
  assert.deepEqual([...CAPTION_LOOK_SHAPE_ANIMATION_IDS].sort(), [...ids].sort());
  for (const id of [...ids, '存在しない動き']) {
    const value = change(run => { run.motion = { in: { id } }; });
    assert.equal(schemaAccepts(value), ids.includes(id));
    assert.equal(validateCaptionLookV1Shape(value).some(item => item.severity === 'error'), !ids.includes(id));
  }
});

const lookValues = {
  color: ['#fff', 'red'], font_weight: [700, 0], italic: [true, 1], underline: [true, 1],
  letter_spacing_em: [0.2, 'x'], scale: [1.2, 0], baseline_shift_em: [0.1, 'x'],
  rotate_deg: [15, 181], stroke: [{ color: '#fff', width_px: 2 }, 5],
  shadow: [{ color: '#fff', blur_px: 1 }, 5], glow: [{ color: '#fff', spread: 2 }, 5],
  background: [{ color: '#fff', padding_px: 2 }, 5]
};
for (const [key, [valid, invalid]] of Object.entries(lookValues)) {
  test(`範囲の見た目 ${key} の正しい値と壊れた値を同じく判定する`, () => {
    for (const [value, rejected] of [[valid, false], [invalid, true]]) {
      const document = change(run => { run.look = { [key]: value }; });
      assert.equal(!schemaAccepts(document), rejected, JSON.stringify(schemaAccepts.errors));
      assert.equal(validateCaptionLookV1Shape(document).some(item => item.severity === 'error'), rejected);
    }
  });
}
