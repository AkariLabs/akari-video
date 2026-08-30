import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildV2Plan } from "./helpers/v2-fixture.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "captions-declared-track");
const capabilities = {
  sourceInputs: [],
  ffmpegCommand: "ffmpeg",
  ffprobeCommand: "ffprobe",
  chromePath: "chrome",
  hyperframesAvailable: false,
  puppeteerAvailable: false,
};

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function planFor(shape, transform = edit => edit) {
  const edit = transform(await readJson(join(fixtureRoot, shape, "edit.json")));
  const captions = await readJson(join(fixtureRoot, "captions.json"));
  return buildV2Plan({
    edit,
    projectRoot: join(fixtureRoot, shape),
    outputPath: join(fixtureRoot, shape, "out.mp4"),
    capabilities,
    hasSourceAudio: false,
    captionOverlays: captions.map(caption => ({
      id: caption.id,
      start: caption.start,
      duration: caption.end - caption.start,
    })),
  });
}

test("content and captions-bag declarations keep the caption stage at the declared bottom z", async () => {
  const [contentPlan, bagPlan, undeclaredPlan] = await Promise.all([
    planFor("content"),
    planFor("bag"),
    planFor("undeclared"),
  ]);
  const captionStage = plan => plan.commands.track_stack.stages.find(stage => stage.kind === "captions");
  const contentStage = captionStage(contentPlan);
  const bagStage = captionStage(bagPlan);
  const undeclaredStage = captionStage(undeclaredPlan);

  assert.equal(contentStage.orderIndex, 0);
  assert.equal(bagStage.orderIndex, contentStage.orderIndex);
  assert.equal(contentStage.trackId, undefined);
  assert.equal(bagStage.trackId, undefined);
  assert.equal(undeclaredStage.trackId, "t-captions-implied");
  assert.equal(undeclaredStage.orderIndex, 2);
  assert.ok(undeclaredStage.orderIndex > bagStage.orderIndex);
});

test("a captions bag keeps sibling HTML on the same visual track", async () => {
  const plan = await planFor("bag", edit => ({
    ...edit,
    tracks: edit.tracks.map((track, index) => index === 0 ? {
      ...track,
      items: [
        ...track.items,
        {
          id: "sibling",
          at: 0,
          duration: 60,
          source: { kind: "html", path: "sibling.html" },
        },
      ],
    } : track),
  }));

  assert.deepEqual(
    plan.commands.track_stack.stages
      .filter(stage => stage.orderIndex === 0)
      .map(({ kind, overlayIds }) => ({ kind, overlayIds })),
    [
      { kind: "captions", overlayIds: ["caption-01"] },
      { kind: "overlays", overlayIds: ["sibling"] },
    ],
  );
});
