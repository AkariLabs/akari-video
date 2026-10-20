import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const threeRuntimeSource = readFileSync(
  join(import.meta.dirname, "..", "..", "overlay-runtime", "src", "three-runtime.js"),
  "utf8",
);

function loadThreeRuntime() {
  const window = {};
  const sandbox = {
    window,
    console: { error() {} },
    setTimeout,
    clearTimeout,
    HTMLElement: class {},
    MessageChannel,
    MutationObserver: class {
      observe() {}
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(threeRuntimeSource, sandbox);
  // 単一ルート違反は readDescriptor() が THREE を使う前に投げるので、ライブラリは
  // 存在判定だけを満たす最小の stub で足りる。
  window.AkariThree = { THREE: {}, GLTFLoader: function () {}, RoomEnvironment: function () {} };
  return window.akari.threeRuntime;
}

function twoRootContainer() {
  return {
    children: [{}, {}],
    childElementCount: 2,
    hasAttribute: () => false,
    querySelector: () => null,
    appendChild() {},
    dataset: {},
  };
}

test("threeRuntime keeps the single-root failure reason in inspect()", () => {
  const runtime = loadThreeRuntime();
  const container = twoRootContainer();
  runtime.render(container, 0);
  const inspected = runtime.inspect(container);
  assert.equal(inspected.status, "error");
  assert.equal(inspected.error.name, "Error");
  assert.equal(inspected.error.message, "3D overlay fragment は単一ルートである必要があります");
});

test("threeRuntime keeps existing inspect() fields unchanged when a failure reason is present", () => {
  const runtime = loadThreeRuntime();
  const container = twoRootContainer();
  runtime.render(container, 0);
  const inspected = runtime.inspect(container);
  assert.deepEqual(Object.keys(inspected).sort(), ["error", "status"]);
});

test("threeRuntime reports disposed without a failure reason", () => {
  const runtime = loadThreeRuntime();
  const inspected = runtime.inspect(twoRootContainer());
  assert.deepEqual(JSON.parse(JSON.stringify(inspected)), { status: "disposed" });
});
