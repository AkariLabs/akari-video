import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFlyToSelector,
  FLY_TO_ATTRIBUTES,
  isFlyToTargetKind,
  resolveFlyToMatch
} from '../lib/common/companion-fly-to-targets.js';

test('6 種類の対象と属性対応を固定する', () => {
  assert.deepEqual(Object.keys(FLY_TO_ATTRIBUTES).sort(), [
    'catalogCard', 'daihonRow', 'inspectorField', 'menuSection', 'previewItem', 'timelineItem'
  ]);
  assert.deepEqual(FLY_TO_ATTRIBUTES.previewItem, []);
  assert.equal(isFlyToTargetKind('daihonRow'), true);
  assert.equal(isFlyToTargetKind('unknown'), false);
});

test('属性値の完全一致セレクタを組み立てる', () => {
  assert.equal(buildFlyToSelector('daihonRow', 'row-1', value => value), '[data-caption-id="row-1"]');
  const selector = buildFlyToSelector('catalogCard', 'asset-1', value => `escaped-${value}`);
  for (const attribute of FLY_TO_ATTRIBUTES.catalogCard) {
    assert.match(selector, new RegExp(`\\[${attribute}="escaped-asset-1"\\]`));
  }
  assert.equal(selector.split(', ').length, 5);
});

test('ちょうど 1 件が可視の場合だけ確定する', () => {
  assert.equal(resolveFlyToMatch([]), false);
  assert.equal(resolveFlyToMatch([{ visible: true }]), true);
  assert.equal(resolveFlyToMatch([{ visible: false }]), false);
  assert.equal(resolveFlyToMatch([{ visible: true }, { visible: true }]), false);
  assert.equal(resolveFlyToMatch([{ visible: true }, { visible: false }]), false);
});
