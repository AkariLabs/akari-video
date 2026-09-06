import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { isTrackLocked, lockedTrackMessage } = require('../lib/common/track-lock-guard.js');
const { indexEditV2Items } = require('../lib/common/edit-v2-mutations.js');
const { withCaptionsDisplaySupplement } = require('../lib/common/derive-timeline-tracks.js');
const source = ts.createSourceFile('widget.ts', readFileSync(
  new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = [
  'isTrackLocked', 'trackIdOfItem', 'trackIdOfSelection', 'trackIdOfDrag', 'showLockedTrack',
  'trackFlagStorageKey', 'applyStoredTrackFlags', 'toggleTimelineTrackFlag', 'cutItemId',
  'performDeleteSelected', 'performDeleteSelectedCut', 'performDeleteMultiSelected',
  'moveTimelineKeyframe', 'removeSelectedKeyframes', 'moveAggregateKeyframes', 'deleteTimelineTrack',
  'commitDrag', 'commitEditV2Drag', 'installDragListeners', 'installTrimmerDrag',
  'installAudioTrimmerDrag', 'installTreeRowDrag', 'selectionFromDragState',
  'handleMaterialDrop', 'resolveMaterialDropTarget', 'updateMaterialGhost',
  'handleLibraryTransitionDrop', 'handleLibraryTransitionDragOver', 'applyTrackLockAppearance',
  'timelineSelectionFromElement',
];
const methodText = name => {
  const method = widget.members.find(member => member.name?.getText(source) === name);
  assert.ok(method, name);
  return method.getText(source);
};
const code = ts.transpileModule(`class Handler { ${names.map(methodText).join('\n')} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;
class Element {}
const Handler = new Function('isTrackLocked', 'lockedTrackMessage', 'TRACK_FLAG_STORAGE_PREFIX', 'Element',
  'withCaptionsDisplaySupplement', `${code}\nreturn Handler;`)(
  isTrackLocked, lockedTrackMessage, 'test-track-flags', Element, withCaptionsDisplaySupplement
);

function fixture(stored = new Map()) {
  const context = new Handler();
  context.location = { editUri: 'edit.json', captionsUri: 'captions.json', root: '.' };
  context.timelineTracks = [
    { id: 'visual', kind: 'cuts', label: '本編', locked: true },
    { id: 'audio', kind: 'audio', ref: 0, label: '音声' },
    { id: 'captions', kind: 'captions', label: '字幕', locked: true },
  ];
  context.displayTimelineTracks = context.timelineTracks;
  context.localLockedTrackIds = new Set();
  context.beatsLocked = false;
  context.footer = {};
  context.editDocument = {
    version: 2, output: { fps: 30, width: 320, height: 180 }, sources: [],
    tracks: [
      { id: 'visual', lane: 'visual', items: [
        { id: 'cut', at: 0, duration: 30, source: { kind: 'media', src: 'media' } },
        { id: 'group', at: 0, duration: 30, source: { kind: 'group' }, items: [
          { id: 'child', at: 0, duration: 15, source: { kind: 'text', text: 'hi' } },
        ] },
      ] },
      { id: 'audio', lane: 'audio', items: [
        { id: 'sound', at: 0, duration: 30, source: { kind: 'media', src: 'sound' } },
      ] },
    ],
  };
  context.itemLocations = indexEditV2Items(context.editDocument);
  context.cutItemIds = ['cut'];
  context.audioSfx = [];
  context.audioNarration = [];
  context.captions = [{ id: 'caption' }];
  context.expandedTimelineTreeRows = [{ id: 'bag#caption', trackId: 'captions' }];
  context.timelineTreeRows = context.expandedTimelineTreeRows;
  context.captionTreeRow = () => undefined;
  context.computeTrackAutoNames = () => new Map();
  context.computeAudioDisplayTracks = () => { context.displayTimelineTracks = context.timelineTracks; };
  context.computeBgmDisplayTrack = () => {};
  context.computeCaptionsDisplayTrack = () => {};
  context.renderStrip = () => {};
  context.syncTimelineTrackTogglesToPreview = () => assert.fail('lock must not affect preview output');
  context.storageWrites = [];
  context.storage = {
    getData: async (key, fallback) => stored.get(key) ?? fallback,
    setData: async (key, value) => { stored.set(key, value); context.storageWrites.push({ key, value }); },
  };
  context.commitEditMutation = async () => assert.fail('locked operation wrote edit.json');
  context.annotationsService = new Proxy({}, { get: () => () => assert.fail('locked operation called RPC') });
  context.selectionModel = {};
  context.errorMessage = error => error.message;
  context.showNotice = message => assert.fail(message);
  context.messages = { error: message => assert.fail(message) };
  return { context, stored, key: id => context.trackFlagStorageKey('edit.json', id, 'locked') };
}

test('lock toggle persists locally, survives reload, and does not change edit.json', async () => {
  const { context, stored, key } = fixture();
  const before = JSON.stringify(context.editDocument);
  await context.toggleTimelineTrackFlag(context.timelineTracks[1], 'locked');
  assert.equal(stored.get(key('audio')), true);
  assert.equal(context.timelineTracks[1].locked, true);
  assert.equal(context.footer.textContent, 'トラックをロックしました。');
  const reloaded = fixture(stored).context;
  await reloaded.applyStoredTrackFlags();
  assert.equal(reloaded.isTrackLocked('audio'), true);
  assert.equal(reloaded.isTrackLocked('visual'), false);
  await reloaded.toggleTimelineTrackFlag(reloaded.timelineTracks[1], 'locked');
  assert.equal(stored.get(key('audio')), false);
  assert.equal(reloaded.isTrackLocked('audio'), false);
  assert.equal(reloaded.footer.textContent, 'トラックをロック解除しました。');
  assert.equal(JSON.stringify(context.editDocument), before);
});

test('beats and display-only tracks retain their locks without adding document tracks', async () => {
  const { context, stored } = fixture();
  const before = JSON.stringify(context.editDocument);
  const derived = { id: 'derived-audio', kind: 'audio', ref: 1 };
  for (const track of [{ id: 'beats', kind: 'audio' }, derived]) {
    await context.toggleTimelineTrackFlag(track, 'locked');
    assert.equal(context.isTrackLocked(track.id), true);
  }
  const reloaded = fixture(stored).context;
  reloaded.computeBgmDisplayTrack = () => {
    reloaded.displayTimelineTracks = [...reloaded.displayTimelineTracks, derived];
  };
  await reloaded.applyStoredTrackFlags();
  assert.equal(reloaded.beatsLocked, true);
  assert.equal(reloaded.isTrackLocked(derived.id), true);
  assert.equal(JSON.stringify(context.editDocument), before);
});

for (const selection of [
  { kind: 'cut', index: 0 }, { kind: 'item', id: 'child', itemKind: 'text' },
  { kind: 'caption', id: 'caption' }, { kind: 'item', id: 'bag#caption', itemKind: 'caption' },
]) {
  test(`single delete retains locked ${selection.id ?? selection.kind}`, async () => {
    const { context } = fixture();
    context.selection = selection;
    const before = JSON.stringify(context.editDocument);
    await context.performDeleteSelected();
    assert.match(context.footer.textContent, /はロック中です/);
    assert.equal(context.selection, selection);
    assert.equal(JSON.stringify(context.editDocument), before);
  });
}

test('mixed deletion removes only unlocked items and clears obsolete selection indexes', async () => {
  const { context } = fixture();
  let disk = JSON.stringify(context.editDocument);
  const retained = { kind: 'cut', index: 0 };
  context.multiSelection = [retained, { kind: 'audio', id: 'sound' }];
  context.fileService = { readFile: async () => ({ value: disk }) };
  context.writeTimelineSnapshots = async (edit, captions) => { assert.equal(captions, undefined); disk = edit; };
  context.reloadAll = async () => {};
  context.pushSelectionSnapshot = () => {};
  context.pushHistory = entry => { context.history = entry; };
  await context.performDeleteMultiSelected();
  assert.deepEqual(JSON.parse(disk).tracks[0], context.editDocument.tracks[0]);
  assert.deepEqual(JSON.parse(disk).tracks[1].items, []);
  assert.deepEqual(context.multiSelection, []);
  assert.equal(context.footer.textContent, '1 件はロック中のため残しました');
  await context.history.undo();
  assert.equal(JSON.parse(disk).tracks[1].items[0].id, 'sound');
});

test('all-locked multi selection returns before any file IO', async () => {
  const { context } = fixture();
  context.multiSelection = [{ kind: 'cut', index: 0 }, { kind: 'caption', id: 'caption' }];
  await context.performDeleteMultiSelected();
  assert.equal(context.footer.textContent, '2 件はロック中のため残しました');
});

test('unlocked drag and single deletion still reach their existing mutation paths', async () => {
  const { context } = fixture();
  context.timelineTracks[0].locked = false;
  const preview = { kind: 'cut-move', index: 0 };
  let committed;
  context.commitEditV2Drag = async value => { committed = value; };
  await context.commitDrag(preview);
  assert.equal(committed, preview);
  context.selection = { kind: 'cut', index: 0 };
  let deleted = false;
  context.performDeleteSelectedCut = async () => { deleted = true; };
  await context.performDeleteSelected();
  assert.equal(deleted, true);
});

test('lock enabled after drag start is checked again at commit', async () => {
  const { context } = fixture();
  context.timelineTracks[0].locked = false;
  const preview = { kind: 'cut-move', index: 0, at: 1 };
  assert.equal(context.isTrackLocked(context.trackIdOfDrag(preview)), false);
  await context.toggleTimelineTrackFlag(context.timelineTracks[0], 'locked');
  await context.commitDrag(preview);
  assert.equal(context.footer.textContent, lockedTrackMessage('本編'));
});

test('caption supplemental lock is restored before the parallel captions read finishes', async () => {
  const { context, stored, key } = fixture();
  context.timelineTracks = context.timelineTracks.filter(track => track.kind !== 'captions');
  context.captions = [];
  const supplemental = withCaptionsDisplaySupplement(context.timelineTracks, true).find(track => track.kind === 'captions');
  stored.set(key(supplemental.id), true);
  await context.applyStoredTrackFlags();
  context.displayTimelineTracks = withCaptionsDisplaySupplement(context.displayTimelineTracks, true);
  context.captions = [{ id: 'late-caption' }];
  assert.equal(context.isTrackLocked(context.trackIdOfItem('late-caption')), true);
});

test('audio moved into a display-only row follows that row lock', () => {
  const { context } = fixture();
  context.audioSfx = [{ id: 'sound', track: 0 }];
  context.sfxDisplayTrack = () => 1;
  context.displayTimelineTracks = [...context.timelineTracks, { id: 'derived', kind: 'audio', ref: 1 }];
  context.localLockedTrackIds.add('derived');
  assert.equal(context.trackIdOfItem('sound'), 'derived');
  assert.equal(context.isTrackLocked(context.trackIdOfItem('sound')), true);
});

for (const [name, args] of [
  ['moveTimelineKeyframe', ['child', 'opacity', 0, 10]],
  ['moveAggregateKeyframes', [['sound', 'child'], 0, 10]],
  ['removeSelectedKeyframes', []], ['deleteTimelineTrack', ['visual']],
  ['commitDrag', [{ kind: 'cut-move', index: 0 }]],
  ['commitEditV2Drag', [{ kind: 'cut-trim', index: 0 }]],
  ['commitDrag', [{ kind: 'caption', id: 'caption' }]],
  ['commitEditV2Drag', [{ kind: 'audio', id: 'sound', targetTrackId: 'visual' }]],
]) {
  test(`${name} rejects a locked source or destination`, async () => {
    const { context } = fixture();
    context.selectionModel.keyframeSelection = { itemId: 'child', times: [0], property: 'opacity' };
    await context[name](...args);
    assert.match(context.footer.textContent, /はロック中です/);
  });
}

function pointerEvent() {
  return { button: 0, pointerId: 1, clientX: 10, clientY: 10,
    preventDefault() { this.prevented = true; }, stopPropagation() {} };
}

for (const [name, map, installed, detail] of [
  ['installDragListeners', 'dragListenerConfigs', 'dragListenerInstalled', { kind: 'cut-move', index: 0 }],
  ['installTrimmerDrag', 'trimmerListenerDetails', 'trimmerListenerInstalled', { kind: 'cut-trim', index: 0 }],
  ['installAudioTrimmerDrag', 'audioTrimmerListenerDetails', 'audioTrimmerListenerInstalled', { kind: 'audio-trim', id: 'sound' }],
]) {
  test(`${name} refuses pointer drag while allowing click selection`, () => {
    const { context } = fixture();
    context.timelineTracks[1].locked = true;
    context[map] = new WeakMap();
    context[installed] = new WeakSet();
    const listeners = new Map();
    const element = { style: {}, addEventListener: (name, fn) => listeners.set(name, fn) };
    context.expandedChipHitRect = () => ({});
    context.applySelection = selected => { context.selection = selected; };
    context[name](element, () => detail);
    const event = pointerEvent();
    listeners.get('pointerdown')(event);
    assert.equal(event.prevented, true);
    assert.equal(context.dragState, undefined);
    assert.equal(context.selection.kind, detail.kind.startsWith('audio') ? 'audio' : 'cut');
    assert.match(context.footer.textContent, /はロック中です/);
  });
}

test('tree row cannot start reordering a locked track', () => {
  const { context } = fixture();
  context.treeRowDragConfigs = new WeakMap();
  context.treeRowDragInstalled = new WeakSet();
  let listener;
  const element = { style: {}, addEventListener: (_name, fn) => { listener = fn; } };
  context.installTreeRowDrag(element, { id: 'child', trackId: 'visual' }, []);
  const event = pointerEvent();
  listener(event);
  assert.equal(event.prevented, true);
  assert.match(context.footer.textContent, /本編/);
});

test('material drop rejects a locked target and hides its ghost', () => {
  const { context } = fixture();
  context.strip = { getBoundingClientRect: () => ({ top: 0 }) };
  context.laneLayout = { tracks: [{ id: 'visual', track: 0, top: 0, height: 48 }] };
  const payload = { kind: 'video', relativePath: 'media.mp4' };
  context.isMaterialDragTransfer = () => true;
  context.readMaterialDropPayload = () => payload;
  context.hideMaterialGhost = () => { context.ghostHidden = true; };
  context.materialDragPayload = payload;
  context.updateMaterialGhost(10, 10);
  assert.equal(context.ghostHidden, true);
  context.ghostHidden = false;
  const target = context.resolveMaterialDropTarget('video', 10);
  assert.equal(target.rejected, true);
  assert.equal(target.targetTrackId, 'visual');
  assert.equal(target.reason, lockedTrackMessage('本編'));
  const event = pointerEvent();
  context.handleMaterialDrop(event);
  assert.equal(event.prevented, true);
  assert.equal(context.ghostHidden, true);
  assert.equal(context.footer.textContent, lockedTrackMessage('本編'));
});

test('transition drop and hover refuse either locked boundary track', () => {
  const { context } = fixture();
  context.cutItemIds.push('sound');
  context.libraryDragPayload = {};
  context.isLibraryTransitionDragTransfer = () => true;
  context.readLibraryTransitionDropPayload = () => ({});
  context.hitLibraryTransitionDropTarget = () => ({ earlierIndex: 1, laterIndex: 0 });
  context.clearLibraryTransitionDragState = () => {};
  context.setHoveredTransitionDropTarget = hit => assert.equal(hit, undefined);
  const event = { ...pointerEvent(), dataTransfer: {} };
  context.handleLibraryTransitionDragOver(event);
  assert.equal(event.dataTransfer.dropEffect, 'none');
  context.handleLibraryTransitionDrop(event);
  assert.equal(context.footer.textContent, lockedTrackMessage('本編'));
});

test('reused bands, chips and beat markers gain and lose the lock appearance', () => {
  const { context } = fixture();
  const elements = [
    { dataset: { akariLane: 'visual' } },
    { dataset: { akariItemKind: 'cut', akariItemId: '0' } },
    { dataset: { akariItemKind: 'item', akariItemId: 'child', akariTreeItemKind: 'text' } },
    { dataset: { akariBeatId: 'beat' } },
  ];
  context.stripContent = { querySelectorAll: () => elements };
  context.beatsLocked = true;
  context.applyTrackLockAppearance();
  assert.deepEqual(elements.map(node => node.dataset.akariLocked), ['true', 'true', 'true', 'true']);
  context.timelineTracks[0].locked = false;
  context.beatsLocked = false;
  context.applyTrackLockAppearance();
  assert.deepEqual(elements.map(node => node.dataset.akariLocked), ['false', 'false', 'false', 'false']);
});

test('every timeline edit entry checks isTrackLocked before mutation', () => {
  for (const name of [
    'installDragListeners', 'installTrimmerDrag', 'installAudioTrimmerDrag', 'installTreeRowDrag',
    'handleMaterialDrop', 'handleLibraryTransitionDrop', 'performDeleteSelected', 'performDeleteMultiSelected',
    'moveTimelineKeyframe', 'removeSelectedKeyframes', 'moveAggregateKeyframes', 'deleteTimelineTrack',
    'commitDrag', 'commitEditV2Drag',
  ]) assert.match(methodText(name), /this\.isTrackLocked\(/, name);
  assert.match(methodText('renderTrackHeaders'), /JSON\.stringify\(\[track, name, visible, audible, locked, treeRows\]\)/);
  assert.match(methodText('renderTrackHeaders'), /this\.beatsLocked/);
  assert.match(methodText('renderTransitionBoundaries'), /dropTarget\.style\.visibility = locked \? 'hidden'/);
});
