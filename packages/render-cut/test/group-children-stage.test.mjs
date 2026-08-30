import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildV2Plan } from "./helpers/v2-fixture.mjs";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "object-tree-html-bag");

test("a pure group contributes its explicit descendants to its own overlay stage", async () => {
  const fixture = JSON.parse(await readFile(join(fixtureRoot, "edit.json"), "utf8"));
  const edit = {
    ...fixture,
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    tracks: [{
      id: "media",
      lane: "visual",
      items: [
        { id: "main-01", at: 0, duration: 120, source: { kind: "media", src: "main", in: 0, out: 4 } },
      ],
    }, ...fixture.tracks],
  };
  const plan = buildV2Plan({
    edit,
    projectRoot: fixtureRoot,
    outputPath: join(fixtureRoot, "out.mp4"),
    capabilities: {
      sourceInputs: [],
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      chromePath: "chrome",
      hyperframesAvailable: false,
      puppeteerAvailable: false,
    },
    hasSourceAudio: false,
  });

  assert.deepEqual(
    plan.commands.track_stack.stages.map(({ kind, ref, orderIndex, overlayIds }) => ({
      kind, ref, orderIndex, ...(overlayIds ? { overlayIds } : {}),
    })),
    [
      { kind: "cuts", ref: 0, orderIndex: 0 },
      { kind: "overlays", ref: 0, orderIndex: 1, overlayIds: ["s01"] },
      { kind: "overlays", ref: 0, orderIndex: 2, overlayIds: ["g1", "g1.first", "g1.second"] },
      { kind: "overlays", ref: 1, orderIndex: 3, overlayIds: ["plain"] },
      { kind: "overlays", ref: 2, orderIndex: 4, overlayIds: ["s01.C"] },
    ],
  );
});
