import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { readInternalEdit, timelineDurationSeconds, visualLaneEndSeconds } =
  createRequire(import.meta.url)("../lib/index.js");

// 実機報告 §2 の最小形。media は 167.3 秒、html オーバーレイは 177.2 秒まで続く。
// 総尺は visual レーンの全アイテムの最大終端なので、media の終端で打ち切らない。
const editWithHtmlTail = () => ({
  version: 2,
  output: { width: 320, height: 180, fps: 30 },
  sources: [
    { id: "main", path: "assets/main.mp4" },
    { id: "tail", path: "overlays/tail.html" },
  ],
  tracks: [
    { id: "video", lane: "visual", items: [{
      id: "main-1", at: 0, duration: 5019,
      source: { kind: "media", src: "main", in: 0, out: 167.3 },
    }] },
    { id: "overlays", lane: "visual", items: [{
      id: "tail-1", at: 5019, duration: 297,
      source: { kind: "html", path: "overlays/tail.html" },
    }] },
  ],
});

test("visualLaneEndSeconds は html オーバーレイの終端を media の終端より後ろでも含める", () => {
  const internal = readInternalEdit(editWithHtmlTail());
  assert.ok(Math.abs(visualLaneEndSeconds(internal) - 177.2) < 1e-9);
  const duration = timelineDurationSeconds(internal);
  assert.ok(Math.abs(duration.seconds - 177.2) < 1e-9);
  assert.equal(duration.basis, "overlays-audio");
});

test("media だけの動画の総尺は変わらない", () => {
  const edit = editWithHtmlTail();
  edit.tracks.pop();
  const internal = readInternalEdit(edit);
  assert.ok(Math.abs(visualLaneEndSeconds(internal) - 167.3) < 1e-9);
  assert.deepEqual(timelineDurationSeconds(internal), { seconds: 167.3, basis: "visual" });
});

test("入れ子 group の中の html も visual レーンの終端に含める", () => {
  const edit = editWithHtmlTail();
  edit.tracks[1] = { id: "overlays", lane: "visual", items: [{
    id: "group-1", at: 5019, duration: 297, source: { kind: "group" }, items: [{
      id: "child-1", at: 0, duration: 297,
      source: { kind: "html", path: "overlays/tail.html" },
    }],
  }] };
  const internal = readInternalEdit(edit);
  assert.ok(Math.abs(visualLaneEndSeconds(internal) - 177.2) < 1e-9);
});
