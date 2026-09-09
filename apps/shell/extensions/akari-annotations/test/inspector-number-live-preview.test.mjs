import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNumberField,
  INSPECTOR_LIVE_PREVIEW_THROTTLE_MS
} from '../lib/browser/inspector/number-field.js';

class FakeElement {
  children = [];
  listeners = new Map();
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener));
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault() {}, ...event });
    }
  }
  blur() { this.emit('blur'); }
  setPointerCapture(id) { this.pointerId = id; }
  hasPointerCapture(id) { return this.pointerId === id; }
  releasePointerCapture() { this.pointerId = undefined; }
}

function setup(t, options = {}) {
  const window = new FakeElement();
  for (const [key, value] of Object.entries({ window, document: { createElement: () => new FakeElement() } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else delete globalThis[key];
    });
  }
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, at: now + delay });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const tick = duration => {
    const end = now + duration;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  };
  const previews = [];
  const commits = [];
  const field = createNumberField({
    name: 'x', label: 'X', value: 0, step: 1, ...options,
    onPreview: value => previews.push(value),
    onCommit: async value => { commits.push(value); return true; }
  });
  const [handle, input, , buttons] = field.children;
  return {
    input, handle, buttons, window, previews, commits, tick,
    type(value, event) { input.value = value; input.emit('input', event); }
  };
}

test('number input previews immediately and throttles the latest trailing value without committing', t => {
  const f = setup(t);
  const delay = INSPECTOR_LIVE_PREVIEW_THROTTLE_MS;
  f.type('3');
  assert.deepEqual(f.previews, [3]);
  f.tick(5);
  f.type('30');
  f.tick(5);
  f.type('300');
  f.tick(delay - 11);
  assert.deepEqual(f.previews, [3]);
  f.tick(1);
  assert.deepEqual(f.previews, [3, 300]);
  assert.equal(f.input.value, '300');
  f.tick(delay);
  f.type('45');
  assert.deepEqual(f.previews, [3, 300, 45]);
  assert.deepEqual(f.commits, []);
});

test('number input rejects unfinished and nonfinite values and cancels pending previews', t => {
  const f = setup(t);
  for (const invalid of ['', ' ', '-', '+', '.', '1.', '1e', '1e-', 'NaN', 'Infinity', '1e999', '12px']) {
    f.type('3');
    f.type('30');
    const before = [...f.previews];
    f.type(invalid);
    f.tick(100);
    assert.deepEqual(f.previews, before, invalid);
    assert.equal(f.input.value, invalid);
  }
  assert.deepEqual(f.commits, []);
});

test('number input clamps and converts display units without rewriting the typed text', t => {
  const f = setup(t, { value: 0.8, step: 0.01, displayScale: 100, displayOffset: 10, min: 0, max: 1 });
  for (const [text, expected] of [['35', 0.25], ['150', 1], ['-25', 0], ['+4.5e1', 0.35]]) {
    f.tick(30);
    f.type(text);
    assert.equal(f.previews.at(-1), expected);
    assert.equal(f.input.value, text);
  }
  assert.deepEqual(f.commits, []);
});

test('number input suppresses IME composition and resumes preview after compositionend', t => {
  const f = setup(t);
  f.type('3');
  f.type('30');
  f.input.emit('compositionstart');
  f.tick(100);
  f.type('300');
  f.tick(100);
  assert.deepEqual(f.previews, [3]);
  f.input.emit('compositionend');
  assert.deepEqual(f.previews, [3, 300]);
  f.type('400', { isComposing: true });
  f.tick(100);
  assert.deepEqual(f.previews, [3, 300]);
  assert.deepEqual(f.commits, []);
});

for (const action of ['blur', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', '▲', '▼', 'drag']) {
  test(`number input preserves ${action} behavior and cancels stale trailing previews`, t => {
    const f = setup(t, { value: 2 });
    f.type('3');
    f.type('30');
    let expected = 30;
    if (action === 'blur') f.input.blur();
    else if (action === '▲' || action === '▼') {
      expected = action === '▲' ? 31 : 29;
      f.buttons.children[action === '▲' ? 0 : 1].emit('click');
    } else if (action === 'drag') {
      expected = 12;
      f.handle.emit('pointerdown', { button: 0, pointerId: 1, clientX: 0 });
      f.window.emit('pointermove', { pointerId: 1, clientX: 10 });
      f.window.emit('pointerup', { pointerId: 1 });
    } else {
      if (action === 'Escape') expected = 2;
      if (action === 'ArrowUp') expected = 31;
      if (action === 'ArrowDown') expected = 29;
      f.input.emit('keydown', { key: action });
    }
    assert.deepEqual(f.commits, [expected]);
    assert.equal(f.previews.at(-1), expected);
    assert.equal(Number(f.input.value), expected);
    const before = [...f.previews];
    f.tick(100);
    assert.deepEqual(f.previews, before);
  });
}
