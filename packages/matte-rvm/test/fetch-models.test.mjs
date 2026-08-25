import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureModel } from "../scripts/fetch-models.mjs";

test("fetch-models fails closed and removes a sha256-mismatched partial file", async () => {
  const vendorRoot = await mkdtemp(path.join(tmpdir(), "akari-rvm-fetch-test-"));
  try {
    await assert.rejects(
      ensureModel("mobilenetv3", {
        vendorRoot,
        download: async (_url, destination) => writeFile(destination, "not an ONNX model"),
      }),
      /sha256 不一致/,
    );
    assert.deepEqual(await readdir(vendorRoot), []);
  } finally {
    await rm(vendorRoot, { recursive: true, force: true });
  }
});
