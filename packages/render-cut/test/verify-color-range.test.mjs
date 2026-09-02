import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { verifyArtifact } from "../src/render-cut.mjs";

test("verify.color-range fails pc and passes tv or an unreported H.264 range", async () => {
  const directory = await mkdtemp(join(tmpdir(), "render-cut-verify-color-range-"));
  try {
    const ffprobePath = join(directory, "ffprobe-fixture.mjs");
    const ffmpegPath = join(directory, "ffmpeg-fixture.mjs");
    await writeFile(ffprobePath, `#!/usr/bin/env node
const range = process.env.AKARI_TEST_COLOR_RANGE;
const video = {
  codec_type: "video",
  codec_name: "h264",
  profile: "High",
  pix_fmt: "yuv420p",
  width: 320,
  height: 180,
  avg_frame_rate: "10/1",
  duration: "1"
};
if (range !== "missing") video.color_range = range;
console.log(JSON.stringify({ streams: [video, { codec_type: "audio", codec_name: "aac" }], format: { duration: "1" } }));
`);
    await writeFile(ffmpegPath, `#!/usr/bin/env node
if (process.argv.includes("volumedetect")) {
  console.error("mean_volume: -20.0 dB");
  console.error("max_volume: -3.0 dB");
} else {
  console.log("frame=10");
  console.log("progress=end");
}
`);
    await chmod(ffprobePath, 0o755);
    await chmod(ffmpegPath, 0o755);

    const plan = {
      predicted_duration_seconds: 1,
      duration_tolerance_seconds: 0.2,
      preset: {
        video_codec: "h264",
        profile: "high",
        pixel_format: "yuv420p",
        color_range: "tv",
        audio_codec: "aac",
        width: 320,
        height: 180,
        fps: 10,
      },
      commands: { audio_mix: { hasNarration: false, hasAudibleAudio: true } },
    };
    const previous = process.env.AKARI_TEST_COLOR_RANGE;
    try {
      for (const [range, expectedVerdict, expectedMeasured] of [
        ["pc", "fail", "pc"],
        ["tv", "pass", "tv"],
        ["missing", "pass", null],
      ]) {
        process.env.AKARI_TEST_COLOR_RANGE = range;
        const verification = verifyArtifact({
          outputPath: join(directory, "artifact.mp4"),
          plan,
          ffprobeCommand: ffprobePath,
          ffmpegCommand: ffmpegPath,
        });
        assert.equal(verification.verdict, expectedVerdict, range);
        assert.equal(verification.measured.color_range, expectedMeasured, range);
        const finding = verification.findings.find(({ check }) => check === "verify.color-range");
        assert.ok(finding, range);
        assert.equal(finding.severity, range === "pc" ? "error" : "info", range);
      }
    } finally {
      if (previous === undefined) delete process.env.AKARI_TEST_COLOR_RANGE;
      else process.env.AKARI_TEST_COLOR_RANGE = previous;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
