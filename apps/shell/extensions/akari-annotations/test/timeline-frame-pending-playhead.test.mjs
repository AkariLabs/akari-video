import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as frameDraw from '../lib/common/timeline-frame-draw.js';
import { insertTrack, insertItem, indexEditV2Items } from '../lib/common/edit-v2-mutations.js';
import { emptyFrameTransform } from '../lib/browser/inspector/frame-geometry.js';

const source = readFileSync(new URL('../lib/browser/akari-annotations-widget.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(`    ${start}(`), source.indexOf(`    ${end}(`, source.indexOf(`    ${start}(`)));
const frames = new Map();
let frameId = 0;
const flushFrame = () => {
  const scheduled = [...frames.values()]; frames.clear();
  for (const callback of scheduled) callback();
};

class FakeElement {
  constructor() { this.style = {}; this.dataset = {}; this.children = []; this.listeners = new Map(); }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = undefined; }
  closest() { return this.occupied ? this : null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = undefined; }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 100, height: 200 }; }
}

const Widget = new Function('Element', 'document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame',
  'timeline_frame_draw_1', 'timeline_snap_1', 'SNAP_THRESHOLD_PX', 'edit_v2_mutations_1',
  'frame_geometry_1', 'akari_annotations_commands_2', `return class {
    ${section('onPlayheadHandlePointerDown', 'panViewBy')}
    ${section('beginFrameDraw', 'gapSnapshot')}
    ${section('async commitEmptyFrame', 'frameToolSelectionTarget')}
    ${section('frameToolSelectionTarget', 'timelineSelectionFromElement')}
  }`)(FakeElement, { createElement: () => new FakeElement() }, { addEventListener() {}, removeEventListener() {} },
  callback => { const id = ++frameId; frames.set(id, callback); return id; }, id => frames.delete(id),
  frameDraw, { snapThresholdSecondsFor: () => 0 }, 8,
  { insertTrack, insertItem, indexEditV2Items }, { emptyFrameTransform },
  { OPEN_AKARI_INSPECTOR_ID: 'akari.inspector.open' });

function fixture(service = {}) {
  const uri = { toString: () => 'file:///project' };
  const strip = new FakeElement();
  strip.clientHeight = 200;
  const stripContent = new FakeElement();
  const real = new FakeElement();
  let draws = 0;
  const notices = [];
  const widget = Object.assign(new Widget(), {
    toolMode: 'frame', isDisposed: false, location: { root: uri, editUri: uri },
    editDocument: { version: 2, output: { fps: 30 }, tracks: [{ id: 'v', lane: 'visual', items: [] }], sources: [] },
    focusScope: { rootId: null }, laneLayout: { tracks: [{ id: 'v', top: 50, height: 40 }] },
    strip, stripContent, timelineOverlay: new FakeElement(), selectionMarquee: new FakeElement(), playhead: new FakeElement(),
    playheadHandle: new FakeElement(), fps: 30, viewStart: 0, layoutViewDuration: 10,
    percent: t => t * 10, layoutPercent: t => t * 10, visibleDuration: () => 10,
    timeAtClientX: x => x / 10, outputSnapCandidates: () => [], isTrackLocked: () => false,
    computeTrackAutoNames: () => new Map(),
    annotationsService: service, cutItemIds: [], timelineTreeRows: [],
    commands: { async executeCommand() {} }, requestSeek: async () => {}, outputToSource: t => t,
    applySelection(selection) { this.selection = selection; },
    showNotice(message) { notices.push(message); }, errorMessage: error => error.message,
    async commitEditMutation(_label, mutate) {
      this.editDocument = mutate(this.editDocument);
      this.cutItemIds = this.editDocument.tracks[0].items.map(item => item.id);
    },
    renderStrip() {
      assert.equal(stripContent.children.some(child => child.dataset.akariFramePending === 'true'), true);
      stripContent.appendChild(real);
    },
    pendingFrameClearers: new Set(),
    beginFrameDraw(event) { draws++; return Widget.prototype.beginFrameDraw.call(this, event); }
  });
  widget.playhead.rect = { left: 40, top: 0, width: 2, height: 200 };
  return { widget, strip, stripContent, real, notices, get draws() { return draws; } };
}

const event = (target, clientX, pointerId = 1) => ({ target, clientX, clientY: 70, pointerId, button: 0,
  preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; } });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('frame mode grabs the line through a clip, scrubs, and never creates a frame', () => {
  let rpc = 0;
  const f = fixture({ createEmptyGenerationFrame() { rpc++; } });
  const clip = new FakeElement(); clip.occupied = true;
  f.widget.onStripPointerDown(event(clip, 44));
  assert.equal(f.widget.playheadHandle.capture, 1);
  f.widget.playheadHandle.listeners.get('pointermove')(event(clip, 70));
  assert.equal(f.widget.playheadT, 7);
  assert.equal(f.widget.playhead.style.left, '70%');
  f.widget.playheadHandle.listeners.get('pointerup')(event(clip, 70));
  assert.equal(f.widget.selectedSourceT, 7);
  assert.equal(f.draws, 0);
  assert.equal(rpc, 0);
});

test('frame mode starts drawing five pixels away from the line', () => {
  const f = fixture();
  f.widget.onStripPointerDown(event(new FakeElement(), 46));
  assert.equal(f.draws, 1);
  assert.equal(f.strip.capture, 1);
});

test('select mode leaves a clip on the line to its selection handler', () => {
  const f = fixture();
  f.widget.toolMode = 'select';
  const clip = new FakeElement(); clip.occupied = true;
  const down = event(clip, 41);
  f.widget.onStripPointerDown(down);
  assert.equal(down.stopped, undefined);
  assert.equal(f.widget.playheadHandle.capture, undefined);
  assert.equal(f.draws, 0);
});

