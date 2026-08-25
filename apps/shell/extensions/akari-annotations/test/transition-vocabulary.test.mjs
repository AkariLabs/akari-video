import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
const { TRANSITION_CATEGORIES, TRANSITION_VOCABULARY } = createRequire(import.meta.url)(
  '../../../../../packages/edit-store/lib/index.js'
);

test('トランジション選択 UI は正準 29 種と 8 カテゴリから導出する', () => {
  assert.equal(TRANSITION_VOCABULARY.length, 29);
  assert.deepEqual(TRANSITION_CATEGORIES, [
    'フェード', 'ワイプ', 'スライド', 'カバー', 'リビール', '形状', '変形', '質感'
  ]);
  assert.match(source, /const TRANSITION_TYPE_OPTIONS = TRANSITION_VOCABULARY\.map/u);
  assert.match(source, /for \(const category of TRANSITION_CATEGORIES\)/u);
  assert.match(source, /categorySection\.dataset\.akariTransitionCategory = category/u);
  assert.match(source, /button\.dataset\.akariTransitionType = option\.type/u);
});

test('既存 5 種のボタン文言は維持する', () => {
  const labels = Object.fromEntries(TRANSITION_VOCABULARY.map(entry => [entry.id, entry.labelJa]));
  assert.equal(labels.dissolve, 'ディゾルブ');
  assert.equal(labels['fade-black'], '黒フェード');
  assert.equal(labels['fade-white'], '白フェード');
  assert.equal(labels['reveal-down'], '上からリビール');
  assert.equal(labels['reveal-up'], '下からリビール');
});
