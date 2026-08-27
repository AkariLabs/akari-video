import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function compareCaptureOutputs(leftDirectory, rightDirectory) {
  const left = resolve(leftDirectory);
  const right = resolve(rightDirectory);
  const [leftFrames, rightFrames] = await Promise.all([
    frameNames(left),
    frameNames(right),
  ]);
  const missingFromLeft = rightFrames.filter((name) => !leftFrames.includes(name));
  const missingFromRight = leftFrames.filter((name) => !rightFrames.includes(name));
  const common = leftFrames.filter((name) => rightFrames.includes(name));
  const mismatches = [];
  for (const name of common) {
    const [leftSha256, rightSha256] = await Promise.all([
      sha256File(join(left, "frames", name)),
      sha256File(join(right, "frames", name)),
    ]);
    if (leftSha256 !== rightSha256) mismatches.push({ name, leftSha256, rightSha256 });
  }
  const [leftOverlaySha256, rightOverlaySha256] = await Promise.all([
    sha256File(join(left, "overlay.mov")),
    sha256File(join(right, "overlay.mov")),
  ]);
  return {
    left: basename(left),
    right: basename(right),
    frame_count_left: leftFrames.length,
    frame_count_right: rightFrames.length,
    missing_from_left: missingFromLeft,
    missing_from_right: missingFromRight,
    mismatched_frames: mismatches,
    png_all_match: missingFromLeft.length === 0
      && missingFromRight.length === 0
      && mismatches.length === 0,
    overlay_mov: {
      left_sha256: leftOverlaySha256,
      right_sha256: rightOverlaySha256,
      matches: leftOverlaySha256 === rightOverlaySha256,
    },
  };
}

async function frameNames(root) {
  return (await readdir(join(root, "frames")))
    .filter((name) => /^frame-\d{8}\.png$/u.test(name))
    .sort();
}

function sha256File(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  const [entryPath, modulePath] = await Promise.all([
    realpath(process.argv[1]).catch(() => null),
    realpath(fileURLToPath(import.meta.url)).catch(() => null),
  ]);
  return entryPath !== null && entryPath === modulePath;
}

if (await isMainModule()) {
  if (process.argv.length !== 4) {
    console.error("Usage: node compare-sha256.mjs <left-run-directory> <right-run-directory>");
    process.exitCode = 2;
  } else {
    const result = await compareCaptureOutputs(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    if (!result.png_all_match || !result.overlay_mov.matches) process.exitCode = 1;
  }
}
