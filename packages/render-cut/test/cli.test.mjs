import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments, RefusalError, resolveEngineChoice, runCli } from "../src/render-cut.mjs";

test("CLI arguments default to auto and accept both v2 engines", () => {
  assert.equal(parseArguments(["project"]).engine, "auto");
  assert.equal(parseArguments(["project", "--engine", "gpu"]).engine, "gpu");
  assert.equal(parseArguments(["project", "--engine=osr"]).engine, "osr");
});

test("the retired engine is refused with exit code 2", () => {
  assert.throws(
    () => parseArguments(["project", "--engine", "legacy"]),
    (error) => error instanceof RefusalError && error.exitCode === 2 && /廃止/.test(error.message),
  );
});

test("auto resolution is platform-independent", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    assert.equal(resolveEngineChoice("auto", platform, { eligible: true }), "gpu");
    assert.equal(resolveEngineChoice("auto", platform, { eligible: false }), "osr");
  }
});


test("successful CLI export settles after render with the render-cut actor", async () => {
  const calls = [];
  const exit = await runCli(["project"], { log() {}, error() {} }, {
    renderProject: async () => {
      calls.push("render");
      return { plan: { output: "export.mp4" }, verify: { verdict: "pass" } };
    },
    settleDecisionLog: async (options) => { calls.push("settle"); assert.equal(options.actor, "machine:render-cut"); assert.ok(options.projectRoot.endsWith("/project")); },
  });
  assert.equal(exit, 0);
  assert.deepEqual(calls, ["render", "settle"]);
  assert.equal(parseArguments(["project"]).settle, true);
});

test("no-settle, plan-only, and unsuccessful renders do not settle", async () => {
  for (const scenario of [
    { args: ["--no-settle"], verdict: "pass", exit: 0 },
    { args: ["--plan-only"], verdict: "pass", exit: 0 },
    { args: [], verdict: "fail", exit: 1 },
    { args: [], throws: true, exit: 2 },
  ]) {
    const exit = await runCli(["project", ...scenario.args], { log() {}, error() {} }, {
      renderProject: async () => {
        if (scenario.throws) throw new Error("render failed");
        return { plan: { output: "export.mp4", predicted_duration_seconds: 1 }, verify: { verdict: scenario.verdict } };
      },
      settleDecisionLog: async () => assert.fail("must not settle"),
    });
    assert.equal(exit, scenario.exit);
  }
  assert.equal(parseArguments(["project", "--no-settle"]).settle, false);
});

test("settle exceptions produce one stderr line and preserve exit zero", async () => {
  const errors = [];
  const exit = await runCli(["project"], { log() {}, error: (line) => errors.push(line) }, {
    renderProject: async () => ({ plan: { output: "export.mp4" }, verify: { verdict: "pass" } }),
    settleDecisionLog: async () => { throw new Error("settle failed\nsecond line"); },
  });
  assert.equal(exit, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /settle failed second line/u);
  assert.doesNotMatch(errors[0], /[\r\n]/u);
});
