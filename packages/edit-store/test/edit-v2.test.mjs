import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { readEditV2 } from "../lib/edit-v2.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "edit-v2.json");

test("readEditV2 reads all source kinds and preserves bottom-to-top track order", async () => {
  const text = await readFile(fixturePath, "utf8");
  const edit = readEditV2(text);

  assert.equal(edit.version, 2);
  assert.equal(edit.output.fps, 30);
  assert.deepEqual(edit.tracks.map((track) => track.id), [
    "a1", "v-main", "captions", "v-filter", "v-html", "v-telop",
  ]);
  assert.deepEqual(edit.tracks.map((track) => track.z), [0, 1, 2, 3, 4, 5]);
  assert.equal(edit.tracks[0].lane, "audio");
  assert.deepEqual(edit.tracks[2].content, { from: "captions.json" });
  assert.deepEqual(
    edit.tracks.flatMap((track) => (track.items ?? []).map((item) => item.source.kind)),
    ["media", "media", "filter", "html", "telop"],
  );
  assert.equal(edit.tracks[5].name, "最前面へ入れ替え済み");
});

test("readEditV2 rejects v0/v1 instead of converting them", () => {
  assert.throws(
    () => readEditV2({ version: 1, output: {}, sources: [], tracks: [] }),
    /v0\/v1 はこの reader の対象外/,
  );
});

test("readEditV2 reports closed source and item violations with a path", async () => {
  const value = JSON.parse(await readFile(fixturePath, "utf8"));
  value.tracks[4].items[0].source.in = 0;
  assert.throws(() => readEditV2(value), /tracks\[4\]\.items\[0\]\.source.*未定義キー/);

  const topLevel = JSON.parse(await readFile(fixturePath, "utf8"));
  topLevel.tracks[5].items[0].textStyle = {};
  assert.throws(() => readEditV2(topLevel), /tracks\[5\]\.items\[0\].*textStyle/);
});
