import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the same browser helper without launching a native renderer or emitting files.
const source = await readFile(new URL('./golden/fx-pass-timer.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { FX_COST_STAGES, drainGpu, measureFxPasses, median } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

function fakeGpu({ disjoint = false, invalid = false, fenceStatuses = [1] } = {}) {
  let active = null, next = 0, yielded = false;
  const deleted = [], deletedFences = [];
  const timer = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    ALREADY_SIGNALED: 1, CONDITION_SATISFIED: 2, TIMEOUT_EXPIRED: 5, WAIT_FAILED: 6,
    SYNC_GPU_COMMANDS_COMPLETE: 7,
    flush() { yielded = true; },
    fenceSync(condition, flags) {
      assert.equal(active, null);
      assert.equal(condition, 7);
      assert.equal(flags, 0);
      return { polls: 0 };
    },
    clientWaitSync(fence, flags, timeout) {
      assert.equal(yielded, true);
      assert.equal(flags, 0);
      assert.equal(timeout, 0);
      return fenceStatuses[Math.min(fence.polls++, fenceStatuses.length - 1)];
    },
    deleteSync(fence) { deletedFences.push(fence); },
    getParameter() { return yielded && disjoint; },
    createQuery() { return { id: next++, ns: invalid ? NaN : 1_000_000 }; },
    beginQuery(_target, query) { assert.equal(active, null, 'elapsed queries cannot nest'); active = query; },
    endQuery() { assert.ok(active); active = null; },
    getQueryParameter(query, key) { return key === 3 ? true : query.ns; },
    deleteQuery(query) { assert.notStrictEqual(query, active); deleted.push(query); },
  };
  return { gl, timer, deleted, deletedFences, count: () => next };
}

test('GPU drain polls a fence after yielding and deletes it on success', async () => {
  const gpu = fakeGpu({ fenceStatuses: [5, 2] });
  await drainGpu(gpu.gl, 100);
  assert.equal(gpu.deletedFences.length, 1);
  assert.equal(gpu.deletedFences[0].polls, 2);
});

test('GPU drain reports WAIT_FAILED and deletes the fence', async () => {
  const gpu = fakeGpu({ fenceStatuses: [6] });
  await assert.rejects(drainGpu(gpu.gl, 100), /status=6, elapsed=\d+ms/);
  assert.equal(gpu.deletedFences.length, 1);
});

test('GPU drain reports its deadline and deletes the fence', async () => {
  const gpu = fakeGpu({ fenceStatuses: [5] });
  await assert.rejects(drainGpu(gpu.gl, 0), /status=5, elapsed=\d+ms, deadline=0ms/);
  assert.equal(gpu.deletedFences.length, 1);
});

test('pass timing uses 60 separate frames with non-nested queries and reconciles both sums', async () => {
  const gpu = fakeGpu();
  const result = await measureFxPasses(gpu.gl, gpu.timer, 60, async (_index, mark) => {
    for (const stage of FX_COST_STAGES) mark(stage);
    mark(null);
  });
  assert.equal(result.passFrames, 60);
  assert.equal(result.passFailureReason, null);
  assert.deepEqual(result.passes, FX_COST_STAGES.map(stage => ({ stage, medianMs: 1, samples: 60 })));
  assert.equal(result.passMedianSumMs, 8);
  assert.equal(result.passFrameMedianMs, 8);
  assert.equal(gpu.deleted.length, 60 * FX_COST_STAGES.length);
  assert.equal(gpu.deleted.length, gpu.count());
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([9, 1, 2]), 2);
});

test('disjoint, invalid, missing, duplicate and failed pass queries release resources and are not zero-time evidence', async () => {
  for (const mode of ['disjoint', 'invalid', 'missing', 'duplicate', 'throw']) {
    const gpu = fakeGpu({ [mode]: true });
    const result = await measureFxPasses(gpu.gl, gpu.timer, 60, async (_index, mark) => {
      for (const stage of mode === 'missing' ? FX_COST_STAGES.slice(1) : FX_COST_STAGES) mark(stage);
      if (mode === 'duplicate') mark('prep');
      if (mode === 'throw') throw new Error('compose failed');
    });
    assert.equal(result.passFrames, 0, mode);
    assert.equal(typeof result.passFailureReason, 'string', mode);
    assert.equal(result.passMedianSumMs, null, mode);
    assert.ok(result.passes.every(pass => pass.samples === 0 && pass.medianMs === null), mode);
    assert.equal(gpu.deleted.length, gpu.count(), mode);
  }
  const gpu = fakeGpu();
  const unavailable = await measureFxPasses(gpu.gl, null, 60, async () => assert.fail('must not substitute CPU timing'));
  assert.equal(unavailable.passFrames, 0);
  assert.equal(unavailable.passMethod, 'unavailable');
  assert.equal(gpu.count(), 0);
});
