import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parseLibraryDragPayload, parseLibraryTransitionDragPayload } from '../lib/browser/library-drop-model.js';
import { hitTestTimelineTrackDrop } from '../lib/common/timeline-track-drop.js';
import { computeMaterialGhostRange, materialGhostRejectLabel, materialGhostVisibility } from '../lib/common/timeline-material-insert.js';
import { materialOverlapInsertIndex } from '../lib/common/material-drop-overlap.js';
import { insertTrack } from '../lib/common/edit-v2-mutations.js';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const names = ['isMaterialDragTransfer', 'handleMaterialDragOver', 'handleMaterialDrop',
  'isLibraryTransitionDragTransfer', 'handleLibraryTransitionDragOver', 'handleLibraryTransitionDrop',
  'readLibraryOverlayDropPayload', 'resolveMaterialDropTarget', 'updateMaterialGhost',
  'materialDropTargetWithoutOverlap'];
const methods = names.map(name => widget.members.find(member => member.name?.getText(ast) === name)?.getText(ast))
  .filter(Boolean);
const code = ts.transpileModule(`class Handler { ${methods.join('\n')} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const bindings = {
  MATERIAL_DRAG_MIME: 'application/x-akari-material', LIBRARY_DRAG_MIME: 'application/x-akari-library-item',
  parseLibraryDragPayload, parseLibraryTransitionDragPayload, hitTestTimelineTrackDrop,
  computeMaterialGhostRange, materialGhostRejectLabel, materialGhostVisibility,
  materialOverlapInsertIndex, SHAPE_PLACE_DEFAULT_DURATION_SECONDS: 5,
  LANE_GAP: 4, SUBROW_STRIDE: 32
};
const Handler = new Function(...Object.keys(bindings), `${code}\nreturn Handler;`)(...Object.values(bindings));

function fixture(zone = 'strip') {
  const handler = new Handler();
  const placed = [];
  Object.assign(handler, {
    location: { editUri: { toString: () => 'file:///edit.json' } }, playheadT: 7,
    materialPanelDropPoint: (x, y) => ({ x, y, zone }),
    readLibraryAssetDropPayload: () => undefined, readLibraryTextStyleDropPayload: () => undefined,
    readLibraryShapeDropPayload: () => undefined, readMaterialDropPayload: () => undefined,
    treeRowsByTrack: new Map(), timelineTreeRows: [], trackHeaders: { querySelectorAll: () => [] },
    strip: { getBoundingClientRect: () => ({ top: 0 }) },
    node: { querySelectorAll: () => [] }, stripContent: { querySelector: () => null },
    cutItemIds: [], footer: { textContent: '' },
    updateMaterialGhost() {}, updateMaterialDragAutoScroll() {}, stopMaterialDragAutoScroll() {},
    hideMaterialGhost() {}, clearLibraryTransitionDragState() {}, setHoveredTransitionDropTarget() {},
    materialDropTime: x => x / 10,
    addOverlayAtOutputPoint: async options => { placed.push(options); return 'overlay-1'; },
    isTrackLocked: () => false
  });
  return { handler, placed };
}

function dragEvent(payload, readable) {
  const event = { clientX: 30, clientY: 170, target: { closest: () => null },
    dataTransfer: { types: ['application/x-akari-library-item'], dropEffect: 'none',
      getData: () => readable ? JSON.stringify(payload) : '' },
    defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; } };
  return event;
}

test('overlay is copy on both drag surfaces and drops at the requested time in every panel zone', async () => {
  const payload = { kind: 'overlay', key: 'overlay/lower-third-clean', id: 'lower-third-clean',
    category: 'overlay', title: 'テロップ' };
  for (const [zone, row] of [['strip', 'visual'], ['strip', 'audio'], ['ruler-above', 'ruler'],
    ['header-column', 'header'], ['below-strip', 'margin']]) {
    const { handler, placed } = fixture(zone);
    const over = dragEvent(payload, false);
    over.clientY = row === 'visual' ? 30 : 170;
    handler.handleLibraryTransitionDragOver(over);
    if (!over.propagationStopped) handler.handleMaterialDragOver(over);
    assert.equal(over.defaultPrevented, true, zone);
    assert.equal(over.dataTransfer.dropEffect, 'copy', zone);
    const drop = dragEvent(payload, true);
    drop.clientY = over.clientY;
    handler.handleLibraryTransitionDrop(drop);
    if (!drop.propagationStopped) handler.handleMaterialDrop(drop);
    await Promise.resolve();
    assert.deepEqual(placed, [{ key: payload.key, t: zone === 'header-column' ? 7 : 3,
      editUri: 'file:///edit.json' }], row);
  }
});

test('internal library MIME without mirror state still gets copy; transition hit testing is deferred until drop', () => {
  const { handler } = fixture();
  const over = dragEvent({ kind: 'overlay' }, false);
  handler.handleLibraryTransitionDragOver(over);
  assert.equal(over.propagationStopped, false);
  handler.handleMaterialDragOver(over);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  assert.equal(over.defaultPrevented, true);
});

test('internal material MIME without mirror state still gets copy', () => {
  const { handler } = fixture();
  const over = dragEvent(undefined, false);
  over.dataTransfer.types = ['application/x-akari-material'];
  handler.handleMaterialDragOver(over);
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
});

test('transition mirror is not treated as material when MIME data is unreadable', () => {
  const { handler } = fixture();
  const over = dragEvent(undefined, false);
  handler.libraryDragPayload = { kind: 'transition', id: 'dissolve', name: 'Dissolve' };
  assert.equal(handler.isMaterialDragTransfer(over.dataTransfer), false);
  handler.libraryDragPayload = undefined;
  assert.equal(handler.isMaterialDragTransfer(over.dataTransfer), true);
});

test('ordinary track hit testing rejects audio rows and outside positions; material mode redirects only audio and locked rows', () => {
  const rows = [
    { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 2, track: 1, top: 20, height: 32 },
    { id: 'v1', lane: 'visual', acceptsItems: true, rawIndex: 1, track: 0, top: 60, height: 32 },
    { id: 'a1', lane: 'audio', acceptsItems: true, rawIndex: 0, track: 0, top: 100, height: 32 }
  ];
  assert.equal(hitTestTimelineTrackDrop(110, rows, 1).rejected, true);
  assert.equal(hitTestTimelineTrackDrop(400, rows, 1).rejected, true);
  assert.deepEqual(hitTestTimelineTrackDrop(110, rows, 1, () => false),
    { track: 0, top: 60, height: 32, rejected: false, targetTrackId: 'v1' });
  assert.deepEqual(hitTestTimelineTrackDrop(70, rows, 1, id => id === 'v1'),
    { track: 1, top: 20, height: 32, rejected: false, targetTrackId: 'v2' });
  assert.equal(hitTestTimelineTrackDrop(400, rows, 1, () => false).rejected, true);
});

test('video and shapes choose an unlocked visual row; audio chooses an unlocked audio row or creates one', () => {
  const { handler } = fixture();
  const tracks = [
    { id: 'visual-free', lane: 'visual' }, { id: 'visual-locked', lane: 'visual' },
    { id: 'audio-locked', lane: 'audio' }, { id: 'audio-free', lane: 'audio' }
  ];
  const layouts = tracks.map((track, index) => ({ ...track, rawIndex: index, track: index,
    top: index * 40, height: 32, acceptsItems: true }));
  handler.editDocument = { tracks };
  handler.laneLayout = { tracks: layouts };
  handler.timelineTrackDropLayouts = () => layouts;
  handler.isTrackLocked = id => id?.endsWith('-locked') ?? false;
  for (const kind of ['video', 'image']) {
    for (const y of [55, 95]) {
      const target = handler.resolveMaterialDropTarget(kind, y);
      assert.equal(target.rejected, false);
      assert.equal(target.targetTrackId, 'visual-free');
      assert.equal(target.top, 0);
    }
  }
  const audio = handler.resolveMaterialDropTarget('audio', 95);
  assert.equal(audio.rejected, false);
  assert.equal(audio.targetTrackId, 'audio-free');
  assert.equal(audio.top, 120);
  handler.updateMaterialGhost = Handler.prototype.updateMaterialGhost;
  handler.materialGhost = { style: {}, dataset: {} };
  handler.stripScroll = { scrollTop: 0 };
  handler.rulerRowHeightPx = () => 14;
  handler.materialGhostAllowed = () => true;
  handler.materialGhostDurationSeconds = () => 3;
  handler.materialDropTargetWithoutOverlap = target => target;
  handler.setGhostRange = () => {};
  handler.setGhostRejected = () => {};
  handler.hideTrackInsertIndicator = () => {};
  handler.showTrackInsertIndicatorAt = top => { handler.indicatorTop = top; };
  handler.positionInsertionGhost = () => {};
  handler.updateMaterialGhost(30, 55, { kind: 'image', relativePath: 'image.png' });
  assert.equal(handler.materialGhost.style.top, '14px');
  assert.equal(handler.materialGhost.style.display, 'block');
  handler.updateMaterialGhost(30, 95, { kind: 'audio', relativePath: 'audio.wav' });
  assert.equal(handler.materialGhost.style.top, '134px');
  handler.isTrackLocked = id => id?.startsWith('audio') ?? false;
  const newAudio = handler.resolveMaterialDropTarget('audio', 95);
  assert.equal(newAudio.createAudioTrack, true);
  assert.equal(newAudio.targetTrackId, undefined);
  handler.isTrackLocked = id => id?.startsWith('visual') ?? false;
  const newVisual = handler.resolveMaterialDropTarget('video', 55);
  assert.equal(newVisual.rejected, false);
  assert.equal(newVisual.insertIndex, tracks.length);
  assert.equal(newVisual.targetTrackId, undefined);
});

test('image redirected from audio inserts above the lowest visual row when that row overlaps', () => {
  const { handler } = fixture();
  const tracks = [
    { id: 'a1', lane: 'audio', items: [] },
    { id: 'v1', lane: 'visual', items: [{ id: 'cut-1', at: 90, duration: 150 }] }
  ];
  handler.editDocument = { tracks };
  handler.laneLayout = { tracks: [{ id: 'v1', top: 0, height: 32 }, { id: 'a1', top: 40, height: 32 }] };
  handler.timelineTrackDropLayouts = () => [
    { id: 'v1', lane: 'visual', acceptsItems: true, rawIndex: 1, track: 0, top: 0, height: 32 },
    { id: 'a1', lane: 'audio', acceptsItems: true, rawIndex: 0, track: 0, top: 40, height: 32 }
  ];
  handler.frameAt = seconds => Math.round(seconds * 30);
  const row = handler.resolveMaterialDropTarget('image', 55);
  assert.equal(row.targetTrackId, 'v1');
  assert.equal(row.insertIndex, undefined);
  const placement = Handler.prototype.materialDropTargetWithoutOverlap.call(handler, row, 3, 5);
  assert.equal(placement.insertIndex, 2, 'new track goes above v1, not between a1 and v1');
  assert.deepEqual(insertTrack({ version: 2, output: { fps: 30 }, tracks },
    { index: placement.insertIndex, lane: 'visual' }).tracks.map(track => track.id), ['a1', 'v1', 'v2']);
});

test('shape drag over audio and locked visual rows stays copy and drops onto the nearest unlocked visual row', () => {
  for (const y of [15, 95]) {
    const { handler } = fixture();
    const tracks = [{ id: 'a1', lane: 'audio', items: [] }, { id: 'v1', lane: 'visual', items: [] },
      { id: 'v2', lane: 'visual', items: [] }];
    handler.editDocument = { tracks };
    handler.laneLayout = { tracks: [{ id: 'v2', top: 0, height: 32 },
      { id: 'v1', top: 40, height: 32 }, { id: 'a1', top: 80, height: 32 }] };
    handler.timelineTrackDropLayouts = () => [
      { id: 'v2', lane: 'visual', acceptsItems: true, rawIndex: 2, track: 1, top: 0, height: 32 },
      { id: 'v1', lane: 'visual', acceptsItems: true, rawIndex: 1, track: 0, top: 40, height: 32 },
      { id: 'a1', lane: 'audio', acceptsItems: true, rawIndex: 0, track: 0, top: 80, height: 32 }
    ];
    handler.isTrackLocked = id => id === 'v2';
    handler.readLibraryShapeDropPayload = () => ({ kind: 'shape', preset: 'rectangle' });
    handler.updateShapeDropGhost = () => {};
    handler.materialDropTargetWithoutOverlap = target => target;
    const placed = [];
    handler.addShapeAt = options => placed.push(options);
    const over = dragEvent(undefined, false);
    over.clientY = y;
    handler.handleMaterialDragOver(over);
    assert.equal(over.dataTransfer.dropEffect, 'copy');
    const drop = dragEvent(undefined, true);
    drop.clientY = y;
    handler.handleMaterialDrop(drop);
    assert.equal(placed.length, 1);
    assert.equal(placed[0].timelineTarget.targetTrackId, 'v1');
    assert.equal(placed[0].timelineTarget.rejected, false);
  }
});

test('blur and viewport dragleave do not clear the library drag mirror', () => {
  const state = source.slice(source.indexOf('const onWindowLibraryDragLeave'), source.indexOf('window.addEventListener(LIBRARY_DRAG_START_EVENT'));
  assert.doesNotMatch(state, /this\.clearLibraryTransitionDragState\(\)/u);
});

test('library drag mirror survives blur and edge dragleave until dragend', () => {
  const start = source.indexOf('const onLibraryDragStart =');
  const end = source.indexOf('\n    }\n\n    protected configureIconButton', start);
  assert.ok(start >= 0 && end > start);
  const registrations = ts.transpileModule(`class Mirror { register() { ${source.slice(start, end)} } }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const listeners = new Map();
  const window = { innerWidth: 100, innerHeight: 100,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: () => {} };
  const Mirror = new Function('window', 'Disposable', 'parseLibraryDragPayload',
    'LIBRARY_DRAG_START_EVENT', 'LIBRARY_DRAG_END_EVENT',
    `${registrations}\nreturn Mirror;`)(window, { create: callback => ({ dispose: callback }) },
    parseLibraryDragPayload, 'akari.library.dragStart', 'akari.library.dragEnd');
  const mirror = Object.assign(new Mirror(), { toDispose: [],
    clearLibraryTransitionDragState() { this.libraryDragPayload = undefined; },
    renderStrip() {}, stopMaterialDragAutoScroll() {}, hideMaterialGhost() {} });
  mirror.register();
  const payload = { kind: 'transition', id: 'dissolve', name: 'ディゾルブ' };
  listeners.get('akari.library.dragStart')({ detail: payload });
  assert.deepEqual(mirror.libraryDragPayload, payload);
  listeners.get('blur')();
  listeners.get('dragleave')({ relatedTarget: null, clientX: 0, clientY: 50 });
  assert.deepEqual(mirror.libraryDragPayload, payload);
  listeners.get('akari.library.dragEnd')();
  assert.equal(mirror.libraryDragPayload, undefined);
});
