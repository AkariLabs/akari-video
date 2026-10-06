import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import * as mutations from '../lib/common/edit-v2-mutations.js';
import { materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';
import { nearestTimelineViewStart } from '../lib/common/selection-reveal.js';
import { topVisualTarget } from '../lib/browser/preview-material-placement.js';
import { canvasAtFrame, canvasDropDuration, canvasDropTargets } from '../lib/browser/canvas-drop-target.js';
import { buildOverlayItem, insertOverlayItem, isUsableOverlayBox, nextOverlayItemId, overlayDefaultVars,
  parseOverlayPlaceRequest, resolveThenWriteOverlay } from '../lib/common/overlay-place.js';
import { timelineMethod } from './helpers/perspective-transition-fixture.mjs';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('playhead line hit target is confined to the ruler row', () => {
  const hit = section("playheadLineHit.dataset.testid = 'akari-playhead-line-hit'", 'playheadLineHit.addEventListener');
  assert.match(hit, /top: '0'/u);
  assert.match(hit, /height: `\$\{RULER_BAND_HEIGHT_PX\}px`/u);
  assert.doesNotMatch(hit, /bottom:/u);
});

test('material, overlay, shape and text drop placement reveal and pulse the placed item', () => {
  const material = section('async addMaterialAt(', 'protected async placeMaterialAtTarget(');
  assert.match(material, /focusTimelineItem\?\.\(itemId, \{\s*\.\.\.\(options\?\.zone \? \{ seekIfOutside: true \} : \{\}\), reveal: true, pulse: true/u);
  assert.match(material, /focusTimelineItem\?\.\(String\(item\.id\), \{\s*\.\.\.\(options\?\.zone \? \{ seekIfOutside: true \} : \{\}\), reveal: true, pulse: true/u);
  const overlay = section('async addOverlayAtOutputPoint(', 'async addMaterialAt(');
  assert.match(overlay, /focusTimelineItem\(placedId, \{\s*\.\.\.\(!options\.center \? \{ seekIfOutside: true \} : \{\}\), reveal: true, pulse: true/u);
  const shape = section('async addShapeAt(', 'protected async placeLibraryAssetAtTarget(');
  assert.match(shape, /focusTimelineItem\(placed\.id, \{\s*seek: !timelineTarget, \.\.\.\(timelineTarget \? \{ seekIfOutside: true \} : \{\}\), reveal: true, pulse: true/u);
  const drop = section('protected async placeMaterialAtTarget(', 'protected readMaterialDropPayload(');
  assert.match(drop, /await this\.addMaterialAt\(/u);
  const textPlace = section('async placeText(', 'async applyLibraryItem(');
  assert.match(textPlace, /focusTimelineItem\?\.\(caption\.id, \{\s*\.\.\.\(options\.timelineDrop \? \{ seekIfOutside: true \} : \{\}\), reveal: true, pulse: true/u);
});

test('addShapeAt focuses the placed shape and seeks only when outside its timeline interval', async () => {
  const calls = [];
  let doc = { version: 2, output: { width: 1920, height: 1080, fps: 30 },
    tracks: [{ id: 'v1', lane: 'visual', items: [] }] };
  const method = timelineMethod('addShapeAt', {
    parseShapePlaceRequest: request => request, nextShapeItemId: () => 'shape-1',
    buildShapeItem: options => ({ id: options.id, at: options.at, duration: options.duration,
      source: { kind: 'shape' } }), placePreviewShapeInCanvas: () => undefined,
    insertV2Item: mutations.insertItem, insertV2Track: mutations.insertTrack,
    SHAPE_PLACE_DEFAULT_DURATION_SECONDS: 5, SHAPE_PRESET_COMMAND_ID: 'shape.preset',
    SHAPE_PLACED_EVENT: 'shape.placed', window: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  const state = { location: { editUri: { toString: () => 'edit' } }, playheadT: 2,
    commands: { executeCommand: async () => ({ preset: { id: 'rectangle' } }) },
    frameAt: seconds => Math.round(seconds * 30), isTrackLocked: () => false,
    async commitEditMutation(_label, mutate) { doc = mutate(doc); },
    focusTimelineItem: async (id, options) => { calls.push({ id, options }); },
    hideNotice() {}, footer: {}, revealOutputPreview() {},
    messages: { warn: assert.fail, error: assert.fail }, errorMessage: error => error.message };
  const placed = await method.call(state, { preset: 'rectangle', t: 3,
    timelineTarget: { zone: 'layers', targetTrackId: 'v1', rejected: false } });
  assert.equal(placed, 'shape-1');
  assert.equal(doc.tracks[0].items[0].id, placed);
  assert.deepEqual(calls, [{ id: placed, options: { seek: false, seekIfOutside: true, reveal: true, pulse: true } }]);
});

test('timeline material drop focuses video and audio and seeks only when outside their intervals', async () => {
  const addMaterialAt = timelineMethod('addMaterialAt', {
    indexEditV2Items: mutations.indexEditV2Items, stringifyEditV2: mutations.stringifyEditV2,
    insertAudioSfxPreferV2: mutations.insertAudioSfxPreferV2,
    updateV2Item: mutations.updateItem, insertV2Track: mutations.insertTrack,
    insertV2Item: mutations.insertItem, materialOverlapInsertIndex, topVisualTarget,
    canvasAtFrame, canvasDropDuration, canvasDropTargets,
    insertTreeV2ItemIntoCanvas: mutations.insertTreeV2ItemIntoCanvas,
    IMAGE_LAYER_DEFAULT_DURATION_SECONDS: 5, MATERIAL_INSERT_FALLBACK_DURATION_SECONDS: 3
  });
  const placeMaterialAtTarget = timelineMethod('placeMaterialAtTarget');
  for (const [kind, trackId] of [['video', 'v1'], ['audio', 'a1']]) {
    let doc = { version: 2, output: { fps: 30 }, sources: [], audio: { sfx: [] },
      tracks: [{ id: 'a1', lane: 'audio', items: [] }, { id: 'v1', lane: 'visual', items: [] }] };
    const calls = [], uri = { toString: () => 'file:///edit.json', path: { fsPath: () => '/fixture' } };
    const state = { location: { root: { toString: () => 'file:///fixture', path: uri.path }, editUri: uri },
      playheadT: 0, fps: 30, materialDurationCache: new Map(),
      addMaterialAt, refreshReferenceMediaUris: async () => {}, frameAt: seconds => Math.round(seconds * 30),
      fileService: { readFile: async () => ({ value: { toString: () => JSON.stringify(doc) } }) },
      writeTimelineSnapshots: async source => { doc = JSON.parse(source); }, reloadEdit: async () => {},
      pushHistory() {}, annotationsService: { measureAudioForLevel: async () => ({ ok: false, reason: 'test' }) },
      resolveEditMediaUri: () => uri, hideNotice() {}, footer: {}, revealOutputPreview() {},
      focusTimelineItem: async (id, options) => { calls.push({ id, options }); return true; },
      beyondCutsEndNote: () => '', notice: { hasMessage: () => false, node: { textContent: '' } },
      materialDropTime: x => x / 10, messages: { warn: assert.fail, error: assert.fail },
      errorMessage: error => error.message, showNotice: assert.fail };
    await placeMaterialAtTarget.call(state, { kind, relativePath: `assets/${kind}.mp4`, durationSeconds: 3 },
      { zone: kind === 'audio' ? 'audio' : 'layers', track: 0, targetTrackId: trackId,
        top: 0, height: 32, rejected: false }, 30, 'strip');
    const placed = doc.tracks.flatMap(track => track.items).find(item => item.id !== undefined);
    assert.equal(placed?.id, calls[0]?.id, kind);
    assert.deepEqual(calls, [{ id: placed.id, options: { seekIfOutside: true, reveal: true, pulse: true } }], kind);
  }
});

test('addOverlayAtOutputPoint focuses the created id and seeks only when outside its interval', async () => {
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
  const member = owner.members.find(node => ts.isMethodDeclaration(node)
    && node.name.getText(ast) === 'addOverlayAtOutputPoint');
  const code = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const method = runInContext(`${code}\nHandler.prototype.addOverlayAtOutputPoint`, createContext({
    parseOverlayPlaceRequest, resolveThenWriteOverlay, nextOverlayItemId, buildOverlayItem,
    insertOverlayItem, overlayDefaultVars, isUsableOverlayBox,
    overlayBoxWithinDelay: async measurement => measurement,
    stringifyEditV2: JSON.stringify, updateV2Item: mutations.updateItem,
    Date, Promise, Number, console
  }));
  let doc = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
    tracks: [{ id: 'v1', lane: 'visual', items: [] }] };
  const calls = [];
  const state = { location: { root: { toString: () => 'file:///fixture' },
    editUri: { toString: () => 'file:///edit.json' } }, playheadT: 0, fps: 30,
    commands: { executeCommand: async id => id === 'akari.catalog.resolveOverlay'
      ? { relativePath: 'assets/overlay/telop.html', meta: {}, fragment: '' }
      : { x: 0, y: 0, width: 1920, height: 1080 } },
    frameAt: seconds => seconds * 30, async commitEditMutation(_label, mutate) {
      const before = JSON.stringify(doc);
      doc = mutate(doc);
      return { before, after: JSON.stringify(doc) };
    },
    pushHistory() {}, historyService: { isTop: () => true },
    focusTimelineItem: async (id, options) => { calls.push({ id, options }); },
    footer: {}, messages: { warn: assert.fail }, errorMessage: error => error.message };
  const id = await method.call(state, { key: 'overlay/lower-third-clean', t: 3 });
  assert.equal(doc.tracks.flatMap(track => track.items)[0].id, id);
  assert.equal(doc.tracks.flatMap(track => track.items)[0].at, 90);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),
    [{ id, options: { seekIfOutside: true, reveal: true, pulse: true } }]);
});

test('caption ids resolve for focus and the playhead hit element is only ruler high', () => {
  const resolve = timelineMethod('resolveFocusSelection');
  assert.deepEqual(resolve.call({ cutItemIds: [], expandedTimelineTreeRows: [], overlays: [], layers: [],
    captions: [{ id: 'caption-1' }], audioBgm: undefined, audioNarration: [], audioSfx: [] }, 'caption-1'),
  { kind: 'caption', id: 'caption-1' });
  const start = source.indexOf("const playheadLineHit = document.createElement('div')");
  const end = source.indexOf('this.playhead.append(playheadLineHit, this.playheadHandle);', start)
    + 'this.playhead.append(playheadLineHit, this.playheadHandle);'.length;
  const element = { dataset: {}, style: {}, addEventListener() {} };
  const createHit = new Function('document', 'RULER_BAND_HEIGHT_PX',
    `return function () { ${source.slice(start, end)}; return playheadLineHit; };`)(
    { createElement: () => element }, 14);
  const hit = createHit.call({ playheadHandle: {}, playhead: { append() {} }, onPlayheadHandlePointerDown() {} });
  assert.equal(hit.style.top, '0');
  assert.equal(hit.style.height, '14px');
  assert.equal(hit.style.bottom, undefined);
});

test('audio ids resolve to the audio badge even when a tree row has the same id', () => {
  const resolve = timelineMethod('resolveFocusSelection');
  const state = { cutItemIds: [], expandedTimelineTreeRows: [
    { id: 'audio-1', itemKind: 'media', trackId: 'a1' }], overlays: [], layers: [], captions: [],
  audioBgm: undefined, audioNarration: [], audioSfx: [{ id: 'audio-1' }] };
  assert.deepEqual(resolve.call(state, 'audio-1'), { kind: 'audio', id: 'audio-1' });
});

test('focusing newly loaded audio selects, pulses, and scrolls its timeline badge', async () => {
  const classes = new Set();
  const badge = { dataset: { akariItemKind: 'audio', akariItemId: 'audio-1' },
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    getBoundingClientRect: () => ({ top: 200, bottom: 220, height: 20 }) };
  const state = { cutItemIds: [], expandedTimelineTreeRows: [{ id: 'audio-1',
    itemKind: 'media', trackId: 'a1', at: 1, duration: 2 }],
    timelineTreeRows: [{ id: 'audio-1', at: 1, duration: 2 }], overlays: [], layers: [], captions: [],
    audioBgm: undefined, audioNarration: [], audioSfx: [{ id: 'audio-1', t: 1, duration: 2 }],
    playheadT: 0, viewStart: 0, multiSelection: [], stripScroll: { scrollTop: 0,
      getBoundingClientRect: () => ({ top: 0, bottom: 100, height: 100 }) },
    strip: { querySelectorAll: () => [badge] }, trackHeaders: { querySelectorAll: () => [] },
    applyCaptionStateClasses() {},
    selectionKey: selected => `${selected.kind}:${selected.id}`,
    visibleDuration: () => 10, selectionRenderKeys: timelineMethod('selectionRenderKeys'),
    resolveFocusSelection: timelineMethod('resolveFocusSelection'),
    focusRangeFor: timelineMethod('focusRangeFor'),
    applySelectionClass: timelineMethod('applySelectionClass'),
    applyFocusPulseClass: timelineMethod('applyFocusPulseClass'),
    revealPreviewSelection: timelineMethod('revealPreviewSelection', { nearestTimelineViewStart }),
    pulseFocusedItem: timelineMethod('pulseFocusedItem', {
      window: { setTimeout: () => 1, clearTimeout() {} }, FOCUS_PULSE_DURATION_MS: 1600
    }),
    applySelection(selected) { this.selection = selected; this.applySelectionClass(); }
  };
  assert.equal(await timelineMethod('focusTimelineItem').call(state, 'audio-1',
    { reveal: true, pulse: true }), true);
  assert.deepEqual(state.selection, { kind: 'audio', id: 'audio-1' });
  assert.equal(classes.has('akari-annotations-selected'), true);
  assert.equal(classes.has('akari-annotations-focus-pulse'), true);
  assert.ok(state.stripScroll.scrollTop > 0);
});
