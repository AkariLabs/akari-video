import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readRenderEdit } from "../src/internal-render.mjs";
import { predictedDuration } from "../src/plan.mjs";
import { extractThumbnailStrip, planThumbnailStrip } from "../src/thumbnail-strip.mjs";

const sources = [
  { id: "srcA", path: "media/srcA.mp4", proxy: null },
  { id: "srcB", path: "media/srcB.mp4", proxy: null },
];

async function normalizedPlan(fixture, projectRoot, count = 12) {
  const editPath = join(projectRoot, "edit.json");
  await writeFile(editPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  const source = await readFile(editPath, "utf8");
  const edit = fixture.version === 2
    ? readRenderEdit(
      source,
      join(projectRoot, ".akari", "render-tmp"),
      { projectRoot },
    ).edit
    : JSON.parse(source);
  const durationSeconds = predictedDuration(edit.cuts);
  return {
    durationSeconds,
    plan: planThumbnailStrip({ edit, durationSeconds, fps: edit.output.fps ?? 30, count }),
  };
}

function assertTwelveIncreasingFrames(plan, durationSeconds) {
  assert.equal(plan.length, 12);
  assert.equal(plan[0].outputSeconds, 0);
  assert.ok(plan.at(-1).outputSeconds < durationSeconds);
  for (let index = 1; index < plan.length; index += 1) {
    assert.ok(plan[index].outputSeconds > plan[index - 1].outputSeconds);
  }
}

test("v1 の素材タイムラインを12点へ補間する", async () => {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-strip-v1-"));
  try {
    const fixture = {
      version: 1,
      output: { width: 1920, height: 1080, fps: 30 },
      sources,
      cuts: [
        { id: "cut-1", src: "srcA", in: 0, out: 15, at: 0, track: 0 },
        { id: "cut-2", src: "srcB", in: 0, out: 10, at: 15, track: 0 },
        { id: "cut-3", src: "srcA", in: 17, out: 32, at: 25, track: 0 },
      ],
    };
    const { plan, durationSeconds } = await normalizedPlan(fixture, root);
    assertTwelveIncreasingFrames(plan, durationSeconds);
    assert.ok(plan.every((frame) => frame.source !== null));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("素材の無い gap は黒枠として計画する", async () => {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-strip-gap-"));
  try {
    const fixture = {
      version: 1,
      output: { width: 1920, height: 1080, fps: 30 },
      sources,
      cuts: [
        { id: "cut-1", src: "srcA", in: 0, out: 5, at: 0, track: 0 },
        { id: "cut-2", src: "srcB", in: 0, out: 5, at: 15, track: 0 },
      ],
    };
    const { plan } = await normalizedPlan(fixture, root);
    const gaps = plan.filter((frame) => frame.outputSeconds >= 5 && frame.outputSeconds < 15);
    assert.ok(gaps.length > 0);
    assert.ok(gaps.every((frame) => frame.source === null && frame.sourceSeconds === null));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 の visual media items も12点の素材帯へ正規化する", async () => {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-strip-v2-"));
  try {
    const fixture = {
      version: 2,
      output: { width: 1920, height: 1080, fps: 30 },
      sources,
      tracks: [{
        id: "main-video",
        lane: "visual",
        items: [
          { id: "cut-1", at: 0, duration: 450, source: { kind: "media", src: "srcA", in: 0, out: 15 } },
          { id: "cut-2", at: 450, duration: 300, source: { kind: "media", src: "srcB", in: 0, out: 10 } },
          { id: "cut-3", at: 750, duration: 450, source: { kind: "media", src: "srcA", in: 17, out: 32 } },
        ],
      }],
    };
    const { plan, durationSeconds } = await normalizedPlan(fixture, root);
    assertTwelveIncreasingFrames(plan, durationSeconds);
    assert.ok(plan.every((frame) => frame.source?.path.startsWith("media/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ffmpeg が失敗しても全枠を null で返す", async () => {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-strip-extract-"));
  try {
    const input = join(root, "source.mp4");
    const fakeFfmpeg = join(root, "fake-ffmpeg.mjs");
    await writeFile(input, "not a video", "utf8");
    await writeFile(fakeFfmpeg, "#!/usr/bin/env node\nprocess.exitCode = 1;\n", "utf8");
    await chmod(fakeFfmpeg, 0o755);
    const plan = Array.from({ length: 4 }, (_, index) => ({
      index,
      outputSeconds: index,
      source: { id: "source", path: "source.mp4" },
      sourceSeconds: index,
    }));
    const frames = await extractThumbnailStrip({
      plan,
      projectRoot: root,
      outDir: join(root, "out"),
      width: 160,
      ffmpegCommand: fakeFfmpeg,
    });
    assert.equal(frames.length, plan.length);
    assert.ok(frames.every((frame) => frame.path === null));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
