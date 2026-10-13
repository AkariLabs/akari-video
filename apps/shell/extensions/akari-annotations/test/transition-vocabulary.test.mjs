import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/transition-picker.ts', import.meta.url), 'utf8');
const { TRANSITION_FAMILIES, TRANSITION_VOCABULARY } = createRequire(import.meta.url)(
  '../../../../../packages/edit-store/lib/index.js'
);

test('トランジション選択 UI は正準 29 種を 15 family にまとめる', () => {
  assert.equal(TRANSITION_VOCABULARY.length, 29);
  assert.equal(TRANSITION_FAMILIES.length, 15);
  assert.match(source, /for \(const definition of TRANSITION_FAMILIES\)/u);
  assert.match(source, /card\.dataset\.akariTransitionFamily = definition\.family/u);
  assert.match(source, /card\.dataset\.akariTransitionType = type/u);
  assert.match(source, /transitionFamilyLabelKey\(definition\.family\)/u);
});

test('既存 5 種の名称は維持する', () => {
  const labels = Object.fromEntries(TRANSITION_VOCABULARY.map(entry => [entry.id, entry.labelJa]));
  assert.equal(labels.dissolve, 'ディゾルブ');
  assert.equal(labels['fade-black'], '黒フェード');
  assert.equal(labels['fade-white'], '白フェード');
  assert.equal(labels['reveal-down'], '上からリビール');
  assert.equal(labels['reveal-up'], '下からリビール');
});
