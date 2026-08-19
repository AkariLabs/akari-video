import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { generateColorRangeFixtures } from "../scripts/generate-color-range-fixtures.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const toolsAvailable = spawnSync("ffmpeg", ["-version"]).status === 0
  && spawnSync("ffprobe", ["-version"]).status === 0
  && existsSync(chromePath);

function runRender(projectRoot) {
  return spawnSync(process.execPath, [cliPath, projectRoot], {
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: chromePath },
    timeout: 120_000,
  });
}

function probeVideo(path) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_range", "-of", "json", path],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).streams[0];
}

function sampleCenterLuma(path) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", path,
      "-frames:v", "1",
      "-vf", "crop=2:2:(iw-2)/2:(ih-2)/2,extractplanes=y",
      "-pix_fmt", "gray",
      "-f", "rawvideo",
      "pipe:1",
    ],
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.ok(result.stdout.length >= 4);
  return result.stdout[0];
}

async function makeProject(root, sourcePath, name) {
  const project = join(root, name);
  await mkdir(join(project, ".akari"), { recursive: true });
  await copyFile(sourcePath, join(project, "source.mp4"));
  await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  await writeFile(join(project, "edit.json"), `${JSON.stringify({
    version: 0,
    output: { width: 1920, height: 1080, fps: 10 },
    source: { path: "source.mp4", proxy: null },
    cuts: [{ in: 0, out: 1 }],
    overlays: [],
  }, null, 2)}\n`);
  return project;
}

async function renderAndRead(project) {
  const rendered = runRender(project);
  assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
  const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
  assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings, null, 2));
  assert.ok(state.verify.findings.some(({ check, severity }) => check === "verify.color-range" && severity === "info"));
  return { state, outputPath: join(project, state.plan.output) };
}

test("full-range fixture renders to measured yuv420p/tv with limited white while tv input remains unchanged", async (t) => {
  if (!toolsAvailable) return t.skip("ffmpeg, ffprobe, or Chrome unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-color-range-real-"));
  try {
    const fixtures = generateColorRangeFixtures(join(root, "fixtures"));
    assert.deepEqual(probeVideo(fixtures.fullRangePath), { pix_fmt: "yuvj420p", color_range: "pc" });
    assert.deepEqual(probeVideo(fixtures.tvRangePath), { pix_fmt: "yuv420p", color_range: "tv" });
    assert.equal(sampleCenterLuma(fixtures.fullRangePath), 255);
    assert.equal(sampleCenterLuma(fixtures.tvRangePath), 235);

    const fullProject = await makeProject(root, fixtures.fullRangePath, "full-project");
    const full = await renderAndRead(fullProject);
    assert.deepEqual(probeVideo(full.outputPath), { pix_fmt: "yuv420p", color_range: "tv" });
    assert.ok(Math.abs(sampleCenterLuma(full.outputPath) - 235) <= 2);
    assert.equal(full.state.verify.measured.pixel_format, "yuv420p");
    assert.equal(full.state.verify.measured.color_range, "tv");
    assert.equal(full.state.plan.preset.color_range, "tv");
    assert.equal(full.state.provenance.sources[0].pix_fmt, "yuvj420p");
    assert.equal(full.state.provenance.sources[0].color_range, "pc");

    const tvProject = await makeProject(root, fixtures.tvRangePath, "tv-project");
    const tv = await renderAndRead(tvProject);
    assert.deepEqual(probeVideo(tv.outputPath), { pix_fmt: "yuv420p", color_range: "tv" });
    assert.ok(Math.abs(sampleCenterLuma(tv.outputPath) - sampleCenterLuma(fixtures.tvRangePath)) <= 1);
    assert.equal(tv.state.provenance.sources[0].pix_fmt, "yuv420p");
    assert.equal(tv.state.provenance.sources[0].color_range, "tv");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
