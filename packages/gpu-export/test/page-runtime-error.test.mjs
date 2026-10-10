import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';
import test from 'node:test';
import vm from 'node:vm';

test('page run turns a plain rejection into an Error with recent warnings', async () => {
  const source = (await readFile(new URL('../src/page-runtime.js', import.meta.url), 'utf8'))
    .replace('  window.__akariGpuRun = async function () {',
      '  warn("decoder retry");\n  window.__akariGpuRun = async function () {');
  const checkpoints = [];
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: {}, akariGpu: {
    async config() { throw { name: 'DecodeError', reason: 'stalled' }; },
    async checkpoint(value) { checkpoints.push(value); },
  } };
  const channel = new MessageChannel();
  try {
    vm.runInNewContext(source, { window, MessageChannel: class { constructor() { return channel; } },
      console: { warn() {} }, setTimeout, clearTimeout });
    await assert.rejects(window.__akariGpuRun(), (error) => {
      assert.equal(error.name, 'Error');
      assert.match(error.message, /DecodeError.*stalled/u);
      assert.match(error.message, /recent warnings:\n- decoder retry/u);
      return true;
    });
    assert.equal(checkpoints[0].warnings[0], 'decoder retry');
    assert.deepEqual(JSON.parse(JSON.stringify(checkpoints[0].decoder)), {
      stallMs: 2_000, recoveryAttempts: 1, tickTimeoutMs: 10_000, recoveries: 0, recoveryFailures: 0,
    });
  } finally { channel.port1.close(); channel.port2.close(); }
});

test('failed checkpoint keeps decoder recovery counts after engine disposal', async () => {
  const source = await readFile(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
  const checkpoints = [];
  const pools = [];
  const FE = {
    WebGL2Compositor: class { dispose() {} },
    FrameMetrics: class {},
    ClipSessionPool: class {
      constructor(_id, _url, options) {
        this.stats = { decoderRecoveries: 2, decoderRecoveryFailures: 1 };
        options.onWarning('decoder recovery exhausted after 3 recreation(s)');
        pools.push(this);
      }
      rangeFetchStats() { return this.stats; }
      destroy() { this.stats = null; }
    },
    LookaheadFrameSource: class { clear() {} },
    StreamReaper: class {},
    SpriteCompositor: class { dispose() {} },
    buildResolvedTimelinePlan() { return { totalDuration: 1 }; },
    summarizePrefetchStats(statsList) {
      return {
        decoderRecoveries: statsList.reduce((sum, stats) => sum + stats.decoderRecoveries, 0),
        decoderRecoveryFailures: statsList.reduce((sum, stats) => sum + stats.decoderRecoveryFailures, 0),
      };
    },
  };
  const window = { __AKARI_GPU_CONFIG__: {}, AkariFrameEngine: FE, akariGpu: {
    async config() {
      return {
        width: 640, height: 360, fps: 30,
        edit: { sources: [{ id: 'clip', path: 'clip.mp4' }], cuts: [] },
        decoder: { stallMs: 15, recoveryAttempts: 3, tickTimeoutMs: 30_000 },
        spriteManifest: { statics: null },
      };
    },
    async checkpoint(value) { checkpoints.push(value); },
  } };
  const document = { getElementById() { return { getContext() { return null; } }; } };
  const channel = new MessageChannel();
  try {
    vm.runInNewContext(source, { window, document, performance, MessageChannel: class { constructor() { return channel; } },
      console: { warn() {} }, setTimeout, clearTimeout });
    await assert.rejects(window.__akariGpuRun(), /not iterable/u);
    assert.equal(pools.length, 1);
    assert.equal(pools[0].stats, null);
    assert.equal(checkpoints.length, 1);
    assert.equal(checkpoints[0].status, 'failed');
    assert.equal(checkpoints[0].decoder.recoveries, 2);
    assert.equal(checkpoints[0].decoder.recoveryFailures, 1);
  } finally { channel.port1.close(); channel.port2.close(); }
});
