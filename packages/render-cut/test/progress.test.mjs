import test from "node:test";
import assert from "node:assert/strict";

import { createProgressReporter, PROGRESS_STAGES } from "../src/progress.mjs";

test("progress reporter emits the contracted lines in order", () => {
  const lines = [];
  const reporter = createProgressReporter({ enabled: true, io: { log: line => lines.push(line) }, totalMs: 2400 });

  reporter.stageStart("prepare");
  reporter.stageEnd("prepare");
  reporter.stageStart("audio-cut");
  reporter.cutTime(0.4, 1.2);
  reporter.stageEnd("audio-cut");
  reporter.stageStart("render", { engine: "gpu" });
  reporter.stageEnd("render");
  reporter.stageStart("audio-mix");
  reporter.stageEnd("audio-mix");
  reporter.stageStart("verify");
  reporter.stageEnd("verify");
  reporter.done();

  assert.deepEqual(lines, [
    "PROGRESS stage=prepare status=start",
    "PROGRESS stage=prepare status=end",
    "PROGRESS stage=audio-cut status=start",
    "PROGRESS out_time_ms=400 total_ms=1200",
    "PROGRESS stage=audio-cut status=end",
    "PROGRESS stage=render status=start engine=gpu",
    "PROGRESS stage=render status=end",
    "PROGRESS stage=audio-mix status=start",
    "PROGRESS stage=audio-mix status=end",
    "PROGRESS stage=verify status=start",
    "PROGRESS stage=verify status=end",
    "PROGRESS done total_ms=2400",
  ]);
});

test("progress reporter emits nothing when disabled", () => {
  const lines = [];
  const reporter = createProgressReporter({ enabled: false, io: { log: line => lines.push(line) }, totalMs: 1000 });

  reporter.stageStart("prepare");
  reporter.cutTime(0.5, 1);
  reporter.stageEnd("prepare");
  reporter.done();

  assert.deepEqual(lines, []);
});

test("progress reporter clamps cutTime to total_ms", () => {
  const lines = [];
  const reporter = createProgressReporter({ enabled: true, io: { log: line => lines.push(line) }, totalMs: 1000 });

  reporter.cutTime(2, 1);

  assert.deepEqual(lines, ["PROGRESS out_time_ms=1000 total_ms=1000"]);
});

test("progress reporter adds engine only to render start", () => {
  const lines = [];
  const reporter = createProgressReporter({ enabled: true, io: { log: line => lines.push(line) }, totalMs: 1000 });

  reporter.stageStart("prepare", { engine: "gpu" });
  reporter.stageStart("render", { engine: "osr" });

  assert.deepEqual(lines, [
    "PROGRESS stage=prepare status=start",
    "PROGRESS stage=render status=start engine=osr",
  ]);
});

test("progress stages use the fixed vocabulary", () => {
  assert.deepEqual(PROGRESS_STAGES, ["prepare", "audio-cut", "render", "audio-mix", "verify"]);
});
