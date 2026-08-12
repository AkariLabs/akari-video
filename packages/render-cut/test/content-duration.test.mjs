import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildTailPadCommand,
  computeContentDurationSeconds,
} from "../src/content-duration.mjs";
import { probeAudioDurationSeconds } from "../src/plan.mjs";

const baseInput = {
  edit: { audio: {}, layers: [] },
  cutsEndSeconds: 10,
  projectRoot: "/project",
  captionOverlays: [],
  probeAudioDurationSeconds: () => null,
  ffprobeCommand: "ffprobe",
};

test("sfx extends content duration only when its measured placement end exceeds cuts", () => {
  const probe = (_command, path) => path.endsWith("long.wav") ? 4 : 2;
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    edit: {
      audio: {
        sfx: [
          { path: "audio/short.wav", t: 3 },
          { path: "audio/long.wav", t: 9 },
        ],
      },
    },
    probeAudioDurationSeconds: probe,
  }), 13);
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    edit: { audio: { sfx: [{ path: "audio/short.wav", t: 3 }] } },
    probeAudioDurationSeconds: probe,
  }), 10);
});

test("layers and captions extend content duration only beyond cuts", () => {
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    edit: {
      audio: {},
      layers: [
        { t: 2, duration: 3 },
        { t: 8, duration: 5 },
      ],
    },
  }), 13);
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    captionOverlays: [
      { start: 2, duration: 3 },
      { start: 9, duration: 2.5 },
    ],
  }), 11.5);
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    edit: { audio: {}, layers: [{ t: 2, duration: 3 }] },
    captionOverlays: [{ start: 4, duration: 2 }],
  }), 10);
});

test("missing or failed sfx probes are silently excluded", async () => {
  assert.equal(
    probeAudioDurationSeconds("ffprobe", join(tmpdir(), "akari-sfx-that-does-not-exist.wav")),
    null,
  );

  const directory = await mkdtemp(join(tmpdir(), "render-cut-content-duration-"));
  try {
    const invalidAudioPath = join(directory, "invalid.wav");
    await writeFile(invalidAudioPath, "not audio");
    assert.equal(probeAudioDurationSeconds("ffprobe", invalidAudioPath), null);
    assert.equal(computeContentDurationSeconds({
      ...baseInput,
      projectRoot: directory,
      edit: {
        audio: {
          sfx: [
            { path: "missing.wav", t: 50 },
            { path: "invalid.wav", t: 50 },
          ],
        },
      },
      probeAudioDurationSeconds,
    }), 10);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("narration and bgm never contribute to content duration", () => {
  assert.equal(computeContentDurationSeconds({
    ...baseInput,
    edit: {
      audio: {
        bgm: { path: "audio/forever.wav" },
        narration: [{ path: "audio/long.wav", t: 100 }],
      },
    },
  }), 10);
});

test("tail padding adds black video and silent audio through the final duration", () => {
  const command = buildTailPadCommand({
    ffmpegCommand: "custom-ffmpeg",
    inputPath: "/tmp/cut.mp4",
    outputPath: "/tmp/cut-tail-padded.mp4",
    cutsEndSeconds: 10,
    finalDurationSeconds: 13.25,
  });
  assert.equal(command.command, "custom-ffmpeg");
  assert.deepEqual(command.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    "/tmp/cut.mp4",
    "-filter_complex",
    "[0:v]tpad=stop_mode=add:stop_duration=3.25:color=black[padv_raw];[padv_raw]scale=out_range=tv[padv];[0:a]apad=whole_dur=13.25[pada]",
    "-map",
    "[padv]",
    "-map",
    "[pada]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-color_range",
    "tv",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-t",
    "13.25",
    "/tmp/cut-tail-padded.mp4",
  ]);
});
