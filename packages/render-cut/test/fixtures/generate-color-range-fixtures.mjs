#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 10;
const DURATION_SECONDS = 1;

export function generateColorRangeFixtures(outputDirectory, {
  ffmpegCommand = process.env.FFMPEG ?? "ffmpeg",
} = {}) {
  const directory = resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  const fullRangePath = resolve(directory, "full-range-pc.mp4");
  const tvRangePath = resolve(directory, "limited-range-tv.mp4");

  const commonInput = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-f", "lavfi", "-i", `color=c=white:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION_SECONDS}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${DURATION_SECONDS}`,
  ];
  const commonOutput = [
    "-c:v", "libx264", "-profile:v", "high", "-threads", "1",
    "-x264-params", "threads=1:colorprim=bt709:transfer=bt709:colormatrix=bt709",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:a", "aac", "-ar", "48000", "-shortest",
  ];

  run(ffmpegCommand, [
    ...commonInput,
    "-vf", "scale=in_range=tv:out_range=pc",
    ...commonOutput,
    "-pix_fmt", "yuvj420p", "-color_range", "pc",
    fullRangePath,
  ]);
  run(ffmpegCommand, [
    ...commonInput,
    ...commonOutput,
    "-pix_fmt", "yuv420p", "-color_range", "tv",
    tvRangePath,
  ]);

  return {
    fullRangePath,
    tvRangePath,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationSeconds: DURATION_SECONDS,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.stderr.trim()}`);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMainModule()) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) {
    console.error("Usage: generate-color-range-fixtures.mjs <output-directory>");
    process.exitCode = 2;
  } else {
    const generated = generateColorRangeFixtures(outputDirectory);
    console.log(JSON.stringify(generated, null, 2));
  }
}
