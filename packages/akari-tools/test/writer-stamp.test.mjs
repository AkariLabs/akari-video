import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";
import { runMediaCli } from "../bin/media.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const launcherVersion = JSON.parse(readFileSync(new URL("../../akari-launcher/package.json", import.meta.url), "utf8")).version;

function project(t, label) {
  const root = mkdtempSync(join(tmpdir(), `akari-tools-stamp-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function stampedVersion(root) {
  return JSON.parse(readFileSync(join(root, ".akari", "saved-by.json"), "utf8")).appVersion;
}

test("eye-bar --apply stamps the launcher version", (t) => {
  let ffmpeg;
  try { ffmpeg = resolveFfmpeg(); resolveFfprobe(); }
  catch { t.skip("ffmpeg/ffprobe unavailable"); return; }
  const root = project(t, "eye-bar");
  const videoPath = join(root, "source.mp4");
  const generated = spawnSync(ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=32x32:d=1:r=4",
    "-c:v", "mpeg4", videoPath,
  ], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);

  const editPath = join(root, "edit.json");
  const trackPath = join(root, "face-landmarks.json");
  writeFileSync(editPath, JSON.stringify({
    version: 0,
    output: { width: 32, height: 32, fps: 4 },
    source: { path: "source.mp4", proxy: null },
    cuts: [{ in: 0, out: 0.5 }],
    overlays: [],
    layers: [],
  }));
  writeFileSync(trackPath, JSON.stringify({
    version: 0,
    kind: "face-landmarks",
    source: { path: "source.mp4", duration: 1 },
    sample_fps: 4,
    provider: { name: "apple-vision" },
    samples: [0, 0.25, 0.5].map((time) => ({
      t: time,
      detections: [{
        box: [0.4, 0.4, 0.2, 0.2],
        conf: 1,
        landmarks: {
          left_pupil: [0.4, 0.5], right_pupil: [0.6, 0.5],
          left_eye: [[0.4, 0.5]], right_eye: [[0.6, 0.5]],
          outer_lips: [[0.5, 0.7]], inner_lips: [[0.5, 0.7]],
        },
      }],
    })),
  }));

  const result = spawnSync(process.execPath, [
    join(packageRoot, "bin", "eye-bar.mjs"), "--track", trackPath, "--edit", editPath,
    "--apply", "--bar-width", "16", "--smoothing", "none",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout.trim()).ok, true);
  assert.equal(stampedVersion(root), launcherVersion);
});

test("media audio-level --write stamps the launcher version", async (t) => {
  const root = project(t, "media");
  cpSync(join(packageRoot, "test", "fixtures", "audio-level", "v2", "edit.json"), join(root, "edit.json"));
  mkdirSync(join(root, "assets"));
  for (const name of ["tone.wav", "click.wav", "silence.wav", "video.mp4"]) {
    writeFileSync(join(root, "assets", name), "fixture");
  }
  const lines = [];
  const errors = [];
  const code = await runMediaCli(["audio-level", root, "--write", "--json"], {
    stdout: (line) => lines.push(line),
    stderr: (line) => errors.push(line),
    ffmpegPath: "unused",
    measureRunner: async () => ({
      integrated_lufs: -23,
      loudness_range_lu: 0,
      true_peak_dbtp: -20,
      sample_peak_dbfs: -20,
      rms_dbfs: -23,
      duration_sec: 5,
      sample_rate: 48000,
      channels: 1,
    }),
    lintRunner: async () => ({ verdict: "pass", findings: [] }),
  });
  assert.equal(code, 0, errors.join("\n"));
  assert.ok(JSON.parse(lines[0]).some((row) => row.written));
  assert.equal(stampedVersion(root), launcherVersion);
});
