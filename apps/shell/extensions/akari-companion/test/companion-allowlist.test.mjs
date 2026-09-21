import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_COMMAND_IDS,
  isAllowedCommandId,
  validateCommandArgs
} from '../lib/common/companion-allowlist.js';

const valid = {
  'akari.preview.ensureVisible': undefined,
  'akari.preview.seekOutput': { editUri: 'file:///edit.json', time: 1 },
  'akari.preview.togglePlayback': {},
  'akari.preview.play': { editUri: 'file:///edit.json' },
  'akari.preview.pause': { editUri: 'file:///edit.json' },
  'akari.preview.setFullscreen': { editUri: 'file:///edit.json', on: true },
  'akari.preview.setViewZoom': { editUri: 'file:///edit.json', scale: 1.5, fit: false },
  'akari.preview.setPlaybackRate': { editUri: 'file:///edit.json', rate: 1.25 },
  'akari.preview.setLoopRange': { editUri: 'file:///edit.json', startSeconds: 1, endSeconds: 2 },
  'akari.preview.enterCropMode': { editUri: 'file:///edit.json', itemId: 'item-1', on: true },
  'akari.preview.openPerspectivePanel': { editUri: 'file:///edit.json', itemId: 'item-1' },
  'akari.preview.pulseItem': { editUri: 'file:///edit.json', itemId: 'item-1' },
  'akari.preview.showZoneHint': { editUri: 'file:///edit.json', zones: ['top'], durationMs: 500 },
  'akari.timeline.focusItem': { itemId: 'item-1', seek: true, reveal: false, pulse: true },
  'akari.timeline.seek': { seconds: 3 },
  'akari.timeline.setView': { startSeconds: 0, durationSeconds: 10, fit: false },
  'akari.timeline.setTool': { tool: 'razor' },
  'akari.timeline.setSnap': { enabled: true },
  'akari.timeline.reveal': undefined,
  'akari.inspector.open': { attachOnly: true, tabId: 'tab', sectionId: 'section', fieldName: 'field', solo: true },
  'akari.daihon.open': { captionId: 'c-1', wordRange: { from: 0, to: 2 }, atSeconds: 1, open: 'qc', speaker: 'A', pulse: true },
  'akari.cuts.open': { candidateId: 'candidate-1' },
  'akari.transcribe.openDialog': { projectRoot: 'file:///project', relativePath: 'media/a.mp4' },
  'akari.catalog.open': { tab: 'library', category: 'video', query: 'q', assetId: 'a-1', pulse: true },
  'akari.catalog.importAsset': { assetId: 'x' },
  'akari.catalog.listCategories': undefined,
  'akari.menu.focus': { section: 'skills', pulse: true, skill: 'edit-plan' },
  'akari.menu.listSkills': {},
  'akari.menu.listOpenTargets': undefined,
  'akari.review.open': {},
  'akari.review.board.open': undefined,
  'akari.partner.open': {},
  'akari.settings.open': { section: 'connections' }
};

test('許可された全コマンドの正常な引数を受ける', () => {
  assert.equal(ALLOWED_COMMAND_IDS.length, Object.keys(valid).length);
  for (const id of ALLOWED_COMMAND_IDS) {
    assert.equal(validateCommandArgs(id, valid[id]).ok, true, id);
  }
});

test('固定一覧に無い副作用コマンドを拒む', () => {
  for (const id of [
    'akari.partner.send',
    'akari.partner.injectPrompt',
    'akari.timeline.addMaterialAtPlayhead',
    'akari.annotations.open',
    ['akari.preview.open', 'AudioMeter'].join('')
  ]) {
    assert.equal(isAllowedCommandId(id), false, id);
  }
});

test('文字列・配列・数値の境界を検査する', () => {
  assert.equal(validateCommandArgs('akari.preview.ensureVisible', { editUri: 'x'.repeat(512) }).ok, true);
  assert.equal(validateCommandArgs('akari.preview.ensureVisible', { editUri: 'x'.repeat(513) }).ok, false);
  assert.equal(validateCommandArgs('akari.preview.showZoneHint', {
    editUri: 'x', zones: Array.from({ length: 32 }, () => 'top')
  }).ok, true);
  assert.equal(validateCommandArgs('akari.preview.showZoneHint', {
    editUri: 'x', zones: Array.from({ length: 33 }, () => 'top')
  }).ok, false);
  assert.equal(validateCommandArgs('akari.timeline.seek', { seconds: Infinity }).ok, false);
  assert.equal(validateCommandArgs('akari.preview.setViewZoom', { editUri: 'x', scale: 0 }).ok, false);
});

test('型違い・未知のキー・不完全な union を拒む', () => {
  assert.equal(validateCommandArgs('akari.timeline.setSnap', { enabled: 'yes' }).ok, false);
  assert.equal(validateCommandArgs('akari.timeline.seek', { seconds: 1, extra: true }).ok, false);
  assert.equal(validateCommandArgs('akari.preview.setLoopRange', { editUri: 'x', clear: true, startSeconds: 0 }).ok, false);
  assert.equal(validateCommandArgs('akari.preview.setLoopRange', { editUri: 'x', startSeconds: 2, endSeconds: 1 }).ok, true);
  assert.equal(validateCommandArgs('akari.daihon.open', { wordRange: { from: 2, to: 1 } }).ok, false);
  assert.equal(validateCommandArgs('akari.menu.focus', { skill: 'edit-plan' }).ok, true);
  assert.equal(validateCommandArgs('akari.menu.focus', { section: 'open', skill: 'edit-plan' }).ok, true);
  assert.equal(validateCommandArgs('akari.catalog.listCategories', { extra: true }).ok, false);
});

test('素材取り込みの引数を厳密に検査する', () => {
  assert.equal(validateCommandArgs('akari.catalog.importAsset', { assetId: 'x' }).ok, true);
  assert.equal(validateCommandArgs('akari.catalog.importAsset', { assetId: 'x', path: '/etc' }).ok, false);
  assert.equal(validateCommandArgs('akari.catalog.importAsset', {}).ok, false);
  assert.equal(validateCommandArgs('akari.catalog.importAsset', undefined).ok, false);
  assert.equal(validateCommandArgs('akari.catalog.importAsset', { assetId: 'x'.repeat(513) }).ok, false);
  assert.equal(validateCommandArgs('akari.catalog.importAsset', { assetId: 1 }).ok, false);
});

test('インスペクターの単独表示指定を検査する', () => {
  assert.equal(validateCommandArgs('akari.inspector.open', { solo: true }).ok, true);
  assert.equal(validateCommandArgs('akari.inspector.open', { solo: 'yes' }).ok, false);
});

test('editUri は橋が入れる — 必須のコマンドでも係は渡さなくてよい', () => {
  // 橋が入れたあとの形で検査が通ること（入れる前に検査すると invalid-args に落ちる）。
  const withUri = { editUri: 'file:///p/edit.json' };
  for (const id of ['akari.preview.play', 'akari.preview.pause', 'akari.preview.pulseItem']) {
    const args = id === 'akari.preview.pulseItem' ? { ...withUri, itemId: 'a' } : withUri;
    assert.equal(validateCommandArgs(id, args).ok, true, id);
    assert.equal(validateCommandArgs(id, id === 'akari.preview.pulseItem' ? { itemId: 'a' } : {}).ok, false, id + ' without editUri');
  }
});
