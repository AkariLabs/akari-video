import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  groupTreeV2Items,
  moveTreeV2Item,
  ungroupTreeV2Item,
} from '../lib/common/edit-v2-mutations.js';

const widgetSource = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const interactionSource = readFileSync(
  new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8'
);
const previewSource = readFileSync(
  new URL('../src/../../akari-preview/src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8'
);

const item = (id, at, duration) => ({
  id, at, duration, source: { kind: 'filter', filter: { type: 'invert' } }
});
const edit = tracks => ({
  version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks
});

test('] [ の委譲器は重なる移動先の直上に段を生やす', () => {
  const doc = edit([
    { id: 'v1', lane: 'visual', items: [item('selected', 0, 30), item('stay', 40, 10)] },
    { id: 'v2', lane: 'visual', items: [item('occupied', 0, 30)] },
  ]);
  const result = moveTreeV2Item(doc, 'selected', { track: 'v2' });
  assert.equal(result.document.tracks.length, 3);
  assert.equal(result.createdTrackId, 'v3');
  assert.equal(result.document.tracks[2].items[0].id, 'selected');
});

test('帯 D&D の確定は at 更新も tree-ops に委譲し、重なれば段を1つ増やす', () => {
  const doc = edit([
    { id: 'v1', lane: 'visual', items: [item('dragged', 40, 10), item('source-stays', 80, 10)] },
    { id: 'v2', lane: 'visual', items: [item('occupied', 10, 30)] },
  ]);
  const result = moveTreeV2Item(doc, 'dragged', { track: 'v2' }, { at: 15 });
  assert.equal(result.document.tracks.length, doc.tracks.length + 1);
  assert.equal(result.value.at, 15);
  assert.equal(result.createdTrackId, 'v3');
  assert.deepEqual(result.document.tracks.map(track => track.items.map(entry => entry.id)), [
    ['source-stays'], ['occupied'], ['dragged']
  ]);
  assert.match(widgetSource, /this\.moveV2PreviewItem/);
  assert.match(widgetSource, /を追加しました/);
});

test('⌘G は最前面メンバーの段へ親を作り、前後変更 id と通知文を返す', () => {
  const doc = edit([
    { id: 'v1', lane: 'visual', items: [item('back', 0, 30), item('between', 0, 30)] },
    { id: 'v2', lane: 'visual', items: [item('front', 0, 30)] },
  ]);
  const grouped = groupTreeV2Items(doc, ['back', 'front']);
  assert.equal(grouped.value.group.source.kind, 'group');
  assert.ok(grouped.value.changedOrderIds.includes('between'));
  assert.match(widgetSource, /の前後が変わりました/);
});

test('⌘⇧G は tree-ops へ委譲し、袋拒否文を UI に固定する', () => {
  const doc = edit([{ id: 'v1', lane: 'visual', items: [{
    id: 'g', at: 10, duration: 30, transform: { x: 5 }, opacity: 0.5,
    source: { kind: 'group' }, items: [item('child', 2, 5)]
  }] }]);
  const result = ungroupTreeV2Item(doc, 'g');
  const child = result.document.tracks.flatMap(track => track.items ?? []).find(entry => entry.id === 'child');
  assert.equal(child.at, 12);
  assert.equal(child.transform.x, 5);
  assert.equal(child.opacity, 0.5);
  assert.match(widgetSource, /袋はばらせません。部品を出してください/);
});

test('写しの子のプレビュー選択は既存 selectOverlay が mount の共通 id をそのまま報告する', () => {
  assert.match(interactionSource, /selectedOverlay = container;/u);
  assert.match(interactionSource, /selectedOverlay\.setAttribute\("data-akari-interaction-selected", "true"\)/u);
  assert.match(previewSource,
    /selected\?\.getAttribute\('data-overlay-id'\) \|\| null[\s\S]*reportOverlaySelection\(selectedOverlayId\)/u);
  assert.match(widgetSource, /this\.timelineTreeRows\.find\(row => row\.id === overlayId\)/u);
});
