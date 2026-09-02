import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { probeMediaDimensions, probeMediaDimensionsSync } from "../src/media-dimensions.mjs";
import { resolveFfmpeg } from "../src/index.mjs";

const ffmpeg = resolveFfmpeg();

function run(args) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function generateLandscapeMp4(output) {
  run([
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", output,
  ]);
}

/** 表示回転 90° を宣言した mp4（格納は横のまま・表示は縦）。 */
function generateRotatedMp4(source, output) {
  run(["-display_rotation", "90", "-i", source, "-c", "copy", output]);
}

function generatePng(output) {
  run(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1:duration=1", "-frames:v", "1", output]);
}

test("1920×1080 の mp4 は寸法をそのまま返す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-media-dimensions-"));
  try {
    const file = join(directory, "landscape.mp4");
    generateLandscapeMp4(file);
    assert.deepEqual(await probeMediaDimensions(file), {
      width: 1920,
      height: 1080,
      rotation: 0,
      displayWidth: 1920,
      displayHeight: 1080,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rotation 90° の mp4 は表示回転後の寸法を返す", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-media-dimensions-"));
  try {
    const source = join(directory, "landscape.mp4");
    const rotated = join(directory, "rotated.mp4");
    generateLandscapeMp4(source);
    generateRotatedMp4(source, rotated);
    assert.deepEqual(await probeMediaDimensions(rotated), {
      width: 1920,
      height: 1080,
      rotation: 90,
      displayWidth: 1080,
      displayHeight: 1920,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("静止画（png）も同じ経路で読む", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-media-dimensions-"));
  try {
    const file = join(directory, "still.png");
    generatePng(file);
    assert.deepEqual(probeMediaDimensionsSync(file), {
      width: 640,
      height: 360,
      rotation: 0,
      displayWidth: 640,
      displayHeight: 360,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("同一パスの同時要求は 1 回のプローブへ合流する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-media-dimensions-"));
  try {
    const file = join(directory, "landscape.mp4");
    generateLandscapeMp4(file);
    const first = probeMediaDimensions(file);
    const second = probeMediaDimensions(join(directory, ".", "landscape.mp4"));
    assert.equal(first, second, "同一パスの同時要求が別のプローブになりました");
    assert.deepEqual(await first, await second);
    // 解決後は合流表から外れ、次の要求は改めてプローブする。
    assert.notEqual(probeMediaDimensions(file), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("読めないファイルは理由付きで失敗する", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-media-dimensions-"));
  try {
    await assert.rejects(probeMediaDimensions(join(directory, "missing.mp4")));
    // 失敗した要求は合流表に残らない。
    await assert.rejects(probeMediaDimensions(join(directory, "missing.mp4")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
