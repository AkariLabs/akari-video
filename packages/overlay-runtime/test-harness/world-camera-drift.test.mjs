import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { createCamera } from "../../akari-tools/src/world/camera.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("generated world camera is byte-current and browser-classic", { timeout: 10_000 }, () => {
  const result = spawnSync(process.execPath, ["scripts/gen-world-camera.mjs", "--check"], { cwd: packageRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const generated = readFileSync(resolve(packageRoot, "src/vendor/world-camera.js"), "utf8");
  assert.doesNotMatch(generated, /\b(?:import|export|process|Date)\b|Math\.random/u);
  assert.match(generated, /window\.AkariWorldCamera = \{ createCamera \}/u);
  const context = vm.createContext({ window: {} });
  vm.runInContext(generated, context);
  const map = JSON.parse(readFileSync(resolve(packageRoot, "../schemas/examples/world-map-v3-flat-valid/planning/world-map.json"), "utf8"));
  const nodeCamera = createCamera(map);
  const browserCamera = context.window.AkariWorldCamera.createCamera(map);
  for (const seconds of [0, 1, 2.4, 5, 5.3, 10.2, 13, 15]) assert.deepEqual({ ...browserCamera(seconds) }, nodeCamera(seconds));
});
