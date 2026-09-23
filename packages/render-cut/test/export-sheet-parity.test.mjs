import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderOverlaySheet } from '../src/rasterize.mjs';

const output = { width: 320, height: 180, fps: 30 };
function sheet(html, start = 0, projectRoot = process.cwd()) {
  return renderOverlaySheet({
    overlays: [{ id: 'neutral', start, duration: 3, html }],
    edit: { output }, projectRoot, duration: start + 3,
  });
}

test('CSS pseudo-element clone stays on its pseudo-element', () => {
  const html = sheet('<div>Neutral</div>');
  const begin = html.indexOf('    (function() {', html.indexOf('// Overlay fragments'));
  const end = html.indexOf('    window.__akariSyncAnimations', begin);
  assert.ok(begin > 0 && end > begin);
  const cloneCalls = [];
  const target = { style: {}, animate: (frames, options) => {
    cloneCalls.push({ frames, options });
    return { pause() {}, set currentTime(_value) {} };
  } };
  let cancelled = 0;
  class CSSAnimation {}
  const animation = new CSSAnimation();
  animation.effect = {
    target, pseudoElement: '::before',
    getKeyframes: () => [{ opacity: 0 }, { opacity: 1 }],
    getTiming: () => ({ delay: 0, endDelay: 0, duration: 500, iterations: 1,
      iterationStart: 0, direction: 'normal', easing: 'linear', fill: 'both' }),
  };
  animation.cancel = () => { cancelled += 1; };
  const container = {
    dataset: { start: '2' }, hasAttribute: () => false, toggleAttribute() {},
    getAnimations: () => [animation],
  };
  vm.runInNewContext(html.slice(begin, end), {
    document: { querySelectorAll: () => [container] }, CSSAnimation,
  });
  assert.equal(cancelled, 1);
  assert.equal(target.style.animationName, undefined);
  assert.equal(cloneCalls.length, 1);
  assert.equal(cloneCalls[0].options.pseudoElement, '::before');
  assert.equal(cloneCalls[0].options.delay, 2000);
});

test('3D video texture seeks from item start, other video keeps composition time', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-export-engine-parity-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'dummy.glb'), Buffer.from([0x67,0x6c,0x54,0x46,2,0,0,0,12,0,0,0]));
  const html = sheet('<video></video><script type="application/json" data-akari-3d-scene>{"model":"dummy.glb"}</script>', 2, root);
  const begin = html.indexOf('    window.__akariSeekVideos =');
  const end = html.indexOf('    window.__akariSeek =', begin);
  assert.ok(begin > 0 && end > begin);
  const video = {
    loop: true, duration: 4, currentTime: 0, seeking: false, readyState: 3,
    dataset: { akariThreeVideoTexture: '', akariThreeItemStart: '2' }, pause() {},
    requestVideoFrameCallback(callback) { queueMicrotask(callback); return 1; },
    cancelVideoFrameCallback() {},
  };
  const window = {};
  vm.runInNewContext(html.slice(begin, end), {
    window, document: { querySelectorAll: () => [video] }, setTimeout, clearTimeout,
  });
  assert.equal((await window.__akariSeekVideos(2.5)).length, 0);
  assert.equal(video.currentTime, 0.5);
  video.dataset = {};
  assert.equal((await window.__akariSeekVideos(2.5)).length, 0);
  assert.equal(video.currentTime, 2.5);
});
