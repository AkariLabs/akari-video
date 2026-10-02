import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { findActiveCaptions } from '../../../../../packages/edit-store/lib/caption-window.js';
import { evaluateHostTemplate } from './helpers/host-template.mjs';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
function section(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.style = {}; this.classList = { toggle() {} };
    this.animation = { pause() {}, currentTime: null, effect: { getComputedTiming: () => ({ endTime: 1000 }) } };
  }
  insertBefore(child, before) {
    child.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  getAnimations() { return [this.animation]; }
}

test('host template rejects a page binding absent from the host imports', () => {
  assert.throws(() => evaluateHostTemplate(source, '${missingHostBinding.toString()}'),
    /missing host import for template binding: missingHostBinding/);
});

test('concurrent rows keep independent styles, animation clocks, hit regions and event identity', () => {
  const layer = new Element(), rows = new Map(), synced = [];
  const cues = [
    { id: 'speech', start: 2, end: 4, text: 'lower', textStyle: { zone: 'bottom' } },
    { id: 'placed', start: 0, end: 6, text: 'upper', textStyle: { zone: 'top' } },
  ];
  const context = vm.createContext({
    captionLayer: layer, captionRows: rows, captions: cues, outputTime: 3,
    selectedCaptionId: null, selectedCaptionIds: new Set(), requestedCutId: undefined, activeCaptionEdit: null,
    captionStylePreview: { resolve: caption => caption },
    captionPortrait: false, captionLineBudget: 20,
    document: { createElement: () => new Element() },
    window: { AkariEditKernel: { findActiveCaptions }, addEventListener() {}, akari: { interaction: { syncOverlayHitRegion: plate => synced.push(plate) } } },
    clamp: (n, a, b) => Math.min(b, Math.max(a, n)),
    applyCaptionStyleVars: (cue, plate) => { plate.style = { ...cue.textStyle }; },
    applyCaptionRowSelectionAttrs() {}, renderPlainCaptionFragment: cue => cue.text,
    captionEntryAnimationsSettledFn: () => true,
  });
  vm.runInContext(section('const captionForEvent = event => {', 'const previewMessage ='), context);
  vm.runInContext(evaluateHostTemplate(source, section('const applyRichCaptionLayers =', 'const richPreviewWords =')), context);
  vm.runInContext(section('const renderCaptionRow = (caption, row) => {', 'const renderTransitionPlate ='), context);
  vm.runInContext('renderCaption()', context);
  assert.deepEqual(layer.children.map(p => p.innerHTML), ['lower', 'upper']);
  assert.deepEqual(layer.children.map(p => p.id), ['caption-plate-speech', 'caption-plate-placed']);
  assert.deepEqual(layer.children.map(p => p.style.zone), ['bottom', 'top']);
  assert.deepEqual(layer.children.map(p => p.animation.currentTime), [1000, 3000]);
  assert.deepEqual(synced, layer.children);
  for (const plate of layer.children) {
    context.event = { target: { closest: () => plate } };
    assert.equal(vm.runInContext('captionForEvent(event)', context).id, plate.dataset.captionKey);
  }
  const placed = layer.children[1];
  context.outputTime = 4;
  vm.runInContext('renderCaption()', context);
  assert.deepEqual(layer.children, [placed]);
  assert.equal(placed.animation.currentTime, 4000);
  context.outputTime = 6;
  vm.runInContext('renderCaption()', context);
  assert.equal(layer.children.length, 0);
});
