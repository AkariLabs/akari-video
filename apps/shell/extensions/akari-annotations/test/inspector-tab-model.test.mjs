import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignSectionToTab,
  COMING_SOON_ADJUST_SECTIONS,
  InspectorTabState,
  tabsForKind
} from '../lib/browser/inspector/tab-model.js';

const tabShape = tabs => tabs.map(({ label, enabled }) => [label, enabled]);

test('選択 kind ごとに正しいタブ語彙と enabled 状態を返す', () => {
  assert.deepEqual(tabShape(tabsForKind('cut')), [
    ['動画', true], ['調整', true], ['音声', false], ['情報', true]
  ]);
  for (const kind of ['layer', 'overlay', 'item']) {
    assert.deepEqual(tabShape(tabsForKind(kind, {})), [
      ['動画', true], ['調整', false], ['音声', false], ['情報', true]
    ], `${kind}: src なし`);
    assert.deepEqual(tabShape(tabsForKind(kind, { src: 'assets/source.mp4' })), [
      ['動画', true], ['調整', true], ['音声', false], ['情報', true]
    ], `${kind}: src あり`);
  }
  assert.deepEqual(tabShape(tabsForKind('caption')), [
    ['テキスト', true], ['情報', true]
  ]);
  assert.deepEqual(tabShape(tabsForKind('audio')), [
    ['音声', true], ['情報', true]
  ]);
});

test('既存セクションを kind に応じたタブへ振り分ける', () => {
  assert.equal(assignSectionToTab('cut', 'time'), 'video');
  assert.equal(assignSectionToTab('cut', 'transform'), 'video');
  assert.equal(assignSectionToTab('cut', 'info'), 'info');
  assert.equal(assignSectionToTab('caption', 'content'), 'text');
  assert.equal(assignSectionToTab('caption', 'style'), 'text');
  assert.equal(assignSectionToTab('caption', 'timing'), 'text');
  assert.equal(assignSectionToTab('audio', 'time'), 'audio');
  assert.equal(assignSectionToTab('audio', 'audio:fades'), 'audio');
});

test('アクティブタブは kind ごとに永続し disabled 保存値をフォールバックする', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const state = new InspectorTabState(storage);
  const cutTabs = tabsForKind('cut');
  const layerTabs = tabsForKind('layer');

  assert.equal(state.activeTab('cut', cutTabs), 'video');
  state.setActiveTab('cut', 'adjust');
  state.setActiveTab('layer', 'info');
  assert.equal(values.get('akari.inspector.tab.v1:cut'), 'adjust');
  assert.equal(state.activeTab('cut', cutTabs), 'adjust');
  assert.equal(state.activeTab('layer', layerTabs), 'info');

  state.setActiveTab('layer', 'adjust');
  assert.equal(state.activeTab('layer', layerTabs), 'video');
});

test('調整の Coming soon 見出しは裁定どおりの 6 件', () => {
  assert.deepEqual([...COMING_SOON_ADJUST_SECTIONS], [
    '基本補正', 'RGB カーブ', 'カラーホイール', 'Hue カーブ', 'LUT', 'エフェクト'
  ]);
});