test('pending frame appears before RPC and stays until a real frame is rendered', async () => {
  let resolveRpc;
  const f = fixture({ createEmptyGenerationFrame: () => new Promise(resolve => { resolveRpc = resolve; }) });
  const empty = new FakeElement();
  f.widget.beginFrameDraw(event(empty, 10));
  f.strip.listeners.get('pointerup')(event(empty, 50));
  const pending = f.stripContent.children.find(child => child.dataset.akariFramePending === 'true');
  assert.ok(pending);
  assert.match(pending.className, /akari-annotations-frame-pending/);
  assert.equal(pending.textContent, '空の枠 · 作成中');
  assert.equal(pending.style.left, '10%');
  assert.equal(pending.style.top, '50px');
  assert.equal(pending.style.width, '40%');
  assert.equal(f.stripContent.children.includes(f.real), false);
  resolveRpc({ relativePath: 'assets/generated/frame.png' });
  await tick();
  assert.equal(f.stripContent.children.includes(pending), false);
  assert.equal(f.stripContent.children.includes(f.real), true);
  assert.deepEqual(f.notices, ['空の枠を置きました。']);
});

test('failed RPC removes the pending frame and shows its reason', async () => {
  let rejectRpc;
  const f = fixture({ createEmptyGenerationFrame: () => new Promise((_resolve, reject) => { rejectRpc = reject; }) });
  const empty = new FakeElement();
  f.widget.beginFrameDraw(event(empty, 10));
  f.strip.listeners.get('pointerup')(event(empty, 50));
  assert.equal(f.stripContent.children.some(child => child.dataset.akariFramePending === 'true'), true);
  rejectRpc(new Error('PNG failed'));
  await tick();
  assert.equal(f.stripContent.children.some(child => child.dataset.akariFramePending === 'true'), false);
  assert.deepEqual(f.notices, ['空の枠を置けません: PNG failed']);
});

test('new visual and audio rows show pending frames in their new bands', () => {
  for (const [clientY, text, top, height] of [
    [30, '空の枠 · 作成中', '0px', '50px'],
    [110, '空の枠（音） · 作成中', '90px', '52px']
  ]) {
    const f = fixture({ createEmptyGenerationFrame: () => new Promise(() => {}),
      createEmptyAudioFrame: () => new Promise(() => {}) });
    const empty = new FakeElement();
    const down = { ...event(empty, 10), clientY };
    const up = { ...event(empty, 50), clientY };
    f.widget.beginFrameDraw(down);
    f.strip.listeners.get('pointerup')(up);
    const pending = f.stripContent.children.find(child => child.dataset.akariFramePending === 'true');
    assert.equal(pending.textContent, text);
    assert.equal(pending.style.top, top);
    assert.equal(pending.style.height, height);
    f.widget.isDisposed = true;
    flushFrame();
  }
});

test('overlapping RPCs keep separate pending frames until their own result', async () => {
  const resolves = [];
  const f = fixture({ createEmptyGenerationFrame: () => new Promise(resolve => resolves.push(resolve)) });
  const empty = new FakeElement();
  f.widget.beginFrameDraw(event(empty, 10, 1));
  f.strip.listeners.get('pointerup')(event(empty, 30, 1));
  f.widget.beginFrameDraw(event(empty, 60, 2));
  f.strip.listeners.get('pointerup')(event(empty, 90, 2));
  assert.equal(f.stripContent.children.filter(child => child.dataset.akariFramePending === 'true').length, 2);
  resolves[0]({ relativePath: 'assets/generated/first.png' });
  await tick();
  assert.equal(f.stripContent.children.filter(child => child.dataset.akariFramePending === 'true').length, 1);
  resolves[1]({ relativePath: 'assets/generated/second.png' });
  await tick();
  assert.equal(f.stripContent.children.filter(child => child.dataset.akariFramePending === 'true').length, 0);
});

test('pending frame follows layout changes and clears when the project changes', () => {
  const f = fixture({ createEmptyGenerationFrame: () => new Promise(() => {}) });
  const empty = new FakeElement();
  f.widget.beginFrameDraw(event(empty, 10));
  f.strip.listeners.get('pointerup')(event(empty, 50));
  const pending = f.stripContent.children.find(child => child.dataset.akariFramePending === 'true');
  f.widget.layoutPercent = t => (t - 0.5) * 20;
  f.widget.layoutViewDuration = 5;
  f.widget.laneLayout.tracks[0].top = 60;
  flushFrame();
  assert.equal(pending.style.left, '10%');
  assert.equal(pending.style.width, '80%');
  assert.equal(pending.style.top, '60px');
  f.widget.location = { root: f.widget.location.root, editUri: { toString: () => 'file:///other' } };
  flushFrame();
  assert.equal(f.stripContent.children.includes(pending), false);
});

test('disposing the widget clears a pending frame', () => {
  const f = fixture({ createEmptyGenerationFrame: () => new Promise(() => {}) });
  const empty = new FakeElement();
  f.widget.beginFrameDraw(event(empty, 10));
  f.strip.listeners.get('pointerup')(event(empty, 50));
  assert.equal(f.stripContent.children.some(child => child.dataset.akariFramePending === 'true'), true);
  f.widget.isDisposed = true;
  flushFrame();
  assert.equal(f.stripContent.children.some(child => child.dataset.akariFramePending === 'true'), false);
});

test('playhead grab is inclusive at four pixels and rejects five pixels', () => {
  assert.equal(frameDraw.isPlayheadLineGrab({ clientX: 104, playheadClientX: 100, tolerancePx: 4 }), true);
  assert.equal(frameDraw.isPlayheadLineGrab({ clientX: 105, playheadClientX: 100, tolerancePx: 4 }), false);
});
