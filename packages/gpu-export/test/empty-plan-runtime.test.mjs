import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadFrameAt(FE) {
  const source = await readFile(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
  const start = source.indexOf('    async frameAt(seconds) {');
  assert.ok(start >= 0, 'GpuFrameEngineRuntime.frameAt not found');
  const end = source.indexOf('\n    dispose() {', start);
  assert.ok(end > start, 'GpuFrameEngineRuntime.frameAt end not found');
  const method = source.slice(start, end);
  return vm.runInNewContext(`(class Runtime { ${method} }).prototype.frameAt`, { FE });
}

test('page runtime delegates an empty evaluation plan without throwing', async () => {
  const expected = { surface: 'black' };
  const calls = [];
  const FE = {
    evaluationPlanFromResolvedTimeline(_timeline, timeUs, _sources, output) {
      calls.push({ kind: 'plan', timeUs, output });
      return { timeUs, base: [], layers: [], output };
    },
    evaluateFrame(plan, evaluationContext) {
      calls.push({ kind: 'evaluate', plan, evaluationContext });
      return expected;
    },
  };
  const frameAt = await loadFrameAt(FE);
  const runtime = {
    timeline: { totalDuration: 6 },
    sources: new Map(),
    output: { width: 640, height: 360, colorSpace: 'bt709-limited' },
    compositor: {},
    metrics: {},
    fps: 30,
    reaper: {
      reap(plan, frameNumber) {
        calls.push({ kind: 'reap', plan, frameNumber });
        return { released: 0, liveStreams: 0 };
      },
      released() { return 0; },
    },
  };

  const actual = await frameAt.call(runtime, 3);
  assert.equal(actual, expected);
  assert.equal(calls[0].timeUs, 3_000_000);
  // 回収は「plan を組んだ後・評価する前」。逆順だと解放したいフレームと新しいフレームが
  // 同時に生きる瞬間ができる（issue #52）
  assert.deepEqual(calls.map((call) => call.kind), ['plan', 'reap', 'evaluate']);
  assert.equal(calls[1].frameNumber, 90);
  assert.deepEqual(calls[2].plan.base, []);
  assert.deepEqual(calls[2].plan.layers, []);
  assert.equal(runtime.decoderSessions.live, 0);
  assert.equal(runtime.decoderSessions.released, 0);
});
