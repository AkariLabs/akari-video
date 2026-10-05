import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');

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
    style: {}, dataset: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    fire(type, event) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
    setPointerCapture(id) { this.capture = id; },
    hasPointerCapture(id) { return this.capture === id; },
    releasePointerCapture() { this.capture = undefined; }
  };
}

function fixture() {
  const callbacks = new Map(), cancelled = [], seeks = [];
  let nextFrame = 1;
  const requestAnimationFrame = callback => { const id = nextFrame++; callbacks.set(id, callback); return id; };
  const cancelAnimationFrame = id => { cancelled.push(id); callbacks.delete(id); };
  const state = {
    playheadT: 0, fps: 30, viewStart: 0, visualThumbnails: { setPaused() {} },
    selectionModel: { snapshot: { kind: 'audio' } },
    playhead: { style: {} }, playheadHandle: emitter(), stripScroll: emitter(),
    strip: { getBoundingClientRect: () => ({ left: 0, right: 1000, width: 1000 }) },
    hoverSeek: { style: { display: 'block' }, dataset: {} },
    timeAtClientX: x => x / 100, percent: t => t * 10,
    outputToSource: t => t, requestSeek: (time, options) => { seeks.push([time, options]); },
    canHandlePlaybackTick: () => true, visibleDuration: () => 10,
    resolveCaptionAtPlayhead: () => undefined, applyCaptionStateClasses() {},
    beginPlayheadScrub: method('beginPlayheadScrub', { requestAnimationFrame, cancelAnimationFrame }),
    handlePlaybackTick: method('handlePlaybackTick', { PLAYHEAD_FOLLOW_THRESHOLD: .8 }),
    updateHoverSeek: method('updateHoverSeek'),
    scheduleSeekHoverRefresh: method('scheduleSeekHoverRefresh', { requestAnimationFrame })
  };
  return { state, callbacks, cancelled, seeks,
    flush() { for (const [id, callback] of [...callbacks]) { callbacks.delete(id); callback(); } } };
}

const pointer = x => ({ pointerId: 1, clientX: x });
const tick = (state, time, playing = false) => state.handlePlaybackTick({ time, playing });

test('a paused tick cannot return the line to an old seek while dragging', () => {
  const { state } = fixture();
  state.beginPlayheadScrub(pointer(0));
  state.playheadHandle.fire('pointermove', pointer(500));
  assert.equal(state.playheadT, 5);
  assert.equal(state.playhead.style.left, '50%');
  tick(state, 2);
  assert.equal(state.playheadT, 5);
  assert.equal(state.playhead.style.left, '50%');
  assert.equal(state.selectionModel.snapshot.playheadSeconds, 2);
});

test('ten pointer moves share one seek frame and use its latest position', () => {
  const { state, callbacks, seeks, flush } = fixture();
  state.beginPlayheadScrub(pointer(0));
  for (let x = 100; x <= 1000; x += 100) state.playheadHandle.fire('pointermove', pointer(x));
  assert.equal(state.playheadT, 10);
  assert.equal(state.playhead.style.left, '100%');
  assert.equal(callbacks.size, 1);
  assert.equal(seeks.length, 0);
  flush();
  assert.deepEqual(seeks, [[10, { domain: 'output' }]]);
});

test('pointerup cancels a pending frame and synchronously seeks the exact final position', () => {
  const { state, callbacks, cancelled, seeks, flush } = fixture();
  state.beginPlayheadScrub(pointer(0));
  state.playheadHandle.fire('pointermove', pointer(487));
  state.playheadHandle.fire('pointerup', pointer(487));
  assert.equal(state.playheadT, 4.87);
  assert.equal(state.playhead.style.left, '48.7%');
  assert.equal(state.selectedSourceT, 4.87);
  assert.equal(state.activePlayheadScrubCleanup, undefined);
  assert.deepEqual(cancelled, [1]);
  assert.equal(callbacks.size, 0);
  flush();
  assert.deepEqual(seeks, [[4.87, { domain: 'output' }]]);
  tick(state, 2);
  assert.equal(state.playheadT, 4.87);
});

test('the final tick releases the hold; subsequent paused ticks can move the head', () => {
  const { state } = fixture();
  state.beginPlayheadScrub(pointer(0));
  state.playheadHandle.fire('pointermove', pointer(500));
  state.playheadHandle.fire('pointerup', pointer(500));
  tick(state, 4);
  assert.equal(state.playheadT, 5);
  tick(state, 5 + 1 / 60);
  assert.equal(state.playheadScrubHold, undefined);
  tick(state, 6);
  assert.equal(state.playheadT, 6);
  assert.equal(state.playhead.style.left, '60%');
});

test('playing ticks and the 1.5 second timeout each release a finished scrub', () => {
  for (const [playing, expired] of [[true, false], [false, true]]) {
    const { state } = fixture();
    state.beginPlayheadScrub(pointer(0));
    state.playheadHandle.fire('pointermove', pointer(500));
    state.playheadHandle.fire('pointercancel', pointer(500));
    assert.equal(state.playheadT, 5);
    if (expired) state.playheadScrubHold.until = Date.now() - 1;
    tick(state, 7, playing);
    assert.equal(state.playheadScrubHold, undefined);
    assert.equal(state.playheadT, 7);
    assert.equal(state.playhead.style.left, '70%');
  }
});

test('hover guide stays hidden and strip hover does not measure the playhead during scrub', () => {
  const { state, callbacks } = fixture();
  state.beginPlayheadScrub(pointer(0));
  state.seekHoverPoint = { x: 200, y: 20 };
  state.scheduleSeekHoverRefresh();
  assert.equal(callbacks.size, 0);
  state.updateHoverSeek({ target: null, buttons: 0, clientX: 200 });
  assert.equal(state.hoverSeek.style.display, 'none');
  let measured = 0;
  state.playhead.getBoundingClientRect = () => { measured++; throw Error('forced layout'); };
  const start = source.indexOf("this.stripScroll.addEventListener('pointermove', event => {");
  assert.ok(start >= 0);
  const end = source.indexOf('\n        });', start) + '\n        });'.length;
  const listener = new Function(`return function () { ${source.slice(start, end)} }`)();
  listener.call(state);
  state.stripScroll.fire('pointermove', { buttons: 0, clientX: 200, clientY: 20 });
  assert.equal(measured, 0);
});

test('playing ticks still move the head outside a drag', () => {
  const { state } = fixture();
  tick(state, 7, true);
  assert.equal(state.playheadT, 7);
  assert.equal(state.playhead.style.left, '70%');
});
