import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const pageRuntimeSource = readFileSync(
  join(import.meta.dirname, "..", "src", "page-runtime.js"),
  "utf8",
);

function loadWaitForThreeReady() {
  const start = pageRuntimeSource.indexOf("async function waitForThreeReady");
  const end = pageRuntimeSource.indexOf("\n  function summarize", start);
  assert.ok(start >= 0 && end > start, "waitForThreeReady must stay in page-runtime.js");
  const functionSource = pageRuntimeSource.slice(start, end);
  const factory = vm.runInNewContext(
    `(function (yieldMacrotask) { ${functionSource}; return waitForThreeReady; })`,
    {},
  );
  return factory(async () => {});
}

test("GPU 3D init failure carries the threeRuntime reason into the thrown error", async () => {
  const wait = loadWaitForThreeReady();
  const reason = "3D overlay fragment は単一ルートである必要があります";
  const threeRuntime = { inspect: () => ({ status: "error", error: { name: "Error", message: reason } }) };
  await assert.rejects(
    wait(threeRuntime, {}, "t1"),
    (error) => {
      assert.match(error.message, /3D overlay t1 failed to initialize: threeRuntime status=error/u);
      assert.match(error.message, /単一ルートである必要があります/u);
      assert.deepEqual(JSON.parse(JSON.stringify(error.threeError)), { overlayId: "t1", name: "Error", message: reason });
      return true;
    },
  );
});

test("GPU 3D readiness still resolves when threeRuntime is ready", async () => {
  const wait = loadWaitForThreeReady();
  await wait({ inspect: () => ({ status: "ready" }) }, {}, "t1");
});
