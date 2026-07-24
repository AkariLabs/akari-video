import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { hasCutVisualTransform } from "../src/cut-transform.mjs";
import { buildCutCommand, buildMultiSourceCutCommand } from "../src/plan.mjs";

function run(command, args) {
  const result = spawnSync(command, args, { encoding: null });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result;
}

test("cut visual transform guard preserves the legacy path when both keys are absent", () => {
  assert.equal(hasCutVisualTransform([]), false);
  assert.equal(hasCutVisualTransform([{ in: 0, out: 1 }]), false);
  assert.equal(hasCutVisualTransform([{ in: 0, out: 1, transform: {} }]), true);
  assert.equal(hasCutVisualTransform([{ in: 0, out: 1, opacity: 1 }]), true);
});

test("v0 transformed cut applies fit, scale, rotate, opacity, and centered x/y overlay", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-transform-test-"));
  try {
    const sourcePath = join(root, "source.mp4");
    const cutPath = join(root, "cut.mp4");
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath,
    ]);
    const command = buildCutCommand({
      sourcePath,
      cutPath,
      cuts: [{
        in: 0,
        out: 1,
        transform: { x: 20, y: -10, scale: 0.5, rotate: 20 },
        opacity: 0.5,
      }],
      width: 160,
      height: 90,
      fps: 10,
      hasAudio: false,
      duration: 1,
      projectRoot: root,
    });
    run(command.command, command.args);

    const frame = run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", cutPath, "-frames:v", "1", "-vf", "format=rgb24",
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]).stdout;
    const lit = [];
    for (let y = 0; y < 90; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        const offset = (y * 160 + x) * 3;
        if (frame[offset] > 40 && frame[offset] > frame[offset + 1] * 2) {
          lit.push({ x, y, r: frame[offset] });
        }
      }
    }
    assert.ok(lit.length > 1000 && lit.length < 5000, `lit pixels=${lit.length}`);
    const centroid = lit.reduce(
      (sum, pixel) => ({ x: sum.x + pixel.x, y: sum.y + pixel.y }),
      { x: 0, y: 0 },
    );
    centroid.x /= lit.length;
    centroid.y /= lit.length;
    const averageRed = lit.reduce((sum, pixel) => sum + pixel.r, 0) / lit.length;
    assert.ok(Math.abs(centroid.x - 100) < 2, `centroid.x=${centroid.x}`);
    assert.ok(Math.abs(centroid.y - 35) < 2, `centroid.y=${centroid.y}`);
    assert.ok(averageRed > 100 && averageRed < 150, `averageRed=${averageRed}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gap-aware and v1 command builders apply cut transforms before timeline assembly", () => {
  const v0 = buildCutCommand({
    sourcePath: "/tmp/source.mp4",
    cutPath: "/tmp/cut.mp4",
    cuts: [
      { in: 0, out: 1, at: 0, transform: { x: 5 } },
      { in: 2, out: 3, at: 2, opacity: 0.75 },
    ],
    width: 320,
    height: 180,
    fps: 30,
    hasAudio: true,
    duration: 3,
    projectRoot: "/tmp",
  });
  const v0Filter = v0.args[v0.args.indexOf("-filter_complex") + 1];
  assert.match(v0Filter, /ct_gap_0_prepared/);
  assert.match(v0Filter, /colorchannelmixer=aa=0\.75/);

  const v1 = buildMultiSourceCutCommand({
    sourceInputs: [{ id: "a", path: "/tmp/a.mp4", hasAudio: true }],
    cutPath: "/tmp/cut.mp4",
    cuts: [{ src: "a", in: 0, out: 1, transform: { y: 7 }, opacity: 0.5 }],
    width: 320,
    height: 180,
    fps: 30,
    projectRoot: "/tmp",
  });
  const v1Filter = v1.args[v1.args.indexOf("-filter_complex") + 1];
  assert.match(v1Filter, /ct_v1_0_prepared/);
  assert.match(v1Filter, /main_h-overlay_h\)\/2\+7/);
  assert.match(v1Filter, /colorchannelmixer=aa=0\.5/);
});
