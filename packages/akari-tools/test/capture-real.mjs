import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveOsrLauncher } from "../../osr-export/src/index.mjs";
import { renderProject } from "../../render-cut/src/render-cut.mjs";
import { generateCaptureFixture } from "../../render-cut/test/fixtures/capture-parity/generate.mjs";
import { sha256File } from "../src/capture/output.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const fixtureRoot = join(repoRoot, "packages", "render-cut", "test", "fixtures", "capture-parity");
const captureCli = join(packageRoot, "bin", "capture.mjs");
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";

// Runs with real ffmpeg/ffprobe and the exact macOS LaunchServices Chrome path used by production.
// Tool-less CI reports the precise missing condition as a named skip instead of silently passing.
test("capture CLI emits JSONL, deterministic full PNGs, auto parity, and an auditable manifest", { timeout: 300_000 }, async (t) => {
  const unavailable = await productionToolUnavailable();
  if (unavailable) return t.skip(unavailable);
  const project = await mkdtemp(join(tmpdir(), "capture-cli-real-"));
  try {
    await copyFile(join(fixtureRoot, "edit.json"), join(project, "edit.json"));
    await copyFile(join(fixtureRoot, "captions.json"), join(project, "captions.json"));
    await copyFile(join(fixtureRoot, "overlay.html"), join(project, "overlay.html"));
    await generateCaptureFixture(project, { ffmpeg });

    const sheetOut = join(project, "captures-sheet");
    const sheetRun = runCapture(["-p", project, "-t", "0", "4.5", "11", "--engine", "osr", "--per-sheet", "3", "--out", sheetOut]);
    assert.equal(sheetRun.status, 0, sheetRun.stderr);
    const stdoutLines = sheetRun.stdout.trim().split("\n").filter(Boolean);
    assert.equal(stdoutLines.length, 1, `stdout must contain JSON Lines only: ${sheetRun.stdout}`);
    const sheetRecord = JSON.parse(stdoutLines[0]);
    assert.equal(sheetRecord.kind, "sheet");
    assert.equal(sheetRecord.timecode, "0f-11s");
    assert.deepEqual(sheetRecord.times_s, [0, 4.5, 11]);
    assert.ok(existsSync(join(project, sheetRecord.path)));
    const manifest = JSON.parse(await readFile(join(sheetOut, "capture.json"), "utf8"));
    assert.equal(manifest.edit_sha256.length, 64);
    assert.match(manifest.renderer, /^osr-export@/u);
    assert.deepEqual(manifest.engine, { requested: "osr", resolved: "osr" });
    assert.equal(manifest.verify.mode, "stamp");
    assert.equal(manifest.verify.matched, true);

    const separateRun = runCapture([
      "-p", project, "-t", "0", "--engine", "osr", "--separate", "--edit", "edit.json", "--out", join(project, "separate"),
    ]);
    assert.equal(separateRun.status, 0, separateRun.stderr);
    const separate = JSON.parse(separateRun.stdout.trim());
    assert.equal(separate.height, 720);
    assert.equal(separate.kind, "frame");
    assert.deepEqual(manifest.images, [sheetRecord]);

    const rendered = await renderProject(project, {
      force: true,
      engine: "osr",
      out: "exports/reference.mp4",
    });
    assert.equal(rendered.verify.verdict, "pass");

    const firstOut = join(project, "captures-full-a");
    const secondOut = join(project, "captures-full-b");
    assert.equal(runCapture(["-p", project, "-t", "1.5", "--engine", "osr", "--full", "--out", firstOut]).status, 0);
    assert.equal(runCapture(["-p", project, "-t", "1.5", "--engine", "osr", "--full", "--out", secondOut]).status, 0);
    const firstPath = join(firstOut, "01s05f-full.png");
    const secondPath = join(secondOut, "01s05f-full.png");
    assert.equal(await sha256File(firstPath), await sha256File(secondPath));
    const imageProbe = spawnSync(ffprobe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height,pix_fmt", "-of", "json", firstPath,
    ], { encoding: "utf8" });
    assert.equal(imageProbe.status, 0, imageProbe.stderr);
    assert.deepEqual(JSON.parse(imageProbe.stdout).streams[0], { width: 320, height: 180, pix_fmt: "rgb24" });

    const autoOut = join(project, "captures-auto");
    const autoRun = runCapture(["-p", project, "--auto", "--engine", "osr", "--full", "--out", autoOut]);
    assert.equal(autoRun.status, 0, autoRun.stderr);
    const autoTimes = autoRun.stdout.trim().split("\n").filter(Boolean).map(JSON.parse).map((record) => record.time_s);
    assert.deepEqual(autoTimes, rendered.contact_sheet.timestamps_seconds);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("capture CLI ffmpeg-only fixture completes sheet/full/determinism/auto acceptance", { timeout: 180_000 }, async (t) => {
  if (spawnSync(ffmpeg, ["-version"]).status !== 0 || spawnSync(ffprobe, ["-version"]).status !== 0) {
    return t.skip("ffmpeg or ffprobe unavailable");
  }
  const project = await mkdtemp(join(tmpdir(), "capture-cli-ffmpeg-"));
  try {
    const edit = JSON.parse(await readFile(join(fixtureRoot, "edit.json"), "utf8"));
    edit.tracks = edit.tracks.filter((track) => track.id !== "title-overlay");
    await writeFile(join(project, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await generateCaptureFixture(project, { ffmpeg });
    const rendered = await renderProject(project, { force: true, engine: "legacy", out: "exports/reference.mp4" });
    assert.equal(rendered.verify.verdict, "pass");

    const sheetOut = join(project, "sheet");
    const sheetRun = runCapture(["-p", project, "-t", "0", "4.5", "11", "--engine", "legacy", "--per-sheet", "3", "--out", sheetOut]);
    assert.equal(sheetRun.status, 0, sheetRun.stderr);
    const sheetLines = sheetRun.stdout.trim().split("\n").filter(Boolean);
    assert.equal(sheetLines.length, 1);
    const sheet = JSON.parse(sheetLines[0]);
    assert.equal(sheet.kind, "sheet");
    assert.equal(sheet.timecode, "0f-11s");
    assert.deepEqual(sheet.times_s, [0, 4.5, 11]);
    const manifest = JSON.parse(await readFile(join(sheetOut, "capture.json"), "utf8"));
    assert.equal(manifest.edit_sha256.length, 64);
    assert.match(manifest.renderer, /^render-cut@/u);

    const separateRun = runCapture([
      "-p", project, "-t", "0", "--engine", "legacy", "--separate", "--edit", "edit.json", "--out", join(project, "separate"),
    ]);
    assert.equal(separateRun.status, 0, separateRun.stderr);
    const separate = JSON.parse(separateRun.stdout.trim());
    assert.equal(separate.height, 720);
    assert.equal(separate.kind, "frame");

    const fullA = join(project, "full-a");
    const fullB = join(project, "full-b");
    assert.equal(runCapture(["-p", project, "-t", "1.5", "--engine", "legacy", "--full", "--out", fullA]).status, 0);
    assert.equal(runCapture(["-p", project, "-t", "1.5", "--engine", "legacy", "--full", "--out", fullB]).status, 0);
    const pngA = join(fullA, "01s05f-full.png");
    const pngB = join(fullB, "01s05f-full.png");
    assert.equal(await sha256File(pngA), await sha256File(pngB));
    const probe = spawnSync(ffprobe, [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt",
      "-of", "json", pngA,
    ], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(probe.stdout).streams[0], { width: 320, height: 180, pix_fmt: "rgb24" });

    const autoRun = runCapture(["-p", project, "--auto", "--engine", "legacy", "--full", "--out", join(project, "auto")]);
    assert.equal(autoRun.status, 0, autoRun.stderr);
    const autoTimes = autoRun.stdout.trim().split("\n").filter(Boolean).map(JSON.parse).map((record) => record.time_s);
    assert.deepEqual(autoTimes, rendered.contact_sheet.timestamps_seconds);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

function runCapture(args) {
  return spawnSync(process.execPath, [captureCli, ...args], {
    encoding: "utf8",
    env: { ...process.env, FFMPEG: ffmpeg, FFPROBE: ffprobe },
    timeout: 240_000,
  });
}

async function productionToolUnavailable() {
  if (spawnSync(ffmpeg, ["-version"]).status !== 0) return `ffmpeg unavailable: ${ffmpeg}`;
  if (spawnSync(ffprobe, ["-version"]).status !== 0) return `ffprobe unavailable: ${ffprobe}`;
  const launcher = await resolveOsrLauncher();
  if (launcher.tier === 3) return "Electron launcher が見つからない";
  const electronProbe = spawnSync(launcher.executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (electronProbe.status !== 0) {
    return `Electron launcher が起動できない: status=${electronProbe.status} signal=${electronProbe.signal ?? "none"}`;
  }
  return null;
}
