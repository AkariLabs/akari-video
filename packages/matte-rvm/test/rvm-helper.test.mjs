import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRvmModel } from "../src/index.mjs";

test("rvm-helper uses the official automatic downsample ratios", async (t) => {
  const resolved = resolveRvmModel("mobilenetv3");
  if (resolved.missing) {
    t.skip(`model absent: ${resolved.fetchHint}`);
    return;
  }
  const { recommendedRatio } = await import("../bin/rvm-helper.mjs");
  assert.equal(recommendedRatio({ width: 512, height: 512 }), 1);
  assert.equal(recommendedRatio({ width: 1280, height: 720 }), 0.375);
  assert.equal(recommendedRatio({ width: 1920, height: 1080 }), 0.25);
  assert.equal(recommendedRatio({ width: 3840, height: 2160 }), 0.125);
});

test("rvm-helper performs one raw BGRA inference frame when the model is installed", async (t) => {
  const resolved = resolveRvmModel("mobilenetv3");
  if (resolved.missing) {
    t.skip(`model absent: ${resolved.fetchHint}`);
    return;
  }

  const width = 64;
  const height = 64;
  const input = Buffer.alloc(width * height * 4);
  for (let index = 0; index < input.length; index += 4) {
    input[index] = 31;
    input[index + 1] = 127;
    input[index + 2] = 223;
    input[index + 3] = 255;
  }
  const metricsPath = path.join(tmpdir(), `akari-rvm-helper-${process.pid}-${Date.now()}.json`);
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, "../bin/rvm-helper.mjs"),
        "--width", String(width),
        "--height", String(height),
        "--model", resolved.path,
        "--metrics", metricsPath,
        "--total-frames", "1",
      ],
      { cwd: tmpdir(), input, maxBuffer: 16 * 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.length, input.length);
    for (let index = 0; index < input.length; index += 4) {
      assert.equal(result.stdout[index], input[index]);
      assert.equal(result.stdout[index + 1], input[index + 1]);
      assert.equal(result.stdout[index + 2], input[index + 2]);
    }
    assert.match(result.stderr.toString(), /progress 1\/1/);
    const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
    assert.equal(metrics.frames, 1);
    assert.equal(metrics.mask_width, width);
    assert.equal(metrics.mask_height, height);
    assert.ok(metrics.ms_per_frame > 0);
    assert.ok(metrics.alpha_transparent_ratio >= 0 && metrics.alpha_transparent_ratio <= 1);
    assert.ok(metrics.alpha_partial_ratio >= 0 && metrics.alpha_partial_ratio <= 1);
  } finally {
    await rm(metricsPath, { force: true });
  }
});

test("rvm-helper produces identical raw BGRA bytes for identical input", (t) => {
  const resolved = resolveRvmModel("mobilenetv3");
  if (resolved.missing) {
    t.skip(`model absent: ${resolved.fetchHint}`);
    return;
  }

  const width = 64;
  const height = 64;
  const frames = 3;
  const frameBytes = width * height * 4;
  const input = Buffer.alloc(frameBytes * frames);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const index = frame * frameBytes + pixel * 4;
      input[index] = (pixel * 13 + frame * 29) % 256;
      input[index + 1] = (pixel * 7 + frame * 41) % 256;
      input[index + 2] = (pixel * 3 + frame * 53) % 256;
      input[index + 3] = 255;
    }
  }

  const helper = path.resolve(import.meta.dirname, "../bin/rvm-helper.mjs");
  const args = [
    helper,
    "--width", String(width),
    "--height", String(height),
    "--model", resolved.path,
    "--total-frames", String(frames),
  ];
  const first = spawnSync(process.execPath, args, { input, maxBuffer: 16 * 1024 * 1024 });
  const second = spawnSync(process.execPath, args, { input, maxBuffer: 16 * 1024 * 1024 });

  assert.equal(first.status, 0, first.stderr.toString());
  assert.equal(second.status, 0, second.stderr.toString());
  assert.equal(first.stdout.length, input.length);
  assert.equal(second.stdout.length, input.length);
  assert.deepEqual(first.stdout, second.stdout);
});
