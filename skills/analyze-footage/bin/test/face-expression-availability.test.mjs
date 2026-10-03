import assert from "node:assert/strict";
import test from "node:test";

import { checkAvailability } from "../face-expression/face-expression.mjs";

test("face-expression reports ffmpeg and ffprobe unavailable when explicit binaries are missing", async () => {
  const previousFfmpeg = process.env.AKARI_FFMPEG_BIN;
  const previousFfprobe = process.env.AKARI_FFPROBE_BIN;
  try {
    process.env.AKARI_FFMPEG_BIN = "/nonexistent/ffmpeg";
    process.env.AKARI_FFPROBE_BIN = "/nonexistent/ffprobe";

    const availability = await checkAvailability();
    assert.equal(availability.available, false);
    assert.match(availability.reason, /ffmpeg が利用できません/);
    assert.match(availability.reason, /ffprobe が利用できません/);
  } finally {
    if (previousFfmpeg === undefined) delete process.env.AKARI_FFMPEG_BIN;
    else process.env.AKARI_FFMPEG_BIN = previousFfmpeg;
    if (previousFfprobe === undefined) delete process.env.AKARI_FFPROBE_BIN;
    else process.env.AKARI_FFPROBE_BIN = previousFfprobe;
  }
});
