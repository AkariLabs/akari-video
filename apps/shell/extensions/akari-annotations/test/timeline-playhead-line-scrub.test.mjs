import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isPlayheadLineGrab } from '../lib/common/timeline-frame-draw.js';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const style = readFileSync(new URL('../src/browser/style/annotations-widget-style.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
globalThis.Element ??= class { closest() { return null; } };

function method(name, dependencies = {}) {
  const member = widget.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, name);
  const code = ts.transpileModule(`class Handler { ${member.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn Handler.prototype.${name};`)(...Object.values(dependencies));
}

function emitter() {
  const listeners = new Map();
  const classes = new Set();
  return {
    style: {}, dataset: {}, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name)
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    fire(type, event) { for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...event }); },
    setPointerCapture(id) { this.capture = id; },
    hasPointerCapture(id) { return this.capture === id; },
    releasePointerCapture() { this.capture = undefined; },
    getBoundingClientRect: () => ({ left: 100, width: 1 }),
    contains: () => false
  };
}

function fixture() {
  const seeks = [], cancelled = [];
  const strip = emitter(), playhead = emitter(), playheadHandle = emitter(), stripScroll = emitter();
  const state = { toolMode: 'select', strip, playhead, playheadHandle, stripScroll,
    selectionMarquee: { style: {} }, selection: { kind: 'cut', index: 2 }, playheadT: 1,
    dragState: { pointerId: 7 },
    cancelDrag(value) { cancelled.push(value); this.dragState = undefined; },
    timeAtClientX: x => x / 10, percent: t => t * 10,
    requestSeek: (t, options) => { seeks.push([t, options]); },
    outputToSource: t => t + 1,
    beginPlayheadScrub: method('beginPlayheadScrub'),
    isSelectPlayheadLineGrab: method('isSelectPlayheadLineGrab', { isPlayheadLineGrab }),
    onSelectPlayheadLinePointerDown: method('onSelectPlayheadLinePointerDown'),
    onSelectPlayheadLinePointerMove: method('onSelectPlayheadLinePointerMove', { DRAG_THRESHOLD_PX: 3 }),
    onSelectPlayheadLinePointerUp: method('onSelectPlayheadLinePointerUp'),
    onStripPointerDown: method('onStripPointerDown', { DRAG_THRESHOLD_PX: 3 }) };
  return { state, seeks, cancelled };
}

const pointer = (x, y = 20) => ({ pointerId: 7, button: 0, clientX: x, clientY: y,
  target: new Element(), preventDefault() { throw Error('pointerdown prevented'); },
  stopPropagation() { throw Error('pointerdown stopped'); } });

test('horizontal line drag cancels clip drag and seeks from the deciding move', () => {
  const { state, seeks, cancelled } = fixture();
  state.onSelectPlayheadLinePointerDown(pointer(100));
  assert.equal(state.pendingLineGrab?.pointerId, 7);
  state.onSelectPlayheadLinePointerMove(pointer(103));
  assert.equal(cancelled.length, 1);
  assert.equal(state.playheadT, 10.3);
  assert.deepEqual(seeks, [[10.3, { domain: 'output' }]]);
  assert.deepEqual(state.selection, { kind: 'cut', index: 2 });
  assert.equal(state.suppressNextStripClick, true);
  assert.equal(state.playheadHandle.dataset.grabbing, 'true');
  state.playheadHandle.fire('pointerup', pointer(103));
  assert.equal(state.selectedSourceT, 11.3);
  assert.equal(state.playheadHandle.dataset.grabbing, undefined);
});

test('click near line leaves clip selection path untouched', () => {
  const { state, seeks, cancelled } = fixture();
  state.onSelectPlayheadLinePointerDown(pointer(102));
  state.onSelectPlayheadLinePointerUp(pointer(102));
  assert.equal(state.pendingLineGrab, undefined);
  assert.deepEqual(seeks, []);
  assert.deepEqual(cancelled, []);
  assert.equal(state.suppressNextStripClick, undefined);
});

test('horizontal line drag abandons the pending marquee without gap selection', () => {
  const { state } = fixture();
  state.dragState = undefined;
  state.selectGapAt = () => assert.fail('gap selected');
  state.applySelection = () => assert.fail('selection changed');
  state.onSelectPlayheadLinePointerDown(pointer(100));
  state.onStripPointerDown(pointer(100));
  assert.equal(state.activeLineMarquee?.pointerId, 7);
  state.onSelectPlayheadLinePointerMove(pointer(104));
  state.strip.fire('pointermove', pointer(104));
  state.strip.fire('pointerup', pointer(104));
  assert.equal(state.activeLineMarquee, undefined);
  assert.equal(state.selectionMarquee.style.display, 'none');
  assert.equal(state.playheadT, 10.4);
});

test('vertical movement and distant press do not scrub', () => {
  const { state, seeks, cancelled } = fixture();
  state.onSelectPlayheadLinePointerDown(pointer(100));
  state.onSelectPlayheadLinePointerMove(pointer(101, 24));
  assert.equal(state.pendingLineGrab, undefined);
  assert.deepEqual(seeks, []);
  assert.deepEqual(cancelled, []);
  state.onSelectPlayheadLinePointerDown(pointer(106));
  assert.equal(state.pendingLineGrab, undefined);
});

test('pointercancel restores the hollow handle and removes capture', () => {
  const { state } = fixture();
  state.onSelectPlayheadLinePointerDown(pointer(100));
  state.onSelectPlayheadLinePointerMove(pointer(103));
  assert.equal(state.playheadHandle.capture, 7);
  state.playheadHandle.fire('pointercancel', pointer(103));
  assert.equal(state.playheadHandle.capture, undefined);
  assert.equal(state.playheadHandle.dataset.grabbing, undefined);
});

test('frame tool keeps its original line grab route', () => {
  const frame = method('frameToolPlayheadLineGrab', { isPlayheadLineGrab });
  const { state } = fixture();
  state.toolMode = 'frame';
  state.onSelectPlayheadLinePointerDown(pointer(100));
  assert.equal(state.pendingLineGrab, undefined);
  assert.equal(frame.call(state, pointer(104)), true);
  assert.equal(frame.call(state, pointer(106)), false);
});

test('playhead uses the theme color with a hollow idle handle and resize cursor', () => {
  assert.match(source, /const PLAYHEAD_COLOR = 'var\(--akari-tl-playhead\)'/u);
  const line = source.slice(source.indexOf('Object.assign(this.playhead.style'), source.indexOf('this.playheadHandle.addEventListener'));
  assert.match(line, /width: '1px'/u);
  assert.match(line, /fill="none"/u);
  assert.match(line, /style="stroke: \$\{PLAYHEAD_COLOR\}"/u);
  assert.doesNotMatch(line, /boxShadow|filter|dropShadow|textShadow/iu);
  assert.match(style, /akari-annotations-line-grab-hover[^\n]*cursor: ew-resize|akari-annotations-line-grab-hover[\s\S]*?cursor: ew-resize/u);
  assert.match(style, /data-grabbing="true"[\s\S]*?fill:\s*var\(--akari-tl-playhead\)/u);
  assert.doesNotMatch(style, /akari-annotations-line-grab-hover:hover|akari-annotations-playhead:hover/u);
});
