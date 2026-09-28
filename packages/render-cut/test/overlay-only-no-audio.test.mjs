import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildV2Plan } from "./helpers/v2-fixture.mjs";
import { buildOverlayOnlyGpuArguments, parseArguments, prepareOverlayOnlyRuntimeEdit, renderProject } from "../src/render-cut.mjs";
import { lintProject } from "../../edit-lint/src/edit-lint.mjs";
import { resolveOsrLauncher } from "../../osr-export/src/index.mjs";
import { loadAndBuildOsrPage } from "../../osr-export/src/page-builder.mjs";
import { loadAndBuildGpuPage } from "../../gpu-export/src/page-builder.mjs";
import { buildGpuElectronArguments } from "../../gpu-export/src/runner.mjs";

const overlayOnlyEdit = {
  version: 2,
  output: { width: 320, height: 180, fps: 30, geometry: "source" },
  sources: [],
  tracks: [{ id: "visual", lane: "visual", items: [
    { id: "first", at: 0, duration: 30, source: { kind: "html", path: "overlays/first.html" } },
    { id: "second", at: 30, duration: 60, source: { kind: "html", path: "overlays/second.html" } },
  ] }],
};

function plan(noAudio = false) {
  return buildV2Plan({
    edit: overlayOnlyEdit,
    projectRoot: "/project",
    outputPath: "/project/exports/out.mp4",
    capabilities: { ffmpegCommand: "ffmpeg", ffprobeCommand: "ffprobe", sourceInputs: [] },
    noAudio,
  });
}

test("overlay-only v2 derives three seconds and output geometry without a source", () => {
  const result = plan();
  assert.equal(result.predicted_duration_seconds, 3);
  assert.equal(result.preset.width, 320);
  assert.equal(result.preset.height, 180);
  assert.equal(result.preset.fps, 30);
  assert.equal(result.audio_enabled, undefined);
  assert.ok(result.commands.cut_audio.args.includes("anullsrc=channel_layout=stereo:sample_rate=48000"));
});

