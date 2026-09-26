import test from 'node:test';
import assert from 'node:assert/strict';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor } from '../lib/browser/inspector/ai-tiles.js';
import { tabsForKind } from '../lib/browser/inspector/tab-model.js';

const models = [{ id: 'fal:h3-i2v', kind: 'video', provider: 'fal', family: 'MiniMax H3', price: { by_resolution: { '768P': 0.1 } } }];
const catalog = aiActionCatalog(models);

test('AI 行為カタログは動画モデルから実働 route を作る', () => {
  assert.deepEqual(catalog.map(row => [row.id, row.group, row.output, row.placement]),
    [['still', 'make', 'image', 'replace'], ['video', 'make', 'video', 'replace'],
      ['transcribe', 'refine', 'captions', 'captions']]);
  assert.deepEqual(catalog[1].routes, [{ id: 'fal:h3-i2v', label: 'MiniMax H3', kind: 'api', cost: 'paid' }]);
  assert.deepEqual(aiActionCatalog(models.filter(row => row.kind !== 'video'))[1].routes, []);
});

for (const [name, target, count, stillEnabled, videoEnabled, videoReason] of [
  ['静止画', 'still', 2, true, true, undefined],
  ['空の枠', 'empty-frame', 2, true, true, undefined],
  ['ふつうの動画', 'video', 2, false, false, '静止画か空の枠で使えます'],
  ['生成済み動画', 'generated-video', 2, false, true, undefined],
  ['音声', 'audio', 1, undefined, undefined, undefined]
]) {
  test(`describeAiTiles: ${name}`, () => {
    const groups = describeAiTiles(catalog, target);
    assert.equal(groups.length, count);
    if (target !== 'audio') assert.deepEqual(groups[0], { group: 'make', tiles: [
      { id: 'still', label: '静止画', image: 'still', enabled: stillEnabled,
        ...(!stillEnabled ? { reason: '空の枠か静止画で使えます' } : {}) },
      { id: 'video', label: '動画にする', image: 'video', enabled: videoEnabled,
        ...(videoReason ? { reason: videoReason } : {}) }
    ] });
    assert.deepEqual(groups[target === 'audio' ? 0 : 1], { group: 'refine', tiles: [{
      id: 'transcribe', label: '文字起こし', image: 'transcribe', enabled: target === 'video' || target === 'audio',
      ...(target === 'video' || target === 'audio' ? {} : { reason: '声の入った音声か動画で使えます' })
    }] });
  });
}

test('describeAiTiles: routes が空の行とタイル 0 枚のグループは出ない', () => {
  const empty = { ...catalog[0], routes: [] };
  assert.deepEqual(describeAiTiles([empty], 'still'), []);
  assert.deepEqual(describeAiTiles(catalog, 'still').map(group => group.group), ['make', 'refine']);
});

for (const [name, input, expected] of [
  ['identity なしは動画', { hasIdentity: false }, 'video'],
  ['identity なしは拡張子に依存しない', { hasIdentity: false, generationState: 'planned' }, 'video'],
  ['通常 identity は静止画', { hasIdentity: true }, 'still'],
  ['planned は空の枠', { hasIdentity: true, generationState: 'planned' }, 'empty-frame'],
  ['生成済みが最優先', { hasIdentity: true, generationDone: true, generationState: 'planned' }, 'generated-video']
]) {
  test(`aiTargetKindFor: ${name}`, () => assert.equal(aiTargetKindFor(input), expected));
}

for (const [name, kind, hasIdentity, groups, expected] of [
  ['動画 cut + route あり', 'cut', false, describeAiTiles(catalog, 'video'), { enabled: true, forcePanel: false }],
  ['動画 layer + route あり', 'layer', false, describeAiTiles(catalog, 'video'), { enabled: true, forcePanel: false }],
  ['動画 item + route あり', 'item', false, describeAiTiles(catalog, 'video'), { enabled: true, forcePanel: false }],
  ['動画 cut + route なし', 'cut', false, [], { enabled: false, forcePanel: false }],
  ['identity + route なし', 'cut', true, [], { enabled: true, forcePanel: true }],
  ['音声 kind は従来どおり', 'audio', false, describeAiTiles(catalog, 'video'), { enabled: false, forcePanel: false }]
]) {
  test(`aiTabAvailabilityFor: ${name}`, () => {
    assert.deepEqual(aiTabAvailabilityFor({ kind, hasIdentity, groups }), expected);
  });
}

test('タブは id edit・表示 ホーム、ふつうの動画 cut でも enabled', () => {
  const tab = tabsForKind('cut', { generationAvailable: true }).find(tab => tab.id === 'edit');
  assert.equal(tab.label, 'ホーム');
  assert.equal(tab.enabled, true);
  assert.equal(tab.disabledTitle, undefined);
});

for (const [name, state, done, expected] of [
  ['planned', 'planned', false, 'tiles'],
  ['生成中', 'generating', false, 'video'],
  ['失敗', 'failed', false, 'video'],
  ['stale', 'stale', false, 'video'],
  ['生成済み', 'done', true, 'video'],
  ['done の静止画 → 一覧', 'done', false, 'tiles'],
  ['done の静止画 + next planned → 一覧', 'done', false, 'tiles'],
  ['画像のまま', 'none', false, 'tiles']
]) {
  test(`aiTabViewFor: ${name}`, () => {
    assert.equal(aiTabViewFor({ clipKey: 'a', generationState: state, generationDone: done }), expected);
  });
}

test('aiTabViewFor: 同じクリップの選び直しは画面を保ち、別クリップは状態から選ぶ', () => {
  assert.equal(aiTabViewFor({ clipKey: 'a', previousClipKey: 'a', previousView: 'video', generationState: 'planned' }), 'video');
  assert.equal(aiTabViewFor({ clipKey: 'a', previousClipKey: 'a', previousView: 'tiles', generationState: 'failed' }), 'tiles');
  assert.equal(aiTabViewFor({ clipKey: 'b', previousClipKey: 'a', previousView: 'video', generationState: 'planned' }), 'tiles');
  assert.equal(aiTabViewFor({ clipKey: 'b', previousClipKey: 'a', previousView: 'tiles', generationState: 'failed' }), 'video');
});

test('aiTabViewFor: route が 0 本で identity があれば以前の一覧より専用パネルを優先', () => {
  assert.equal(aiTabViewFor({ clipKey: 'a', previousClipKey: 'a', previousView: 'tiles', forcePanel: true }), 'video');
});
