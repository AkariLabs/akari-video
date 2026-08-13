import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { ensureFaceLandmarkerModel, faceLandmarkerModelPath } from "./model-resolver.mjs";

const bytes = Buffer.from("deterministic fake face landmarker model\n", "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  url: "https://example.invalid/face_landmarker.task",
  sha256,
  relativePath: "mediapipe/face-landmarker/test/face_landmarker.task",
};

test("モデルを AKARI_HOME/models へ SHA 検証後に原子的配置する", async () => {
  const root = mkdtempSync(join(tmpdir(), "face-expression-model-test-"));
  try {
    const env = { AKARI_HOME: root };
    const result = await ensureFaceLandmarkerModel({
      env,
      manifest,
      fetchImpl: async () => new Response(bytes, { status: 200 }),
    });
    assert.equal(result.downloaded, true);
    assert.equal(result.path, join(root, "models", ...manifest.relativePath.split("/")));
    assert.deepEqual(readFileSync(result.path), bytes);

    const cached = await ensureFaceLandmarkerModel({
      env,
      manifest,
      fetchImpl: async () => { throw new Error("cache hit must not fetch"); },
    });
    assert.equal(cached.downloaded, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("downloaded model の SHA-256 不一致を拒否し final path を残さない", async () => {
  const root = mkdtempSync(join(tmpdir(), "face-expression-model-test-"));
  try {
    const env = { AKARI_HOME: root };
    await assert.rejects(
      ensureFaceLandmarkerModel({
        env,
        manifest,
        fetchImpl: async () => new Response("corrupted", { status: 200 }),
      }),
      /SHA-256 不一致/,
    );
    assert.equal(existsSync(faceLandmarkerModelPath(env, manifest)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("既存 model の SHA-256 不一致も再取得で隠さず即時拒否する", async () => {
  const root = mkdtempSync(join(tmpdir(), "face-expression-model-test-"));
  try {
    const env = { AKARI_HOME: root };
    const modelPath = faceLandmarkerModelPath(env, manifest);
    mkdirSync(dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, "corrupted", "utf8");
    let fetched = false;
    await assert.rejects(
      ensureFaceLandmarkerModel({
        env,
        manifest,
        fetchImpl: async () => { fetched = true; return new Response(bytes); },
      }),
      /SHA-256 不一致/,
    );
    assert.equal(fetched, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
