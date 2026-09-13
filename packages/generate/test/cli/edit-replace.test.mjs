import assert from "node:assert/strict";
import test from "node:test";

import { applyReplacement, planReplacement } from "../../src/cli/edit-replace.mjs";

const cases = [
  [6.592, 6, { out: 6, freeze: null, mismatch_s: 0.592, warn: true }],
  [4.9, 6, { out: 4.9, freeze: { at_sec: 4.9, duration_sec: 1.1 }, mismatch_s: 1.1, warn: true }],
  [6, 6, { out: 6, freeze: null, mismatch_s: 0, warn: false }],
  [5.7, 6, { out: 5.7, freeze: { at_sec: 5.7, duration_sec: 0.3 }, mismatch_s: 0.3, warn: false }],
];

for (const [actualDurationS, cutsDurationS, expected] of cases) {
  test(`planReplacement: ${actualDurationS} / ${cutsDurationS}`, () => {
    const result = planReplacement({ item: {}, sourceEntry: {}, actualDurationS, cutsDurationS });
    assert.deepEqual(result, { in: 0, ...expected });
  });
}

test("applyReplacement は対象 source だけを付け替え、演出属性を保持する", () => {
  const project = { edit: {
    sources: [{ id: "still", path: "assets/start.png", proxy: null }],
    tracks: [{ id: "v", items: [{
      id: "clip-a", at: 10, duration: 180,
      source: { kind: "media", src: "still", in: 0, out: 6, framing: { fit: "cover" }, transition_out: { type: "fade" }, fx: [] },
    }] }],
  } };
  applyReplacement(project, {
    itemId: "clip-a", mp4RelativePath: "assets/generated/clip-a.mp4",
    plan: planReplacement({ actualDurationS: 5.7, cutsDurationS: 6 }),
  });
  assert.deepEqual(project.edit.sources.at(-1), { id: "gen-clip-a-video", path: "assets/generated/clip-a.mp4", proxy: null });
  assert.deepEqual(project.edit.tracks[0].items[0], {
    id: "clip-a", at: 10, duration: 180,
    source: {
      kind: "media", src: "gen-clip-a-video", in: 0, out: 5.7,
      framing: { fit: "cover" }, transition_out: { type: "fade" }, fx: [],
      freeze: { at_sec: 5.7, duration_sec: 0.3 }, mute: true,
    },
  });
});
