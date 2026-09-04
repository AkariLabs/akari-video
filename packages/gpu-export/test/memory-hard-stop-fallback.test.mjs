import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { memoryHardStopError, MEMORY_HARD_STOP_REASON } from "../../osr-export/src/memory.mjs";
import { gpuFailureReasonCode } from "../src/electron-main.mjs";
import { FALLBACK_REASONS, gpuRuntimeFallbackReason } from "../src/index.mjs";

test("RSS hard stop は reasonCode になり、auto なら OSR へフォールバックする", () => {
  const error = memoryHardStopError(4_313_530_368);
  assert.match(error.message, /^RSS hard stop: 4313530368 bytes$/u);
  assert.equal(gpuFailureReasonCode(error), MEMORY_HARD_STOP_REASON);
  assert.ok(FALLBACK_REASONS.includes(MEMORY_HARD_STOP_REASON));
  assert.equal(gpuRuntimeFallbackReason({ reasonCode: MEMORY_HARD_STOP_REASON }), MEMORY_HARD_STOP_REASON);
});

test("hard stop 以外の失敗は従来どおり reasonCode を持たない", () => {
  assert.equal(gpuFailureReasonCode(new Error("direct upload fallback at frame 12")), null);
  assert.equal(gpuRuntimeFallbackReason(new Error("direct upload fallback at frame 12")), null);
});

test("run.json の memory ブロックに生存デコーダセッション数が載る", async () => {
  const electronMain = await readFile(join(import.meta.dirname, "..", "src", "electron-main.mjs"), "utf8");
  // running / completed / failed の 3 状態すべてに残す（#28 では記録が無く手探りになった）
  assert.equal(electronMain.match(/decoderSessions: lastDecoderSessions/gu)?.length, 3);
  const pageRuntime = await readFile(join(import.meta.dirname, "..", "src", "page-runtime.js"), "utf8");
  assert.match(pageRuntime, /decoderSessions: engine\.decoderSessions,/u);
});

test("書き出しランタイムは plan を組んだ後・評価する前にセッションを回収する", async () => {
  for (const path of [
    join(import.meta.dirname, "..", "src", "page-runtime.js"),
    join(import.meta.dirname, "..", "..", "osr-export", "src", "page-runtime.js"),
  ]) {
    const source = await readFile(path, "utf8");
    assert.match(source, /new FE\.StreamReaper\(lookahead\.values\(\), \{ graceFrames: Math\.max\(1, Math\.round\(this\.fps\)\) \}\)/u);
    const planIndex = source.indexOf("FE.evaluationPlanFromResolvedTimeline");
    const reapIndex = source.indexOf("this.reaper.reap(plan");
    const evaluateIndex = source.indexOf("FE.evaluateFrame(plan");
    assert.ok(planIndex >= 0 && reapIndex > planIndex && evaluateIndex > reapIndex, `reap ordering in ${path}`);
  }
});
