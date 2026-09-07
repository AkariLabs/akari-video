import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/frame-engine-client.ts', import.meta.url), 'utf8');
const start = source.indexOf('private async renderFrame(');
const end = source.indexOf('private updateMetrics(', start);
assert.ok(start >= 0 && end > start);
const renderSource = source.slice(start, end).trim();
const declaration = stripTypeScriptTypes(renderSource.replace(
  'private async renderFrame(', 'async function renderFrame(',
));

function harness() {
  const pending = [];
  const closed = [];
  const runtime = {
    disposed: false, totalDuration: 10, fps: 30, lastCutIndex: null,
    currentAccesses: null, currentDecodedFrames: null,
    measurements: {
      lateFrames: 0, presentedAt: [], seekBeforeMs: [], seekAfterMs: [],
      boundaryBefore: { total: 0, late: 0, hit: 0 },
      boundaryAfter: { total: 0, late: 0, hit: 0 },
    },
    audio: { noteRendered() {} },
    scheduler: { isWarmed: () => false, notePresented() {} },
    updateMetrics() {},
    ui: { error: { hidden: false, textContent: 'Frame engine: previous failure' } },
  };
  const render = runInNewContext(`(${declaration})`, {
    performance: { now: () => 100 },
    evaluationPlanFromResolvedTimeline: (_timeline, timeUs) => ({
      base: [{ id: `cut-${timeUs / 1e6}` }], layers: [], timeUs,
    }),
    evaluateFrame: plan => new Promise((resolve, reject) => {
      const streamId = plan.base[0].id;
      runtime.currentAccesses.push({ streamId, hit: streamId === 'cut-1', decodeMs: 3 });
      runtime.currentDecodedFrames.push({ streamId, timestampUs: plan.timeUs });
      pending.push({ resolve: () => resolve({ close: () => closed.push(streamId) }), reject });
    }),
  });
  return { runtime, render: render.bind(runtime), pending, closed };
}

test('overlapping seeks retain their own accesses and decoded frame after A finishes first', async () => {
  const h = harness();
  const a = h.render(1, 'seek', 10);
  const accessesA = h.runtime.currentAccesses;
  const decodedA = h.runtime.currentDecodedFrames;
  const b = h.render(2, 'seek', 20);
  const accessesB = h.runtime.currentAccesses;
  const decodedB = h.runtime.currentDecodedFrames;
  assert.notEqual(accessesA, accessesB);
  assert.notEqual(decodedA, decodedB);
  h.pending[0].resolve();
  await assert.doesNotReject(a);
  assert.equal(h.runtime.currentAccesses, accessesB);
  assert.equal(h.runtime.currentDecodedFrames, decodedB);
  assert.equal(h.runtime.lastBaseFrame.timestampUs, 1e6);
  assert.equal(h.runtime.boundaryLastMs.hit, true);
  assert.deepEqual(h.runtime.measurements.seekAfterMs, [90]);
  assert.deepEqual(h.runtime.measurements.seekBeforeMs, []);
  h.pending[1].resolve();
  await assert.doesNotReject(b);
  assert.equal(h.runtime.lastBaseFrame.timestampUs, 2e6);
  assert.equal(h.runtime.boundaryLastMs.hit, false);
  assert.deepEqual(h.runtime.measurements.seekBeforeMs, [80]);
  assert.deepEqual(h.runtime.measurements.seekAfterMs, [90]);
  assert.equal(h.runtime.measurements.boundaryBefore.hit, 1);
  assert.equal(h.runtime.currentAccesses, null);
  assert.equal(h.runtime.currentDecodedFrames, null);
  assert.deepEqual(h.closed, ['cut-1', 'cut-2']);
});

test('successful presentation clears an earlier error, while a failed render leaves it visible', async () => {
  const h = harness();
  const failure = h.render(1, 'seek');
  h.pending[0].reject(new Error('decoder failed'));
  await assert.rejects(failure, /decoder failed/u);
  assert.equal(h.runtime.ui.error.hidden, false);
  assert.equal(h.runtime.ui.error.textContent, 'Frame engine: previous failure');
  const recovery = h.render(2, 'seek');
  h.pending[1].resolve();
  await recovery;
  assert.equal(h.runtime.ui.error.hidden, true);
  assert.equal(h.runtime.ui.error.textContent, '');
});

test('render reads local arrays and releases shared destinations only when still owned', () => {
  assert.doesNotMatch(renderSource, /this\.(?:currentAccesses|currentDecodedFrames)\??\.(?:find|filter|length|every)\b/u);
  assert.match(renderSource, /if \(this\.currentAccesses === accesses\) this\.currentAccesses = null/u);
  assert.match(renderSource, /if \(this\.currentDecodedFrames === decodedFrames\) this\.currentDecodedFrames = null/u);
});
