import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const compiled = new URL('../lib/electron-main/visual-thumbnail-capture.js', import.meta.url);
const source = readFileSync(compiled, 'utf8');
const require = createRequire(compiled);
function capture(isPackaged, failFirst, BrowserWindow = class { constructor() { assert.fail('invalid input must not create a window'); } }) {
  const exports = {};
  vm.runInNewContext(source, { exports, setTimeout, clearTimeout, process: { env: { AKARI_VISUAL_THUMBNAIL_FAIL_FIRST: failFirst } },
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
  for (let i = 0; i < 2; i++) await assert.rejects(run({ html: '<html>', width: 100, height: 100 }),
    /Visual renderer failed: Error: Error: Visual renderer readiness timed out/);
  assert.equal(destroyed, 2, 'failure must release both the window and the single-flight lock');
});
