import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveOsrLauncher } from "../../osr-export/src/index.mjs";
import { selectExecutionIntermediates } from "../src/render-cut.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

test("--engine osr completes one real render and records OSR provenance", { timeout: 300_000 }, async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  if (spawnSync("ffprobe", ["-version"]).status !== 0) return t.skip("ffprobe unavailable");

  const launcher = await resolveOsrLauncher();
  if (launcher.tier === 3) return t.skip(`OSR launcher unavailable: ${launcher.reason}`);

  const project = await mkdtemp(join(tmpdir(), "render-cut-osr-real-"));
  try {
    await mkdir(join(project, ".akari"));
    await mkdir(join(project, "assets"));
    const sourcePath = join(project, "assets", "source.mp4");
    const generated = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
      // B frames can shift the decoded tail frame; this fixture isolates OSR routing instead.
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0",
      "-c:a", "aac", "-shortest", sourcePath,
    ], { encoding: "utf8", timeout: 60_000 });
    assert.equal(generated.status, 0, generated.stderr || generated.error?.message);

    await writeFile(join(project, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
    await writeFile(join(project, "edit.json"), `${JSON.stringify({
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: "main", path: "assets/source.mp4", proxy: null }],
      tracks: [{
        id: "v-main",
        lane: "visual",
        items: [{
          id: "clip-main",
          at: 0,
          duration: 30,
          source: { kind: "media", src: "main", in: 0, out: 1 },
        }],
      }],
    }, null, 2)}\n`);

    const rendered = spawnSync(process.execPath, [
      cliPath, project, "--out", "exports/osr.mp4", "--engine", "osr", "--quality", "light",
    ], { encoding: "utf8", timeout: 240_000 });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.provenance.engine_requested, "osr");
    assert.equal(state.provenance.engine, "osr");
    assert.equal(Object.hasOwn(state.provenance, "engine_fallback"), false);
    assert.ok(state.provenance.osr);
    assert.equal(state.provenance.osr.provenance.engine, "osr");
    assert.ok([1, 2].includes(state.provenance.osr.provenance.launcher_tier));
    assert.equal(state.provenance.rasterizer.adopted, "osr");
    assert.equal(state.plan.intermediates.some(path => path.endsWith("cut.mp4")), false);
    assert.equal(state.plan.intermediates.some(path => path.endsWith("cut-tail-padded.mp4")), false);
    assert.equal(state.plan.intermediates.some(path => path.endsWith("cut-audio.mp4")), true);

    const outputPath = join(project, "exports", "osr.mp4");
    assert.ok((await stat(outputPath)).size > 0);
    const probed = spawnSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
    ], { encoding: "utf8", timeout: 30_000 });
    assert.equal(probed.status, 0, probed.stderr || probed.error?.message);
    assert.ok(Number(probed.stdout.trim()) > 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("legacy execution keeps video cut intermediates while v2 removes only the exact planned paths", () => {
  const intermediates = [
    ".akari/render-tmp/run-1/cut.mp4",
    ".akari/render-tmp/run-1/cut-audio.mp4",
    ".akari/render-tmp/run-1/cut-tail-padded.mp4",
    ".akari/render-tmp/run-1/cut-audio-tail-padded.mp4",
    "assets/cut.mp4",
  ];
  const input = {
    intermediates,
    projectRoot: "/project",
    temporaryDirectory: "/project/.akari/render-tmp/run-1",
  };

  assert.strictEqual(selectExecutionIntermediates({ ...input, usesV2Export: false }), intermediates);
  assert.deepEqual(selectExecutionIntermediates({ ...input, usesV2Export: true }), [
    ".akari/render-tmp/run-1/cut-audio.mp4",
    ".akari/render-tmp/run-1/cut-audio-tail-padded.mp4",
    "assets/cut.mp4",
  ]);
});
