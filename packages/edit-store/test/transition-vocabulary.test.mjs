import { readHandlerSource } from '../../../apps/shell/extensions/akari-preview/test/helpers/handler-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readLintSourceSync } from '../../edit-lint/test/helpers/read-lint-source.mjs';

import {
  TRANSITION_BY_ID,
  TRANSITION_CATEGORIES,
  TRANSITION_FAMILIES,
  TRANSITION_TYPE_IDS,
  TRANSITION_VOCABULARY,
  isTransitionType,
  transitionDirectionLabelKey,
  transitionFamilyLabelKey,
  transitionFamilyOf,
  transitionTypeOf,
  setCutTransitionOutInSource,
} from '../lib/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');

test('正準表は 29 種・8 カテゴリで id / xfade 名が一意', () => {
  assert.equal(TRANSITION_VOCABULARY.length, 29);
  assert.equal(new Set(TRANSITION_TYPE_IDS).size, 29);
  assert.equal(new Set(TRANSITION_VOCABULARY.map(entry => entry.xfadeName)).size, 29);
  assert.deepEqual(TRANSITION_CATEGORIES, [
    'フェード', 'ワイプ', 'スライド', 'カバー', 'リビール', '形状', '変形', '質感'
  ]);
  for (const entry of TRANSITION_VOCABULARY) {
    assert.equal(TRANSITION_BY_ID[entry.id], entry);
    assert.equal(isTransitionType(entry.id), true);
  }
  assert.equal(isTransitionType('future-transition'), false);
  assert.equal(TRANSITION_BY_ID.blur.previewKind, 'blur');
  assert.equal(TRANSITION_BY_ID.pixelize.previewKind, 'pixelize');
  assert.equal(TRANSITION_BY_ID.dissolve.previewKind, 'dissolve');
});

test('family は向き違いをまとめた 15 件で、29 種すべてへ往復できる', () => {
  assert.deepEqual(TRANSITION_FAMILIES.map(entry => entry.family), [
    'dissolve', 'fade', 'fade-black', 'fade-white', 'fade-grays', 'wipe', 'radial',
    'slide', 'cover', 'reveal', 'circle', 'zoom-in', 'squeeze', 'blur', 'pixelize'
  ]);
  const directions = Object.fromEntries(TRANSITION_FAMILIES.map(entry => [entry.family, entry.directions]));
  for (const family of ['wipe', 'slide', 'cover', 'reveal']) {
    assert.deepEqual(directions[family], ['left', 'right', 'up', 'down']);
  }
  assert.deepEqual(directions.circle, ['open', 'close']);
  assert.deepEqual(directions.squeeze, ['h', 'v']);
  assert.deepEqual(directions.fade, []);
  const reached = new Set();
  for (const { family, directions: list } of TRANSITION_FAMILIES) {
    for (const direction of list.length > 0 ? list : [undefined]) {
      const type = transitionTypeOf(family, direction);
      assert.equal(isTransitionType(type), true, `${family} ${direction}`);
      assert.deepEqual(transitionFamilyOf(type), direction ? { family, direction } : { family });
      reached.add(type);
    }
  }
  assert.equal(reached.size, 29);
  assert.equal(transitionTypeOf('slide'), undefined);
  assert.equal(transitionTypeOf('fade', 'left'), undefined);
  assert.equal(transitionTypeOf('future'), undefined);
  assert.equal(transitionFamilyOf('future-transition'), undefined);
});

test('family と向きの名前は辞書に ja / en の両方がある', () => {
  for (const language of ['ja', 'en']) {
    const catalog = JSON.parse(readFileSync(join(repoRoot, 'packages', 'i18n', 'locales', language, 'transition.json'), 'utf8'));
    for (const { family, directions } of TRANSITION_FAMILIES) {
      assert.equal(typeof catalog[transitionFamilyLabelKey(family)], 'string', `${language} ${family}`);
      for (const direction of directions) {
        assert.equal(typeof catalog[transitionDirectionLabelKey(direction)], 'string', `${language} ${direction}`);
      }
    }
  }
  assert.equal(transitionFamilyLabelKey('fade-black'), 'transition.family.label.fadeBlack');
});

