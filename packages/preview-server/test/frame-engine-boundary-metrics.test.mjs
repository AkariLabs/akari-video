import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');

function method(marker, nextMarker, replacement, globals = {}) {
  const start = source.indexOf(marker);
  const end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start);
  const declaration = source.slice(start, end).trim().replace(marker, replacement);
  return runInNewContext(`(${stripTypeScriptTypes(declaration)})`, globals);
}

test('boundary metrics expose hit and last elapsed/decode beside late, including a text row', () => {
  assert.match(source, /boundaryBefore: \{ total: number; late: number; hit: number \}/u);
  assert.match(source, /boundaryAfter: \{ total: number; late: number; hit: number \}/u);
  assert.match(source, /dataset\.boundaryLateAfter = [^;]+;\s*this\.ui\.metrics\.dataset\.boundaryHitAfter = `\$\{m\.boundaryAfter\.hit\}\/\$\{m\.boundaryAfter\.total\}`/u);
  assert.match(source, /dataset\.boundaryLastMs = this\.boundaryLastMs == null \? ''/u);
  assert.match(source, /baseAccesses = this\.currentAccesses\.filter\(access =>\s*plan\.base\.some\(layer => layer\.id === access\.streamId\)\)/u);
  assert.match(source, /baseAccesses\.length > 0 && baseAccesses\.every\(access => access\.hit === true\)/u);
  assert.match(source, /if \(hit\) bucket\.hit \+= 1/u);
  assert.match(source, /decode: Math\.max\(0, \.\.\.baseAccesses\.map\(access => access\.decodeMs\)\)/u);
  assert.match(source, /after  \$\{m\.boundaryAfter\.late\}[^\n]+\n\s*`boundary last /u);
});

test('boundary aggregation uses nonempty base accesses, their maximum decode, and the warmed bucket', async () => {
  for (const warmed of [false, true]) {
    for (const [accesses, expectedHit, expectedDecode] of [
      [[{ streamId: 'cut-1', hit: true, decodeMs: 2 },
        { streamId: 'cut-2', hit: true, decodeMs: 5 },
        { streamId: 'layer-person', hit: false, decodeMs: 100 }], true, 5],
      [[{ streamId: 'cut-1', hit: true, decodeMs: 2 },
        { streamId: 'cut-2', hit: false, decodeMs: 7 }], false, 7],
      [[{ streamId: 'layer-person', hit: true, decodeMs: 100 }], false, 0],
      [[], false, 0],
    ]) {
      let clock = 0;
      const runtime = {
        fps: 30, totalDuration: 20, lastCutIndex: 0,
        measurements: {
          lateFrames: 0, presentedAt: [],
          boundaryBefore: { total: 0, late: 0, hit: 0 },
          boundaryAfter: { total: 0, late: 0, hit: 0 },
        },
        audio: { noteRendered() {} },
        scheduler: { isWarmed: () => warmed, notePresented() {} },
        updateMetrics() {},
      };
      const render = method('private async renderFrame(', 'private updateMetrics(', 'async function renderFrame(', {
        performance: { now: () => clock },
        evaluationPlanFromResolvedTimeline: () => ({ base: [{ id: 'cut-1' }, { id: 'cut-2' }], layers: [] }),
        evaluateFrame: async () => {
          runtime.currentAccesses.push(...accesses);
          clock += 40;
          return { close() {} };
        },
      });
      await render.call(runtime, 10, 'playback');
      const bucket = warmed ? 'boundaryAfter' : 'boundaryBefore';
      const other = warmed ? 'boundaryBefore' : 'boundaryAfter';
      assert.deepEqual(runtime.measurements[bucket], { total: 1, late: 1, hit: Number(expectedHit) });
      assert.equal(runtime.measurements[other].total, 0);
      assert.equal(runtime.boundaryLastMs.elapsed, 40);
      assert.equal(runtime.boundaryLastMs.decode, expectedDecode);
      assert.equal(runtime.boundaryLastMs.hit, expectedHit);
      await render.call(runtime, 10 + 1 / 30, 'playback');
      assert.equal(runtime.measurements[bucket].total, 1, 'same-cut frames do not count as boundaries');
    }
  }
});

test('boundary datasets format one decimal and stay empty before the first boundary', () => {
  const update = method('private updateMetrics(', 'private showError(', 'function updateMetrics(', {
    percentile: () => null,
  });
  const runtime = {
    measurements: {
      presentedAt: [], seekBeforeMs: [], seekAfterMs: [], warmupMs: [],
      boundaryBefore: { total: 0, late: 0, hit: 0 },
      boundaryAfter: { total: 2, late: 0, hit: 1 },
    },
    scheduler: { state: () => ({ coverage: { warmed: 1, needed: 1 }, leadInSeconds: 2.5 }) },
    audio: { debug: () => ({
      scheduled: { speech: 0 }, speechDecode: { totalMs: 0 },
      prefetch: { pending: 0, decodedBytes: 0, items: 0, elapsedMs: 0 },
    }) },
    compositor: { uploadPath: 'direct' },
    ui: { metrics: { dataset: {} } },
    boundaryLastMs: null,
  };
  update.call(runtime);
  assert.equal(runtime.ui.metrics.dataset.boundaryHitAfter, '1/2');
  assert.equal(runtime.ui.metrics.dataset.boundaryLastMs, '');
  runtime.boundaryLastMs = { elapsed: 12.34, decode: 0.56, hit: true };
  update.call(runtime);
  assert.equal(runtime.ui.metrics.dataset.boundaryLastMs, '12.3/0.6');
  assert.match(runtime.ui.metrics.textContent, /boundary last +12\.3 ms \/ decode 0\.6 ms  hit true/u);
});
