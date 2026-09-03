import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildV2Plan, createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import {
  buildAudioTailPadCommand,
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

test("cuts 0 件の v2 plan は overlays + sfx の導出尺を使う", () => {
  const plan = buildV2Plan({
    edit: {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "hit", path: "assets/hit.wav" }],
      tracks: [
        { id: "overlays", lane: "visual", items: [
          { id: "one", at: 0, duration: 60, source: { kind: "html", path: "overlays/one.html" } },
          { id: "two", at: 60, duration: 90, source: { kind: "html", path: "overlays/two.html" } },
        ] },
        { id: "sfx", lane: "audio", items: [{
          id: "hit-1", at: 120, duration: 60, role: "sfx",
          source: { kind: "media", src: "hit", in: 0, out: 2 },
        }] },
      ],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/render.mp4",
    capabilities: {
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      sourceInputs: [{ id: "hit", duration: 0, hasAudio: true }],
    },
  });
  assert.equal(plan.predicted_duration_seconds, 6);
  assert.ok(plan.commands.cut_audio.args.includes("anullsrc=channel_layout=stereo:sample_rate=48000"));
  assert.ok(!plan.commands.cut_audio.args.some((argument) => argument.includes("concat=n=0")));
  assert.deepEqual(
    plan.commands.cut_audio.args.slice(-3),
    ["-t", "6", "/project/.akari/render-tmp/cut-audio.mp4"],
  );
});

test("cuts 1 件以上の cut_audio args は従来の引数列を保つ", () => {
  const plan = buildV2Plan({
    edit: {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "main", path: "assets/main.mp4" }],
      tracks: [{ id: "video", lane: "visual", items: [{
        id: "main-1", at: 0, duration: 60,
        source: { kind: "media", src: "main", in: 0, out: 2 },
      }] }],
    },
    projectRoot: "/project",
    outputPath: "/project/exports/render.mp4",
    capabilities: {
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: "ffprobe",
      sourceInputs: [{ id: "main", duration: 2, hasAudio: false }],
    },
  });
  assert.deepEqual(plan.commands.cut_audio.args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-filter_complex",
    "anullsrc=r=48000:cl=stereo,atrim=duration=2,asetpts=PTS-STARTPTS[a0];[a0]concat=n=1:v=0:a=1[joineda]",
    "-map",
    "[joineda]",
    "-vn",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "/project/.akari/render-tmp/cut-audio.mp4",
  ]);
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

test("audio-only tail padding preserves the second AAC generation without video work", () => {
  const command = buildAudioTailPadCommand({
    ffmpegCommand: "custom-ffmpeg",
    inputPath: "/tmp/cut-audio.mp4",
    outputPath: "/tmp/cut-audio-tail-padded.mp4",
    finalDurationSeconds: 13.25,
  });
  assert.deepEqual(command, {
    command: "custom-ffmpeg",
    args: [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      "/tmp/cut-audio.mp4",
      "-filter_complex",
      "[0:a]apad=whole_dur=13.25[pada]",
      "-map",
      "[pada]",
      "-vn",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-t",
      "13.25",
      "/tmp/cut-audio-tail-padded.mp4",
    ],
  });
});
