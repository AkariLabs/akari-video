import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseCaptureArguments, parseTimelineTime } from "../src/capture/arguments.mjs";
import { buildEngineProvenance, resolveEngineChoice } from "../../render-cut/src/render-cut.mjs";
import {
  assertCaptureEngineParity,
  resolveCaptureEngine,
  unionOnFrameGrid,
} from "../src/capture/run.mjs";
import { timecodeFor } from "../src/capture/output.mjs";

test("capture parses seconds/MM:SS and formats contract timecodes", () => {
  assert.equal(parseTimelineTime("4.5"), 4.5);
  assert.equal(parseTimelineTime("01:04.250"), 64.25);
  assert.equal(timecodeFor(0, 30), "0f");
  assert.equal(timecodeFor(11, 30), "11s");
  assert.equal(timecodeFor(4.5, 30), "04s15f");
});

test("capture discovers the project ancestor and unions -t/--auto on the frame grid", async () => {
  const root = await mkdtemp(join(tmpdir(), "capture-arguments-"));
  try {
    await mkdir(join(root, ".akari"));
    const parsed = parseCaptureArguments(["-t", "0", "4.5", "--auto", "--per-sheet", "3"], {
      cwd: join(root, "nested"),
    });
    assert.equal(parsed.projectRoot, root);
    assert.equal(parsed.perSheet, 3);
    assert.equal(parsed.engine, "auto");
    assert.equal(parseCaptureArguments(["-p", root, "-t", "0", "--engine=osr"]).engine, "osr");
    assert.deepEqual(unionOnFrameGrid([0, 4.5, 4.5001, 11], 30, 12), [0, 4.5, 11]);
    const warnings = [];
    assert.deepEqual(
      unionOnFrameGrid([0, 4.5, 11], 10, 3, { onWarning: (line) => warnings.push(line) }),
      [0, 2.9],
    );
    assert.deepEqual(warnings, [
      "capture: t=4.5 はタイムライン長 3.0s を超えるため 2.9s に丸めました",
      "capture: t=11 はタイムライン長 3.0s を超えるため 2.9s に丸めました",
      "capture: t=11 は t=4.5 と同じ 2.9s のフレームになるため重複を除きました",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture rejects missing times and per-sheet values outside 1..12", () => {
  assert.throws(() => parseCaptureArguments(["-p", "/tmp/project"], { cwd: "/tmp" }), /-t.*--auto/u);
  assert.throws(() => parseCaptureArguments(["-p", "/tmp/project", "--auto", "--per-sheet", "13"]), /1 to 12/u);
  assert.throws(() => parseCaptureArguments(["-p", "/tmp/project", "--auto", "--engine", "other"]), /auto\|gpu\|osr/u);
});

test("capture resolves auto with render-cut order and falls back from unavailable GPU to OSR", async () => {
  const calls = [];
  const resolved = await resolveCaptureEngine({
    requested: "auto",
    platform: "darwin",
    eligibility: { eligible: true },
    resolveGpu: async () => { calls.push("gpu"); return { tier: 3, reason: "gpu missing" }; },
    resolveOsr: async () => { calls.push("osr"); return { tier: 2, executable: "/electron" }; },
  });
  assert.deepEqual(calls, ["gpu", "osr"]);
  assert.equal(resolved.resolved, "osr");
  assert.deepEqual(resolved.fallback, { from: "gpu", reason: "gpu missing" });

  calls.length = 0;
  const linux = await resolveCaptureEngine({
    requested: "auto",
    platform: "linux",
    eligibility: null,
    resolveGpu: async () => { calls.push("gpu"); },
    resolveOsr: async () => { calls.push("osr"); },
  });
  assert.equal(linux.resolved, "osr");
  assert.deepEqual(calls, ["osr"]);

  await assert.rejects(resolveCaptureEngine({
    requested: "osr",
    platform: "darwin",
    resolveOsr: async () => ({ tier: 3, reason: "missing" }),
  }), /OSR capture unavailable: missing/u);
});

test("capture auto は render-cut と同じ engine 関数・provenance に全 platform/eligibility で一致する", async () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    for (const eligible of [true, false]) {
      const eligibility = { eligible, entries: [] };
      const expected = resolveEngineChoice("auto", platform, eligibility);
      const provenance = buildEngineProvenance("auto", platform, undefined, eligibility);
      const capture = await resolveCaptureEngine({
        requested: "auto",
        platform,
        eligibility,
        resolveGpu: async () => ({ tier: 2, executable: "/gpu-electron" }),
        resolveOsr: async () => ({ tier: 2, executable: "/osr-electron" }),
      });
      assert.equal(capture.resolved, expected, `${platform} eligible=${eligible}`);
      assert.equal(capture.resolved, provenance.engine, `${platform} eligible=${eligible}`);
      assert.doesNotThrow(() => assertCaptureEngineParity(capture.resolved, provenance));
    }
  }
});

test("capture engine 実行時ガードは render-cut provenance の不一致を拒否する", () => {
  assert.throws(
    () => assertCaptureEngineParity("gpu", { engine: "osr" }),
    /capture engine resolution drifted from render-cut: gpu != osr/u,
  );
  assert.throws(
    () => assertCaptureEngineParity("osr", null),
    /capture engine resolution drifted from render-cut: osr != missing/u,
  );
});
