import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../lib/electron-main/visual-thumbnail-capture.js', import.meta.url), 'utf8');
function captureHarness(alphas) {
  const windows = []; const seeks = []; const captures = []; const timeouts = [];
  class BrowserWindow {
    constructor() {
      windows.push(this);
      this.webContents = {
        setAudioMuted() {}, setWindowOpenHandler() {}, on() {},
        executeJavaScript: async script => { if (script.includes('Seek')) seeks.push(script); return true; },
        capturePage: async () => {
          captures.push(this);
          const alpha = alphas[captures.length - 1] ?? 0;
          return { toBitmap: () => Buffer.from([0, 0, 0, alpha]),
            resize: () => ({ toDataURL: () => 'visible-image' }) };
        }
      };
    }
    async loadURL() {}
    isDestroyed() { return !!this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const exports = {};
  vm.runInNewContext(source, { exports, require: () => ({ BrowserWindow }),
    setTimeout: (callback, ms) => { timeouts.push(ms); return setTimeout(callback, ms); }, clearTimeout });
  return { capture: exports.captureVisualThumbnail, windows, seeks, captures, timeouts };
}
const page = { html: '<html></html>', width: 480, height: 270, sampleTimes: [6, 3, 0.8, 0.2] };

test('capture seeks the same window and stops on the first visible candidate', async () => {
  for (let visible = 0; visible < 4; visible++) {
    const harness = captureHarness([...Array(visible).fill(0), 255]);
    assert.equal(await harness.capture(page), 'visible-image');
    assert.equal(harness.windows.length, 1);
    assert.equal(harness.captures.length, visible + 1);
    assert.ok(harness.captures.every(window => window === harness.windows[0]));
    assert.deepEqual(harness.seeks, page.sampleTimes.slice(1, visible + 1).map(t => `window.__akariThumbnailSeek(${t})`));
    assert.equal(harness.windows[0].destroyed, true);
  }
});

test('all-transparent candidates throw after at most four captures and release the window', async () => {
  const harness = captureHarness([0, 8, 0, 0]);
  await assert.rejects(harness.capture(page), /no visible pixels/);
  assert.equal(harness.windows.length, 1);
  assert.equal(harness.captures.length, 4);
  assert.equal(harness.windows[0].destroyed, true);
  await assert.rejects(harness.capture({ ...page, sampleTimes: [1] }), /no visible pixels/);
  assert.equal(harness.captures.length, 5, 'a one-candidate request captures only once');
});

test('invalid candidate lists are rejected before creating a window', async () => {
  const harness = captureHarness([]);
  for (const sampleTimes of [[], [1, 2, 3, 4, 5], [NaN], [Infinity], undefined]) {
    await assert.rejects(harness.capture({ ...page, sampleTimes }), /Invalid visual thumbnail page/);
  }
  assert.equal(harness.windows.length, 0);
});

test('capture deadline grows with candidate count and stays bounded at 26 seconds', async () => {
  for (let count = 1; count <= 4; count++) {
    const harness = captureHarness([255]);
    await harness.capture({ ...page, sampleTimes: page.sampleTimes.slice(0, count) });
    assert.deepEqual(harness.timeouts, [20000 + 2000 * (count - 1)]);
  }
});
