import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { findActiveCaptions } from '../public/edit-kernel.bundle.js';
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const section = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
};
class Plate {
  constructor() {
    this.children = []; this.dataset = {}; this.properties = new Map();
    this.style = { removeProperty: key => this.properties.delete(key), setProperty: (key, value) => this.properties.set(key, value) };
    this.classList = { add() {}, toggle() {} };
    this.animation = { pause() {}, currentTime: null };
  }
  insertBefore(child, before) {
    child.remove();
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
    child.parent = this;
  }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  getAnimations() { return [this.animation]; }
}

test('Web UI renders concurrent rows in array order with independent styles and cleans up expired rows', () => {
  const layer = new Plate();
  const cues = [
    { id: 'speech', start: 2, end: 4, text: 'speech', style_vars: { '--caption-bottom': '7%', '--caption-color': '#fff' } },
    { id: 'placed', start: 0, end: 6, text: 'placed', style_vars: { '--caption-top': '7%', '--caption-color': '#ff0' } },
  ];
  const context = vm.createContext({
    captionPlate: layer, captionFontsReady: true, captionsOutputClock: cues, outputTime: 3,
    captionsResolvedTimeline: true, summary: {}, findActiveCaptions,
    document: { createElement: () => new Plate() },
    normalizeWords: value => value ?? [], isPortraitOutput: () => false,
    replaceCaptionStyleVariables: (style, vars) => { for (const [k, v] of Object.entries(vars)) style.setProperty(k, v); },
    injectCaptionStyles() {}, esc: value => value,
  });
  vm.runInContext(section('const CAPTION_STYLE_VARS =', 'function collectExcludedCaptionIds'), context);
  vm.runInContext(section('const captionRows = new Map();', 'function esc(s)'), context);
  vm.runInContext('updateCaption(); syncCaptionAnimations()', context);
  const [speech, placed] = layer.children;
  assert.deepEqual(layer.children.map(p => p.id), ['caption-plate-speech', 'caption-plate-placed']);
  assert.match(speech.innerHTML, /speech/); assert.match(placed.innerHTML, /placed/);
  assert.equal(speech.properties.get('--caption-bottom'), '7%');
  assert.equal(placed.properties.get('--caption-top'), '7%');
  assert.equal(placed.properties.get('--caption-bottom'), undefined);
  // The per-row animation clock must not be borrowed from the first cue.
  speech.dataset.captionStart = '2'; placed.dataset.captionStart = '0';
  vm.runInContext('syncCaptionAnimations()', context);
  assert.deepEqual([speech.animation.currentTime, placed.animation.currentTime], [1000, 3000]);
  context.outputTime = 4;
  vm.runInContext('updateCaption()', context);
  assert.deepEqual(layer.children, [placed]);
  context.outputTime = 6;
  vm.runInContext('updateCaption()', context);
  assert.deepEqual(layer.children, []);
});