// 33e9250d で legacy 合成経路が撤去され、render-cut の XFADE_TRANSITION_NAMES も削除された。
// 映像トランジションの実装は frame-engine の compositor/webgl2.ts にある id 分岐へ移った。
// 29 id の全件カバレッジは frame-engine/test/compositor-contract.test.mjs:101 が担う。
test('schema known values are identical to the canonical vocabulary', () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, 'packages', 'schemas', 'edit.schema.json'), 'utf8'));
  assert.deepEqual(schema.$defs.transitionOut.properties.type['x-akari-known-values'], TRANSITION_TYPE_IDS);
});

test('legacy テキスト手術は正準 29 種をすべて保存し、未知種別を拒否する', () => {
  const source = '{"cuts":[{"in":0,"out":1}]}\n';
  for (const type of TRANSITION_TYPE_IDS) {
    const updated = setCutTransitionOutInSource(source, 0, { type, duration: 0.5 });
    assert.deepEqual(JSON.parse(updated).cuts[0].transition_out, { type, duration: 0.5 });
  }
  assert.throws(
    () => setCutTransitionOutInSource(source, 0, { type: 'future-transition', duration: 0.5 }),
    /種別/u
  );
});

test('legacy transition rewrite keeps extra fields in order and can remove the transition', () => {
  const source = '{"cuts":[{"in":0,"out":1,"transition_out":{"type":"future-kind","duration":0.5,"align":"before-cut","x":{"keep":true}}}]}\n';
  const updated = setCutTransitionOutInSource(source, 0, { type: 'dissolve', duration: 0.4 });
  assert.match(updated, /"transition_out":\{"type":"dissolve","duration":0\.4,"align":"before-cut","x":\{"keep":true\}\}/u);
  assert.deepEqual(JSON.parse(updated).cuts[0].transition_out,
    { type: 'dissolve', duration: 0.4, align: 'before-cut', x: { keep: true } });
  assert.equal(JSON.parse(setCutTransitionOutInSource(updated, 0, null)).cuts[0].transition_out, undefined);
  assert.throws(() => setCutTransitionOutInSource(source, 0,
    { type: 'different-future-kind', duration: 0.4 }), /種別/u);
});

test('legacy transition setter writes, clears, and validates position without losing other fields', () => {
  const source = '{"cuts":[{"in":0,"out":1,"transition_out":{"type":"fade","duration":0.5,"align":"future-side","fill":"freeze"}}]}\n';
  const preserved = setCutTransitionOutInSource(source, 0, { type: 'dissolve', duration: 0.4 });
  assert.equal(JSON.parse(preserved).cuts[0].transition_out.align, 'future-side');
  const aligned = setCutTransitionOutInSource(preserved, 0,
    { type: 'dissolve', duration: 0.4, align: 'after-cut' });
  assert.deepEqual(JSON.parse(aligned).cuts[0].transition_out,
    { type: 'dissolve', duration: 0.4, align: 'after-cut', fill: 'freeze' });
  for (const align of ['center', null]) {
    const centered = setCutTransitionOutInSource(aligned, 0,
      { type: 'dissolve', duration: 0.4, align });
    assert.deepEqual(JSON.parse(centered).cuts[0].transition_out,
      { type: 'dissolve', duration: 0.4, fill: 'freeze' });
  }
  assert.throws(() => setCutTransitionOutInSource(source, 0,
    { type: 'dissolve', duration: 0.4, align: 'future-side' }), /位置/u);
});

test('非 JSON 消費者は正準表の import を使い手書き enum を持たない', () => {
  const consumers = [
    ['packages/edit-store/src/edit-store.ts', /isTransitionType/u],
    ['packages/edit-lint/src (concatenated)', /TRANSITION_TYPE_IDS/u],
    ['packages/schemas/bin/validate-edit.mjs', /isNonEmptyString\(value\.type\)/u],
    ['apps/shell/extensions/akari-preview/src/common/edit-summary-fields.ts', /isTransitionType/u],
    ['apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts', /TRANSITION_VOCABULARY/u],
    ['apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts', /TRANSITION_FAMILIES/u],
    ['apps/shell/extensions/akari-annotations/src/common/akari-annotations-protocol.ts', /TransitionType/u],
  ];
  for (const [relativePath, expected] of consumers) {
    const source = relativePath === 'packages/edit-lint/src (concatenated)'
      ? readLintSourceSync()
      : relativePath === 'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts'
        ? readHandlerSource()
        : readFileSync(join(repoRoot, relativePath), 'utf8');
    assert.match(source, expected, relativePath);
  }
});
