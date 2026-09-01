import assert from "node:assert/strict";
import test from "node:test";

import {
  parseFfmpegOutTime,
  renderOverlaySheet,
  runChecked,
} from "../src/rasterize.mjs";

test("renderOverlaySheet embeds declared overlays deterministically", () => {
  const input = {
    overlays: [{ id: "o1", start: 0, duration: 1, html: "<div>Hello</div>" }],
    edit: { output: { width: 320, height: 180, fps: 30 } },
    projectRoot: "/tmp/project",
    duration: 1,
  };
  assert.equal(renderOverlaySheet(input), renderOverlaySheet(input));
  assert.match(renderOverlaySheet(input), /data-overlay-id="o1"/);
});

test("parseFfmpegOutTime accepts timestamps and rejects malformed input", () => {
  assert.equal(parseFfmpegOutTime("00:01:02.5"), 62.5);
  assert.equal(parseFfmpegOutTime("bad"), null);
});

test("runChecked returns a successful child result", () => {
  const result = runChecked(process.execPath, ["-e", "process.stdout.write('ok')"]);
  assert.equal(result.stdout, "ok");
});
