import assert from 'node:assert/strict';
import test from 'node:test';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import { materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';
import { timelineMethod, timelineSource } from './helpers/perspective-transition-fixture.mjs';

test('focusTimelineItem seeks to the placed output interval only when the playhead is outside', async () => {
  const focus = timelineMethod('focusTimelineItem');
  for (const [playhead, expected] of [[2, [3]], [15, [3]], [4, []], [6.5, []], [3, []], [8, [3]]]) {
    const seeks = [];
    const state = {
      playheadT: playhead,
      resolveFocusSelection: () => ({ kind: 'item', id: 'shape-1' }),
      focusRangeFor: () => [3, 8],
      applySelection() {},
      requestSeek: async (seconds, options) => { seeks.push([seconds, options]); }
    };
    assert.equal(await focus.call(state, 'shape-1', { seekIfOutside: true }), true);
    assert.deepEqual(seeks, expected.map(seconds => [seconds, { domain: 'output' }]), `playhead ${playhead}`);
  }
});

test('seek true keeps its unconditional behavior', async () => {
  const seeks = [];
  const state = { playheadT: 4, resolveFocusSelection: () => ({ kind: 'item', id: 'shape-1' }),
    focusRangeFor: () => [3, 8], applySelection() {},
    requestSeek: async (seconds, options) => { seeks.push([seconds, options]); } };
  await timelineMethod('focusTimelineItem').call(state, 'shape-1', { seek: true, seekIfOutside: true });
  assert.deepEqual(seeks, [[3, { domain: 'output' }]]);
});

test('focus reports an unresolved interval so the placement path can seek from placed frames', async () => {
  const state = { playheadT: 15, resolveFocusSelection: () => ({ kind: 'audio', id: 'audio-1' }),
    focusRangeFor: () => undefined, applySelection() {} };
  assert.equal(await timelineMethod('focusTimelineItem').call(state, 'audio-1', { seekIfOutside: true }), false);
});

test('audio timeline placement seeks from the inserted frames when focus cannot resolve a range', async () => {
  const addMaterialAt = timelineMethod('addMaterialAt', {
    indexEditV2Items: mutations.indexEditV2Items, stringifyEditV2: mutations.stringifyEditV2,
    insertAudioSfxPreferV2: mutations.insertAudioSfxPreferV2,
    updateV2Item: mutations.updateItem, insertV2Track: mutations.insertTrack,
    materialOverlapInsertIndex
  });
  for (const [playhead, expected] of [[15, [3]], [4, []]]) {
    let doc = { version: 2, output: { fps: 30 }, sources: [], audio: { sfx: [] },
      tracks: [{ id: 'a1', lane: 'audio', items: [] }] };
    const seeks = [], uri = { toString: () => 'file:///edit.json', path: { fsPath: () => '/fixture' } };
    const state = {
      location: { root: { toString: () => 'file:///fixture', path: uri.path }, editUri: uri },
      playheadT: playhead, fps: 30, frameAt: seconds => Math.round(seconds * 30),
      refreshReferenceMediaUris: async () => {},
      fileService: { readFile: async () => ({ value: { toString: () => JSON.stringify(doc) } }) },
      writeTimelineSnapshots: async source => { doc = JSON.parse(source); }, reloadEdit: async () => {},
      pushHistory() {}, annotationsService: { measureAudioForLevel: async () => ({ ok: false, reason: 'test' }) },
      resolveEditMediaUri: () => uri, hideNotice() {}, footer: {}, revealOutputPreview() {},
      focusTimelineItem: async () => false,
      requestSeek: async (seconds, options) => { seeks.push([seconds, options]); },
      notice: { hasMessage: () => false, node: { textContent: '' } },
      messages: { warn: assert.fail, error: assert.fail }, errorMessage: error => error.message
    };
    const id = await addMaterialAt.call(state, 'assets/audio.wav', 'audio', 3, 0,
      { zone: 'audio', targetTrackId: 'a1', durationSeconds: 5 });
    assert.equal(id, 'audio-1');
    assert.equal(doc.tracks[0].items[0].at, 90);
    assert.deepEqual(seeks, expected.map(seconds => [seconds, { domain: 'output' }]), `playhead ${playhead}`);
  }
});

test('timeline drop paths pass conditional seeking through focus', () => {
  const section = (start, end) => timelineSource.slice(timelineSource.indexOf(start), timelineSource.indexOf(end, timelineSource.indexOf(start)));
  const shape = section('async addShapeAt(', 'protected async placeLibraryAssetAtTarget(');
  const overlay = section('async addOverlayAtOutputPoint(', 'async addMaterialAt(');
  const material = section('async addMaterialAt(', 'protected async placeMaterialAtTarget(');
  const textPlace = section('async placeText(', 'async applyLibraryItem(');
  const drop = section('protected handleMaterialDrop(', 'protected async placeMaterialAtTarget(');
  assert.match(shape, /focusTimelineItem\(placed\.id, \{[^}]*timelineTarget \? \{ seekIfOutside: true \}/u);
  assert.match(overlay, /focusTimelineItem\(placedId, \{[^}]*!options\.center \? \{ seekIfOutside: true \}/u);
  assert.equal((material.match(/options\?\.zone \? \{ seekIfOutside: true \}/gu) ?? []).length, 2);
  assert.match(drop, /timelineDrop: true/u);
  assert.match(textPlace, /options\.timelineDrop/u);
});
