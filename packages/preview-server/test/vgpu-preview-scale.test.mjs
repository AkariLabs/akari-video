import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return app.slice(from, to);
}
const settingsCode = section('const SETTINGS_KEY =', '\nconst isOutputMode');
const scaleCode = section('function normalizeVgpuPreviewScale(', '\n// --- Overlay runtime ---');

function setup(saved = {}) {
  let stored = JSON.stringify(saved);
  let redraws = 0;
  const buttons = [1, 0.5, 0.25].map(value => ({
    dataset: { vgpuScale: String(value) },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(event, handler) { this[event] = handler; },
  }));
  const context = vm.createContext({
    localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } },
    document: { querySelectorAll: () => buttons },
    isPlaying: false,
    updateOverlays: () => { redraws++; },
  });
  vm.runInContext(settingsCode + scaleCode, context);
  return { context, buttons, saved: () => JSON.parse(stored), redraws: () => redraws };
}

test('normalizes settings to the three numeric scales', () => {
  const { context } = setup();
  const normalize = vm.runInContext('normalizeVgpuPreviewScale', context);
  for (const value of [undefined, NaN, '0.5', 0.3, 2, null, 0, -1, Infinity]) {
    assert.equal(normalize(value), 0.5);
  }
  for (const value of [1, 0.5, 0.25]) assert.equal(normalize(value), value);
});

test('exactly three scale buttons are nested inside the zoom popup', () => {
  const start = html.indexOf('<div id="zoom-popup"');
  assert.ok(start >= 0);
  let depth = 0;
  let end;
  for (const match of html.slice(start).matchAll(/<\/?div\b[^>]*>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) { end = start + match.index + match[0].length; break; }
  }
  assert.ok(end > start);
  const buttons = [...html.matchAll(/<button\b[^>]*data-vgpu-scale="([^"]+)"[^>]*>/g)];
  assert.deepEqual(buttons.map(match => match[1]), ['1', '0.5', '0.25']);
  for (const match of buttons) {
    assert.ok(match.index > start && match.index < end);
    assert.match(match[0], /class="zoom-preset vgpu-scale-preset"/);
    assert.match(match[0], /aria-pressed="(?:true|false)"/);
  }
  assert.ok(app.includes("document.querySelectorAll('.zoom-preset[data-zoom]')"));
});

test('restores selection, persists only its setting and redraws while paused', () => {
  const state = setup({ zoom: 2, waveformVisible: true, vgpuPreviewScale: 0.25 });
  assert.deepEqual(state.buttons.map(btn => btn['aria-pressed']), ['false', 'false', 'true']);
  state.buttons[0].click();
  assert.equal(state.redraws(), 1);
  assert.deepEqual(state.saved(), { zoom: 2, waveformVisible: true, vgpuPreviewScale: 1 });
  assert.deepEqual(state.buttons.map(btn => btn['aria-pressed']), ['true', 'false', 'false']);
  state.context.isPlaying = true;
  state.buttons[1].click();
  assert.equal(state.redraws(), 1);
  assert.equal(state.saved().vgpuPreviewScale, 0.5);
  const invalid = setup({ vgpuPreviewScale: 0.3 });
  assert.equal(invalid.buttons[1]['aria-pressed'], 'true');
});

test('actual overlay tick forwards the current scale to the runtime', () => {
  const { context, buttons } = setup();
  const calls = [];
  const el = { getAnimations: () => [] };
  Object.assign(context, {
    overlays: [{ el, start: 0, duration: 10, visible: true, isVgpu: true, vgpuReady: true, fps: 24 }],
    window: { akari: { vgpuRuntime: { render: (...args) => calls.push(args) } } },
    performance: { now: () => 0 }, fps: 30, editMode: false,
  });
  vm.runInContext(section('  function tick(t) {', '\n  // 断片の顔ぶれ'), context);
  for (const [button, scale] of [[buttons[2], 0.25], [buttons[0], 1], [buttons[1], 0.5]]) {
    button.click();
    vm.runInContext('tick(2)', context);
    const [container, time, options] = calls.at(-1);
    assert.equal(container, el);
    assert.equal(time, 2);
    assert.equal(options.previewScale, scale);
    assert.equal(options.fps, 24);
  }
  assert.equal(calls.length, 3);
});
