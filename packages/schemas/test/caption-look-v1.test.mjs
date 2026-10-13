import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../captions.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false, formats: { 'date-time': true } }).compile(schema);
const row = extra => ({ id: 'c-0001', start: 0, end: 2, text: '猫', speaker: null,
  sourceRef: null, edited: false, ...extra });

test('スキーマ: runs v1 と unresolved_runs と style_sources を受理する', () => {
  const run = { id: 'r-0001', from: 0, to: 1, look: { color: '#fff', scale: 1.5,
    background: { color: '#000', opacity: 1 } }, motion: { in: { id: 'pop' } },
    emotion: 'joy', anchor: { src: 's1', start: 0, end: 1, domain: 'source' }, fire: 'spoken',
    style_sources: { look: { kind: 'builtin', id: 'sample', original_hash: 'a', applied_hash: 'b' } },
    needs_review: false, split_from: 'r-0002', migrated_from: 'e-0001',
    migrated_emphasis: { index: 2, item: { id: 'e-0001', word: '猫', src: 's1',
      t_start: 0, t_end: 1, emotion: 'joy', note: '追加項目' } },
    dormant_animation: { loop: { id: 'float' } } };
  const root = { captions: [row({ runs: [run], style_sources: run.style_sources })],
    unresolved_runs: [{ run, old_caption_id: 'c-0002', old_text: '猫', old_src: 's1',
      old_start: 0, old_end: 1, reason: '行が消えた' }] };
  assert.equal(validate(root), true, JSON.stringify(validate.errors));
});

test('スキーマ: runs v0 の style と animation を引き続き受理する', () => {
  assert.equal(validate([row({ runs: [{ from: 0, to: 1, style: { color: '#fff' },
    animation: { in: { id: 'pop' } } }] })]), true, JSON.stringify(validate.errors));
});

test('スキーマ: 範囲の effect と sfx を拒否する', () => {
  for (const part of ['effect', 'sfx']) {
    assert.equal(validate([row({ runs: [{ id: 'r-0001', from: 0, to: 1, [part]: { id: 'x' } }] })]), false);
  }
});

test('スキーマ: 範囲の font_family と size_px を拒否する', () => {
  for (const field of ['font_family', 'size_px']) {
    assert.equal(validate([row({ runs: [{ id: 'r-0001', from: 0, to: 1, look: { [field]: 'x' } }] })]), false);
  }
});

test('スキーマ: v1 の run は id の形式を要求する', () => {
  assert.equal(validate([row({ runs: [{ from: 0, to: 1, look: { color: '#fff' } }] })]), false);
  assert.equal(validate([row({ runs: [{ id: 'r-1', from: 0, to: 1, look: { color: '#fff' } }] })]), false);
});
