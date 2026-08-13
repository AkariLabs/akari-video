import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import { TASKS_VISION_TARBALL, VENDORED_RUNTIME_FILES } from "./artifacts.mjs";
import { sha256File } from "./model-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("vendored @mediapipe/tasks-vision runtime は記録済み SHA-256 と一致する", async () => {
  assert.match(TASKS_VISION_TARBALL.url, /tasks-vision-0\.10\.17\.tgz$/);
  assert.match(TASKS_VISION_TARBALL.sha256, /^[0-9a-f]{64}$/);
  for (const [relativePath, expected] of Object.entries(VENDORED_RUNTIME_FILES)) {
    assert.equal(await sha256File(join(here, relativePath)), expected, relativePath);
  }
});