test("edit-lint accepts overlay-only projects with empty or omitted sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-overlay-only-"));
  try {
    await mkdir(join(root, "overlays"));
    await mkdir(join(root, ".akari"));
    await writeFile(join(root, "overlays", "first.html"), "<div>first</div>\n");
    await writeFile(join(root, "overlays", "second.html"), "<div>second</div>\n");
    for (const edit of [overlayOnlyEdit, { ...overlayOnlyEdit, sources: undefined }]) {
      await writeFile(join(root, "edit.json"), `${JSON.stringify(edit)}\n`);
      const result = await lintProject(root, { writeReports: false });
      assert.equal(result.verdict, "pass", JSON.stringify(result.findings));
      assert.equal(result.findings.filter(f => f.severity === "warning").length, 0, JSON.stringify(result.findings));
      assert.ok(result.findings.some(f => f.check === "timeline.duration-derived"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--no-audio removes audio at the final mux while the default plan remains unchanged", () => {
  assert.equal(parseArguments(["/project"]).noAudio, false);
  assert.equal(parseArguments(["/project", "--no-audio"]).noAudio, true);
  const defaultPlan = plan();
  const silentPlan = plan(true);
  assert.equal(defaultPlan.commands.audio_mix.operation, "copy");
  assert.equal(silentPlan.audio_enabled, false);
  assert.deepEqual(silentPlan.commands.audio_mix.args.slice(-4), [
    "-c:v", "copy", "-an", silentPlan.commands.audio_mix.output,
  ]);
});

test("runtime edit supplies omitted sources and a declared solid background", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-overlay-background-"));
  const temporaryDirectory = join(root, ".akari", "render-tmp", "run");
  try {
    await mkdir(temporaryDirectory, { recursive: true });
    await mkdir(join(root, "overlays"));
    await writeFile(join(root, "overlays", "first.html"), "<div>first</div>\n");
    await writeFile(join(root, "overlays", "second.html"), "<div>second</div>\n");
    const parsedEdit = { ...overlayOnlyEdit, sources: undefined,
      output: { ...overlayOnlyEdit.output, background: "#123456" } };
    const path = await prepareOverlayOnlyRuntimeEdit({
      parsedEdit, normalizedEdit: { ...parsedEdit, sources: [] },
      projectRoot: root, temporaryDirectory, frames: 90,
    });
    const runtime = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(runtime.sources, []);
    assert.equal(runtime.tracks[0].items[0].duration, 90);
    assert.match(await readFile(join(temporaryDirectory, "overlay-only-background.html"), "utf8"), /#123456/u);
    const osr = await loadAndBuildOsrPage({ projectRoot: root, editPath: path, duration: 3 });
    const gpu = await loadAndBuildGpuPage({ projectRoot: root, editPath: path, duration: 3 });
    assert.match(osr.overlaySheetHtml, /#123456/u);
    assert.match(gpu.html, /#123456/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overlay-only GPU launcher matches the default export path except for --edit", async () => {
  // gpu-export keeps this wrapper private. Evaluate its current builder with a launcher spy
  // so changes to the default argument list are checked without editing that package.
  const source = await readFile(new URL("../../gpu-export/src/index.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function launchGpuExportWithOutputSize(");
  const end = source.indexOf("\nexport async function captureFramesWithGpu(", start);
  assert.ok(start >= 0 && end > start);
  const defaultRunner = new Function("launchGpuExport", "buildGpuElectronArguments",
    `${source.slice(start, end)}\nreturn launchGpuExportWithOutputSize;`)(
    (resolvedLauncher, resolvedOptions, { argumentBuilder }) => argumentBuilder(resolvedLauncher, resolvedOptions),
    buildGpuElectronArguments,
  );
  const launcher = { tier: 2 };
  for (const codec of ["h264", "hevc"]) {
    const options = {
      projectRoot: "/project", out: "/project/video.mp4", fps: 30,
      width: 320, height: 180, outputWidth: 640, outputHeight: 360,
      duration: 3, frames: 90, quality: "high", bitrate: 2_000_000,
      codec, force: true, trapReadback: true, verifyFrames: true,
      dumpFrames: [2, 5], preview: "off", previewOutputDirectory: "/project/previews",
      collectLuma: false, progress: true, editPath: "/project/overlay-only-edit.json",
    };
    const base = defaultRunner(launcher, { ...options, editPath: undefined });
    const actual = buildOverlayOnlyGpuArguments(launcher, options);
    const editIndex = actual.indexOf("--edit");
    assert.equal(actual.filter(arg => arg === "--edit").length, 1);
    const withoutEdit = actual.slice(0, editIndex).concat(actual.slice(editIndex + 2));
    assert.deepEqual(withoutEdit.slice(0, -1), base.slice(0, -1));
    assert.equal(actual[editIndex + 1], options.editPath);
    assert.ok(base.includes("--output-width") && base.includes("--output-height"));
    assert.equal(base.includes("--codec"), codec === "hevc");
    assert.ok(base.includes("--preview-dir") && base.includes("--no-luma") && base.includes("--progress-timing"));
    assert.equal(actual.at(-2), "--spawn-start-ms");
    assert.ok(Number.isFinite(Number(actual.at(-1))));
    assert.ok(Number.isFinite(Number(base.at(-1))));
  }
});

test("overlay-only export verifies a video-only MP4 and preserves default audio", async t => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0
    || spawnSync("ffprobe", ["-version"]).status !== 0
    || (await resolveOsrLauncher()).tier === 3) {
    return t.skip("ffmpeg, ffprobe, or Electron cannot launch here");
  }
  const root = await mkdtemp(join(tmpdir(), "akari-overlay-export-"));
  try {
    for (const noAudio of [true, false]) {
      const project = join(root, noAudio ? "video-only" : "default-audio");
      await mkdir(join(project, ".akari"), { recursive: true });
      await mkdir(join(project, "overlays"));
      await writeFile(join(project, "overlays", "first.html"), "<div style='color:white'>First</div>\n");
      await writeFile(join(project, "overlays", "second.html"), "<div style='color:white'>Second</div>\n");
      await writeFile(join(project, "edit.json"), `${JSON.stringify(overlayOnlyEdit)}\n`);
      const lint = await lintProject(project);
      assert.equal(lint.verdict, "pass", JSON.stringify(lint.findings));
      const state = await renderProject(project, {
        engine: "osr", noAudio, settle: false, verifyBlank: false,
      });
      assert.equal(state.verify.verdict, "pass", JSON.stringify(state.verify.findings));
      assert.equal(state.plan.predicted_duration_seconds, 3);
      const outputPath = resolve(project, state.plan.output);
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", outputPath], { encoding: "utf8" });
      assert.equal(probe.status, 0, probe.stderr);
      const streams = JSON.parse(probe.stdout).streams;
      assert.deepEqual(streams.map(stream => stream.codec_type), noAudio ? ["video"] : ["video", "audio"]);
      if (noAudio) assert.ok(!state.verify.findings.some(f => f.check === "verify.audio-level" && f.severity === "warning"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
