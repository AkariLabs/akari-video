import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  TRANSITION_BY_ID,
  TRANSITION_CATEGORIES,
  TRANSITION_TYPE_IDS,
  TRANSITION_VOCABULARY,
  isTransitionType,
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

test('schema enum と render-cut xfade 表は正準表から 1 種消しても検知できる完全一致', () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, 'packages', 'schemas', 'edit.schema.json'), 'utf8'));
  assert.deepEqual(schema.$defs.transitionOut.properties.type.enum, TRANSITION_TYPE_IDS);

  const planSource = readFileSync(join(repoRoot, 'packages', 'render-cut', 'src', 'plan.mjs'), 'utf8');
  const block = planSource.slice(
    planSource.indexOf('const XFADE_TRANSITION_NAMES = {'),
    planSource.indexOf('\n};', planSource.indexOf('const XFADE_TRANSITION_NAMES = {')) + 3
  );
  const actual = {};
  for (const match of block.matchAll(/^\s*(?:"([^"]+)"|([a-z][\w-]*)):\s*"([^"]+)",/gmu)) {
    actual[match[1] ?? match[2]] = match[3];
  }
  assert.deepEqual(actual, Object.fromEntries(
    TRANSITION_VOCABULARY.map(entry => [entry.id, entry.xfadeName])
  ));
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

test('非 JSON 消費者は正準表の import を使い手書き enum を持たない', () => {
  const consumers = [
    ['packages/edit-store/src/edit-store.ts', /isTransitionType/u],
    ['packages/edit-lint/src/edit-lint.mjs', /TRANSITION_TYPE_IDS/u],
    ['packages/schemas/bin/validate-edit.mjs', /TRANSITION_TYPE_IDS/u],
    ['apps/shell/extensions/akari-preview/src/common/edit-summary-fields.ts', /isTransitionType/u],
    ['apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts', /TRANSITION_VOCABULARY/u],
    ['apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts', /TRANSITION_VOCABULARY/u],
    ['apps/shell/extensions/akari-annotations/src/common/akari-annotations-protocol.ts', /TransitionType/u],
  ];
  for (const [relativePath, expected] of consumers) {
    assert.match(readFileSync(join(repoRoot, relativePath), 'utf8'), expected, relativePath);
  }
});
