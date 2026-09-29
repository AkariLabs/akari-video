import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { renderOverlaySheet } from '../src/rasterize.mjs';

const edit = { output: { width: 320, height: 180, fps: 30 } };
const scene = '<script type="application/json" data-akari-3d-scene>{"texts":[{"id":"t","text":"A"}]}</script>';
const sheet = (overlays) => renderOverlaySheet({ overlays, edit, projectRoot: process.cwd(), duration: 35 });
const overlay = (id, start, html = scene) => ({ id, start, duration: 5, html });

test('3D scenes mount near their windows, wait before drawing, and remount on reverse seek', async () => {
  const html = sheet([overlay('a', 0), overlay('b', 1), overlay('c', 10), overlay('d', 20)]);
  const begin = html.indexOf('    window.__akariSeekVideos =');
  const end = html.indexOf('  </script>', begin);
  assert.ok(begin > 0 && end > begin);
  const events = [];
  const containers = [0, 1, 10, 20].map((start) => {
    const parentElement = {
      dataset: { start: String(start), duration: '5' }, style: {},
      toggleAttribute() {},
    };
    return { parentElement, querySelector: () => scene, id: String(start) };
  });
  const states = new Map(containers.map((container) => [container, 'disposed']));
  const runtime = {
    inspect(container) { return { status: states.get(container) }; },
    render(container, seconds) {
      if (seconds > 0) assert.equal(states.get(container), 'ready');
      events.push(`render:${container.id}:${seconds}`);
      if (states.get(container) === 'disposed') {
        states.set(container, 'loading');
        setTimeout(() => {
          if (states.get(container) === 'loading') states.set(container, 'ready');
        }, 30);
      }
    },
    dispose(container) {
      events.push(`dispose:${container.id}`);
      states.set(container, 'disposed');
    },
  };
  const window = { akari: { threeRuntime: runtime }, __akariSyncAnimations() {} };
  const document = {
    fonts: { ready: Promise.resolve() }, images: [],
    querySelectorAll(selector) {
      if (selector === '.akari-overlay-container > .scene-content') return containers;
      if (selector === '.akari-overlay-container') return containers.map((c) => c.parentElement);
      if (selector === 'video') return [];
      throw new Error(selector);
    },
  };
  for (const container of containers) {
    container.parentElement.querySelector = () => container;
  }
  vm.runInNewContext(html.slice(begin, end), { window, document, console, setTimeout, clearTimeout });
  await window.__akariReady;
  assert.deepEqual(events.filter((entry) => entry.startsWith('render:')), ['render:0:0', 'render:1:0', 'render:0:0']);
  assert.equal(states.get(containers[0]), 'ready');
  assert.equal(states.get(containers[1]), 'ready');
  assert.equal(states.get(containers[2]), 'disposed');
  assert.equal(states.get(containers[3]), 'disposed');
  assert.equal(window.__akariThreeWindowStats.created, 2);
  events.length = 0;
  await window.__akariSeek(8.5);
  assert.deepEqual(events, ['dispose:0', 'dispose:1', 'render:10:0']);
  assert.equal(states.get(containers[2]), 'loading');
  await window.__akariSeek(12);
  assert.equal(events.at(-1), 'render:10:2');
  assert.equal(states.get(containers[2]), 'ready');
  await window.__akariSeek(16);
  assert.equal(events.at(-1), 'dispose:10');
  await window.__akariSeek(30);
  await window.__akariSeek(11);
  assert.deepEqual(events.slice(-2), ['render:10:0', 'render:10:1']);
  assert.equal(window.__akariThreeWindowStats.liveMax, 2);
});

test('video seek includes active overlay and body video, but skips inactive overlay', async () => {
  const html = sheet([overlay('a', 0, '<video></video>'), overlay('b', 10, '<video></video>')]);
  const begin = html.indexOf('    window.__akariSeekVideos =');
  const end = html.indexOf('    window.__akariSeek =', begin);
  const seeked = [];
  const videos = [0, 10, null].map((start, index) => ({
    dataset: {}, loop: false, currentTime: 0, seeking: false, readyState: 3,
    pause() {},
    closest: () => start === null ? null : { dataset: { start: String(start), duration: '5' } },
    requestVideoFrameCallback(callback) { queueMicrotask(callback); return 1; },
    cancelVideoFrameCallback() {},
    set currentTime(value) { seeked.push(index); this._currentTime = value; },
    get currentTime() { return this._currentTime ?? 0; },
  }));
  const window = {};
  vm.runInNewContext(html.slice(begin, end), {
    window, document: { querySelectorAll: () => videos }, setTimeout, clearTimeout,
  });
  seeked.length = 0;
  await window.__akariSeekVideos(2);
  assert.deepEqual(seeked, [0, 2]);
});

test('non-3D sheets omit window mount; static sheet also omits video selection', () => {
  const staticSheet = sheet([overlay('a', 0, '<div>static</div>')]);
  assert.doesNotMatch(staticSheet, /syncThreeWindow|const owner = typeof video.closest/);
  for (const attr of ['data-akari-world-scene', 'data-akari-glass-scene']) {
    const output = sheet([overlay('a', 0, `<script type="application/json" ${attr}>{}</script>`)]);
    assert.doesNotMatch(output, /syncThreeWindow/);
  }
});
