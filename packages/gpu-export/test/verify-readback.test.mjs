import assert from "node:assert/strict";
import test from "node:test";

import { createSpriteDrawTimingProbe } from "../src/verify-readback.js";

const labels = [
  "clear",
  "baseUpload",
  "baseDraw",
  "program",
  "bindTexture",
  "sampler",
  "uniform",
  "instanceUpload",
  "blend",
  "drawArrays",
  "flush",
];

test("sprite draw timing falls back to finish-delimited wall time for every label", () => {
  const gl = {
    getExtension: () => null,
    finish() {},
  };
  const probe = createSpriteDrawTimingProbe(gl);
  probe.frame({ plainDraws: 2, tileDraws: 1, tiles: 3 });
  for (const label of labels) probe.section(label, () => {});
  const summary = probe.summary();
  assert.equal(summary.method, "gl.finish");
  assert.equal(summary.frames, 1);
  assert.deepEqual(summary.shape, { plainDraws: 2, tileDraws: 1, tiles: 3 });
  for (const label of labels) {
    assert.equal(summary.sections[label].count, 1);
    assert.equal(typeof summary.sections[label].totalMsPerFrame, "number");
    assert.equal(typeof summary.sections[label].p50, "number");
    assert.equal(typeof summary.sections[label].p95, "number");
    assert.equal(typeof summary.sections[label].mean, "number");
  }
});

test("sprite draw timing collects asynchronous timer queries in milliseconds", () => {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const deleted = [];
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: () => extension,
    createQuery: () => ({ id: 1 }),
    beginQuery() {},
    endQuery() {},
    getParameter: () => false,
    getQueryParameter: (_query, name) => name === 3 ? true : 2_000_000,
    deleteQuery: (query) => deleted.push(query),
  };
  const probe = createSpriteDrawTimingProbe(gl);
  probe.frame({ plainDraws: 1, tileDraws: 0, tiles: 0 });
  probe.section("clear", () => {});
  const summary = probe.summary();
  assert.equal(summary.method, "EXT_disjoint_timer_query_webgl2");
  assert.deepEqual(summary.sections.clear, {
    count: 1,
    totalMsPerFrame: 2,
    p50: 2,
    p95: 2,
    mean: 2,
  });
  assert.equal(deleted.length, 1);
});

test("sprite draw timing discards disjoint timer-query samples", () => {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: () => extension,
    createQuery: () => ({}),
    beginQuery() {},
    endQuery() {},
    getParameter: () => true,
    getQueryParameter: () => true,
    deleteQuery() {},
  };
  const probe = createSpriteDrawTimingProbe(gl);
  probe.frame({ plainDraws: 1, tileDraws: 0, tiles: 0 });
  probe.section("clear", () => {});
  const summary = probe.summary();
  assert.equal(summary.sections.clear.count, 1);
  assert.equal(summary.sections.clear.totalMsPerFrame, null);
  assert.equal(summary.sections.clear.p50, null);
  assert.equal(summary.sections.clear.p95, null);
  assert.equal(summary.sections.clear.mean, null);
});
