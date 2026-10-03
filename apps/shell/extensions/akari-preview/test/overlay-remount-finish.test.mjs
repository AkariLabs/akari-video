import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const service = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const adapter = service.split('const ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT = `')[1].split('`;')[0];
const section = (start, end) => {
  const from = bootstrap.indexOf(start);
  const to = bootstrap.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing bootstrap section: ${start}`);
  return bootstrap.slice(from, to);
};
const finishReceiver = section('const applyOverlayTracks = () => {', 'window.akari.updateCanvasCaptionLayer =')
  + section("window.addEventListener('akari-overlay-remount-complete'", 'const runTickGuarded =');

function harness() {
  const listeners = new Map();
  const frames = [];
  const stage = {
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    querySelectorAll() { return this.children.filter(child => child.hasAttribute('data-overlay-id')); },
  };
  const element = id => ({
    id, attrs: { 'data-overlay-id': id }, style: { zIndex: '', display: '' },
    hasAttribute(name) { return name in this.attrs; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
  });
  let mounts = 0;
  let finishTicks = 0;
  let failMount = false;
  const runtimeTicks = [];
  const state = { summary: { overlays: [] } };
  const runtime = {
    mount(summary) {
      mounts++;
      if (failMount) return Promise.reject(new Error('fixture mount failure'));
      stage.children = summary.overlays.map(overlay => element(String(overlay.id)));
      return Promise.resolve();
    },
    tick(timelineTime, isPlaying) { runtimeTicks.push({ timelineTime, isPlaying }); },
  };
  const interaction = { activePointerOperation: false, activeEdit: false };
  const akari = { runtime, state, interaction };
  const context = vm.createContext({
    window: {
      akari,
      addEventListener(type, listener) { listeners.set(type, listener); },
      dispatchEvent(event) { listeners.get(event.type)?.(event); },
    },
    document: { querySelectorAll: () => stage.querySelectorAll(), getElementById: () => stage },
    Event: class { constructor(type) { this.type = type; } },
    requestAnimationFrame(callback) { frames.push(callback); },
    stage,
    summary: state.summary,
    hiddenTracks: new Set(),
    captionLayer: { style: {} },
    zForItem: (_id, fallback) => fallback + 2,
    zForTrack: () => 10,
    previewDomOpacityFn: () => null,
    frameEngineMediaIdle: false,
    tick() { finishTicks++; },
    console: { error() {} },
  });
  vm.runInContext(adapter, context);
  vm.runInContext(finishReceiver, context);
  const setSummary = overlays => {
    const summary = { overlays };
    state.summary = summary;
    context.summary = summary;
  };
  return {
    runtime, stage, interaction, frames, setSummary, runtimeTicks,
    get mounts() { return mounts; },
    get finishTicks() { return finishTicks; },
    set failMount(value) { failMount = value; },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('remount completion styles the new container and runs one shell finish tick', async () => {
  const fixture = harness();
  await fixture.runtime.mount({ overlays: [] });
  fixture.setSummary([{ id: 'new-shape' }]);
  fixture.runtime.tick(1, false);
  await settle();
  assert.equal(fixture.mounts, 2);
  assert.notEqual(fixture.stage.children[0].style.zIndex, '');
  assert.equal(fixture.finishTicks, 1);
});

test('a busy interaction defers all intermediate summaries and remounts once after release', async () => {
  const fixture = harness();
  await fixture.runtime.mount({ overlays: [] });
  fixture.interaction.activePointerOperation = true;
  fixture.setSummary([{ id: 'old' }]);
  fixture.runtime.tick(1, false);
  fixture.setSummary([{ id: 'latest' }]);
  fixture.runtime.tick(2, false);
  // The summary can temporarily match the mounted version while playback moves on.
  fixture.setSummary([]);
  fixture.runtime.tick(3, true);
  fixture.setSummary([{ id: 'latest' }]);
  assert.equal(fixture.mounts, 1);
  assert.equal(fixture.frames.length, 1);
  fixture.interaction.activePointerOperation = false;
  fixture.frames.shift()();
  await settle();
  assert.equal(fixture.mounts, 2);
  assert.equal(fixture.stage.children[0].id, 'latest');
  assert.deepEqual(fixture.runtimeTicks.at(-1), { timelineTime: 3, isPlaying: true });
  assert.equal(fixture.finishTicks, 1);
});

test('text editing also defers remount until editing ends', async () => {
  const fixture = harness();
  await fixture.runtime.mount({ overlays: [] });
  fixture.interaction.activeEdit = true;
  fixture.setSummary([{ id: 'text' }]);
  fixture.runtime.tick(1, false);
  assert.equal(fixture.mounts, 1);
  fixture.interaction.activeEdit = false;
  fixture.frames.shift()();
  await settle();
  assert.equal(fixture.mounts, 2);
  assert.equal(fixture.finishTicks, 1);
});

test('failed remount still triggers one shell finish tick', async () => {
  const fixture = harness();
  await fixture.runtime.mount({ overlays: [] });
  fixture.failMount = true;
  fixture.setSummary([{ id: 'failed' }]);
  fixture.runtime.tick(1, false);
  await settle();
  assert.equal(fixture.finishTicks, 1);
});
