import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseCaptureArguments, parseTimelineTime } from "../src/capture/arguments.mjs";
import { unionOnFrameGrid } from "../src/capture/run.mjs";
import { timecodeFor } from "../src/capture/output.mjs";

test("capture parses seconds/MM:SS and formats contract timecodes", () => {
  assert.equal(parseTimelineTime("4.5"), 4.5);
  assert.equal(parseTimelineTime("01:04.250"), 64.25);
  assert.equal(timecodeFor(0, 30), "0f");
  assert.equal(timecodeFor(11, 30), "11s");
  assert.equal(timecodeFor(4.5, 30), "04s15f");
});

test("capture discovers the project ancestor and unions -t/--auto on the frame grid", async () => {
  const root = await mkdtemp(join(tmpdir(), "capture-arguments-"));
  try {
    await mkdir(join(root, ".akari"));
    const parsed = parseCaptureArguments(["-t", "0", "4.5", "--auto", "--per-sheet", "3"], {
      cwd: join(root, "nested"),
    });
    assert.equal(parsed.projectRoot, root);
    assert.equal(parsed.perSheet, 3);
    assert.deepEqual(unionOnFrameGrid([0, 4.5, 4.5001, 11], 30, 12), [0, 4.5, 11]);
    const warnings = [];
    assert.deepEqual(
      unionOnFrameGrid([0, 4.5, 11], 10, 3, { onWarning: (line) => warnings.push(line) }),
      [0, 2.9],
    );
    assert.deepEqual(warnings, [
      "capture: t=4.5 はタイムライン長 3.0s を超えるため 2.9s に丸めました",
      "capture: t=11 はタイムライン長 3.0s を超えるため 2.9s に丸めました",
      "capture: t=11 は t=4.5 と同じ 2.9s のフレームになるため重複を除きました",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture rejects missing times and per-sheet values outside 1..12", () => {
  assert.throws(() => parseCaptureArguments(["-p", "/tmp/project"], { cwd: "/tmp" }), /-t.*--auto/u);
  assert.throws(() => parseCaptureArguments(["-p", "/tmp/project", "--auto", "--per-sheet", "13"]), /1 to 12/u);
});
