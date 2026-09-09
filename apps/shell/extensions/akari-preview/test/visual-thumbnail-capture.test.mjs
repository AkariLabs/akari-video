import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const compiled = new URL('../lib/electron-main/visual-thumbnail-capture.js', import.meta.url);
const source = readFileSync(compiled, 'utf8');
const require = createRequire(compiled);
function capture(isPackaged, failFirst, BrowserWindow = class { constructor() { assert.fail('invalid input must not create a window'); } }, timers = {}) {
  const exports = {};
  vm.runInNewContext(source, { exports, setTimeout, clearTimeout, ...timers, process: { env: { AKARI_VISUAL_THUMBNAIL_FAIL_FIRST: failFirst } },
    require: id => id === '@theia/core/electron-shared/electron'
      ? { app: { isPackaged }, BrowserWindow }
      : require(id) });
  return exports.captureVisualThumbnail;
}

test('development failure hook injects precisely the first N timeouts', async () => {
  const run = capture(false, '2');
  await assert.rejects(run(null), /Visual thumbnail capture timed out/);
  await assert.rejects(run(null), /Visual thumbnail capture timed out/);
  await assert.rejects(run(null), /Invalid visual thumbnail page/);
  await assert.rejects(run(null), /Invalid visual thumbnail page/);
});

test('packaged apps ignore the hook and invalid counts cannot inject failures', async () => {
  for (const [packaged, count] of [[true, '2'], [false, 'NaN'], [false, 'Infinity'], [false, '-1'], [false, '1.5']]) {
    const run = capture(packaged, count);
    await assert.rejects(run(null), /Invalid visual thumbnail page/);
    await assert.rejects(run(null), /Invalid visual thumbnail page/);
  }
});


test('renderer readiness failures cross Electron with explicit permanent failure text and destroy the window', async () => {
  let destroyed = 0;
  class Window {
    webContents = {
      setAudioMuted() {}, setWindowOpenHandler() {}, on() {},
      async executeJavaScript(script) {
        return vm.runInNewContext(script, { window: { __akariThumbnailReady: Promise.reject(Error('Visual renderer readiness timed out')) } });
      },
      async capturePage() { assert.fail('failed pages must not be captured'); }
    };
    async loadURL() {}
    isDestroyed() { return false; }
    destroy() { destroyed++; }
  }
  const run = capture(false, '0', Window);
  for (let i = 0; i < 2; i++) await assert.rejects(run({ html: '<html>', width: 100, height: 100, sampleTimes: [0] }),
    /Visual renderer failed: Error: Error: Visual renderer readiness timed out/);
  assert.equal(destroyed, 2, 'failure must release both the window and the single-flight lock');
});

function captureWindow(visibleAt = Infinity, seekFailure) {
  const state = { windows: 0, captures: 0, destroyed: 0, seeks: [], crops: [] };
  const bitmap = (width, height, visible) => ({
    toBitmap() {
      const pixels = Buffer.alloc(width * height * 4);
      if (visible) pixels[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3] = 255;
      return pixels;
    },
    getSize: () => ({ width, height }),
    resize: size => bitmap(size.width, size.height, visible),
    crop(region) { state.crops.push(region); return bitmap(region.width, region.height, visible); },
    toDataURL: () => `data:image/png;base64,${visible ? 'visible' : 'transparent'}`
  });
  class Window {
    constructor() { state.windows++; }
    webContents = {
      setAudioMuted() {}, setWindowOpenHandler() {}, on() {},
      async executeJavaScript(script) {
        if (script.includes('__akariThumbnailSeek')) {
          state.seeks.push(Number(script.match(/__akariThumbnailSeek\(([^)]+)\)/)[1]));
          assert.match(script, /error => \({ok:false,error:String\(error\)}\)/);
          if (seekFailure) return { ok: false, error: seekFailure };
        } else assert.match(script, /__akariThumbnailReady/);
        return { ok: true };
      },
      async capturePage({ width, height }) { return bitmap(width, height, state.captures++ === visibleAt); }
    };
    async loadURL() {}
    isDestroyed() { return false; }
    destroy() { state.destroyed++; }
  }
  return { Window, state };
}
const page = sampleTimes => ({ html: '<html>', width: 100, height: 100, sampleTimes });

test('stops at the first visible candidate, reusing one window and seeking only subsequent samples', async () => {
  const times = [6, 3, 0.8, 0.2];
  for (let index = 0; index < times.length; index++) {
    const { Window, state } = captureWindow(index);
    const result = await capture(false, '0', Window)(page(times));
    assert.equal(result.image, 'data:image/png;base64,visible');
    assert.deepEqual({ ...result.contentRect }, { x: 50, y: 50, width: 1, height: 1 });
    assert.equal(result.croppedImage, result.image);
    assert.equal(state.crops.length, 1, 'visible frames retain the main content crop path');
    assert.equal(state.windows, 1); assert.equal(state.destroyed, 1);
    assert.equal(state.captures, index + 1);
    assert.deepEqual(state.seeks, times.slice(1, index + 1));
  }
});

test('all-transparent requests exhaust only their candidates and destroy the window', async () => {
  for (const times of [[6, 3, 0.8, 0.2], [6]]) {
    const { Window, state } = captureWindow();
    await assert.rejects(capture(false, '0', Window)(page(times)), /Visual thumbnail has no visible pixels/);
    assert.equal(state.captures, times.length);
    assert.equal(state.windows, 1); assert.equal(state.destroyed, 1);
    assert.deepEqual(state.seeks, times.slice(1));
  }
});

test('invalid candidate lists reject before creating a window', async () => {
  const run = capture(false, '0');
  for (const times of [[], [0, 1, 2, 3, 4], [NaN], [Infinity], undefined]) {
    await assert.rejects(run(page(times)), /Invalid visual thumbnail page/);
  }
});

test('capture timeout allows two additional seconds per fallback sample', async () => {
  for (let count = 1; count <= 4; count++) {
    const { Window, state } = captureWindow();
    Window.prototype.loadURL = () => new Promise(() => {});
    const delays = []; const cleared = [];
    const timer = {};
    const run = capture(false, '0', Window, {
      setTimeout(callback, delay) { delays.push(delay); queueMicrotask(callback); return timer; },
      clearTimeout(value) { cleared.push(value); }
    });
    await assert.rejects(run(page([6, 3, 0.8, 0.2].slice(0, count))), /Visual thumbnail capture timed out/);
    assert.deepEqual(delays, [20000 + 2000 * (count - 1)]);
    assert.deepEqual(cleared, [timer]);
    assert.equal(state.destroyed, 1);
  }
});

test('seek failures preserve renderer error text and stop capture attempts', async () => {
  const { Window, state } = captureWindow(Infinity, 'Error: image decode failed');
  await assert.rejects(capture(false, '0', Window)(page([6, 3, 0.8, 0.2])),
    /Visual renderer failed: Error: Error: image decode failed/);
  assert.equal(state.captures, 1);
  assert.deepEqual(state.seeks, [3]);
  assert.equal(state.destroyed, 1);
});
