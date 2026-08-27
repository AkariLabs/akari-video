import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../../../packages/media-bin/src/index.mjs";
import { createMaskResolver, ensureMask } from "../bin/person-matte/mask-from-alpha.mjs";
import { compareRoundtrip } from "../bin/person-matte/mask-roundtrip.mjs";

function executable(command) {
  const result = spawnSync(command, ["-version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

test("VP9 alpha converts to an idempotent full-range H.264 mask with bounded roundtrip error", async (t) => {
  let ffmpeg;
  let ffprobe;
  try {
    ffmpeg = resolveFfmpeg();
    ffprobe = resolveFfprobe();
  } catch {
    t.skip("ffmpeg/ffprobe unavailable");
    return;
  }
  if (!executable(ffmpeg) || !executable(ffprobe)) {
    t.skip("ffmpeg/ffprobe unavailable");
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "person-matte-mask-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const alpha = path.join(directory, "moving-alpha.webm");
  const generated = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=10:duration=1",
    "-f", "lavfi", "-i", "nullsrc=size=64x36:rate=10:duration=1,geq=lum='clip(4*X+18*N,0,255)'",
    "-filter_complex", "[0:v][1:v]alphamerge,format=yuva420p",
    "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
    "-auto-alt-ref", "0", "-b:v", "0", "-crf", "20", alpha,
  ], { encoding: "utf8" });
  if (generated.error || generated.status !== 0) {
    t.skip(`libvpx-vp9 alpha fixture unavailable: ${generated.stderr}`);
    return;
  }

  const first = ensureMask(alpha, { ffmpeg, ffprobe });
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.skipped, false);
  assert.equal(first.probe.codec_name, "h264");
  assert.equal(first.probe.profile, "High");
  assert.equal(first.probe.color_range, "pc");
  assert.equal(first.probe.start_pts, 0);
  assert.equal(first.probe.nb_frames, 10);
  const second = ensureMask(alpha, { ffmpeg, ffprobe });
  assert.equal(second.ok, true, second.reason);
  assert.equal(second.skipped, true);

  const compared = await compareRoundtrip(alpha, first.path, { ffmpeg, ffprobe });
  assert.equal(compared.ok, true);
  assert.ok(compared.mean_abs <= 1);
  assert.ok(compared.p99_9 <= 3);
  assert.deepEqual(compared.chroma, { min: 128, max: 128 });
});

test("createMaskResolver converts each color source once and degrades failures to warnings", () => {
  let calls = 0;
  const warnings = [];
  const resolver = createMaskResolver({
    resolvePath: (src) => `${src}.webm`,
    ensure: (alphaPath) => {
      calls += 1;
      return alphaPath.startsWith("good")
        ? { ok: true, path: `${alphaPath}.mask.mp4` }
        : { ok: false, reason: "no alpha" };
    },
    onWarning: warning => warnings.push(warning),
  });
  assert.equal(resolver("good-color"), "good-color.webm.mask.mp4");
  assert.equal(resolver("good-color"), "good-color.webm.mask.mp4");
  assert.equal(resolver("bad-color"), null);
  assert.equal(resolver("bad-color"), null);
  assert.equal(calls, 2);
  assert.equal(warnings.length, 1);
});
