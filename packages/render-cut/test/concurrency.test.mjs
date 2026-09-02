import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";
import { legacyRenderArgs } from "./helpers/render-engine.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// render-tmp-isolation の受け入れ条件 — reproduces the T5 incident
// (two render-cut processes racing on the same project's .akari/render-tmp/) and proves the fix:
// each process claims its own uniquely-named subdirectory instead of clearing a shared one.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function resolveMediaCommands(t) {
  try {
    const commands = { ffmpeg: resolveFfmpeg(), ffprobe: resolveFfprobe() };
    if (spawnSync(commands.ffmpeg, ["-version"]).status !== 0
      || spawnSync(commands.ffprobe, ["-version"]).status !== 0) {
      t.skip("ffmpeg or ffprobe unavailable");
      return null;
    }
    return commands;
  } catch (error) {
    t.skip(error.message);
    return null;
  }
}

function runAsync(project, args, env = process.env) {
  return new Promise((resolvePromise) => {
    // This suite measures legacy render isolation; engine resolution has separate unit coverage.
    const child = spawn(process.execPath, [cliPath, project, ...legacyRenderArgs(args)], { env });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolvePromise({ status: code, stdout, stderr }));
  });
}

// Minimal fixture (short, no overlays) so the run is fast under load and never needs Chrome —
// the point of this test is proving render-tmp isolation, not exercising the rasterizer.
async function makeMinimalProject(ffmpegCommand = "ffmpeg") {
  const root = await mkdtemp(join(tmpdir(), "render-cut-concurrency-test-"));
  const source = join(root, "source.mp4");
  const generated = spawnSync(
    ffmpegCommand,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: 2 }],
        overlays: [],
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("two concurrent render-cut runs against the same project do not corrupt each other's render-tmp", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeMinimalProject();
  try {
    // Distinct --out paths sidestep the (separate, pre-existing) selectDefaultOutput naming race
    // and let each process's own output be checked independently — the thing under test here is
    // render-tmp isolation, not output-path allocation.
    const outputA = join(project, "out-a.mp4");
    const outputB = join(project, "out-b.mp4");
    // A small stagger reliably lands B's startup mid-way through A's render-tmp usage (rather than
    // both racing to start at the exact same instant, which — empirically — often finishes too far
    // apart to overlap on this fixture's ~2s render). Confirmed against the pre-fix code that this
    // stagger reproduces the T5 incident deterministically (process B's old unconditional
    // rm+mkdir wiped A's in-flight render-tmp, failing A with ENOENT on the final rename).
    const runA = runAsync(project, ["--out", outputA]);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));
    const runB = runAsync(project, ["--out", outputB]);
    const [resultA, resultB] = await Promise.all([runA, runB]);
    assert.equal(resultA.status, 0, `process A failed: ${resultA.stderr}`);
    assert.equal(resultB.status, 0, `process B failed: ${resultB.stderr}`);

    for (const output of [outputA, outputB]) {
      const probe = spawnSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", output],
        { encoding: "utf8" },
      );
      assert.equal(probe.status, 0, probe.stderr);
      const parsed = JSON.parse(probe.stdout);
      const video = parsed.streams.find((stream) => stream.codec_type === "video");
      const audio = parsed.streams.find((stream) => stream.codec_type === "audio");
      assert.equal(video?.codec_name, "h264", `${output}: expected h264 video`);
      assert.equal(video?.width, 320, `${output}: expected width 320`);
      assert.equal(video?.height, 180, `${output}: expected height 180`);
      assert.equal(audio?.codec_name, "aac", `${output}: expected aac audio`);
      assert.ok(
        Math.abs(Number(parsed.format?.duration) - 2) < 0.5,
        `${output}: expected ~2s duration, got ${parsed.format?.duration}`,
      );
    }

    // Both runs completed successfully and self-cleaned their own subdirectory; nothing should
    // be left behind in render-tmp's root for the next run to trip over.
    const remaining = await readdir(join(project, ".akari", "render-tmp")).catch(() => []);
    assert.deepEqual(remaining, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a stale (>24h old) leftover run directory is swept on the next real run; a fresh one is left alone", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeMinimalProject();
  try {
    const renderTmpRoot = join(project, ".akari", "render-tmp");
    await mkdir(join(renderTmpRoot, "2020-01-01T00-00-00-000Z-1-stale00"), { recursive: true });
    await writeFile(join(renderTmpRoot, "2020-01-01T00-00-00-000Z-1-stale00", "leftover.txt"), "x");
    const oldTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(join(renderTmpRoot, "2020-01-01T00-00-00-000Z-1-stale00"), oldTime, oldTime);

    const fresh = join(renderTmpRoot, "not-stale-and-not-mine");
    await mkdir(fresh, { recursive: true });

    const executed = await runAsync(project, ["--out", join(project, "out.mp4")]);
    assert.equal(executed.status, 0, executed.stderr);

    const entries = await readdir(renderTmpRoot);
    assert.ok(
      !entries.includes("2020-01-01T00-00-00-000Z-1-stale00"),
      "the >24h-old stale directory should have been swept",
    );
    assert.ok(entries.includes("not-stale-and-not-mine"), "a directory younger than 24h should survive the sweep");

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.ok(state.provenance.render_tmp_dir, "the run's own directory should be recorded in provenance");
    assert.notEqual(state.provenance.render_tmp_dir, ".akari/render-tmp");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a failed CLI run self-cleans unless kept, and the next run immediately sweeps a kept dead owner", async (t) => {
  const media = resolveMediaCommands(t);
  if (!media) return;
  const project = await makeMinimalProject(media.ffmpeg);
  const renderTmpRoot = join(project, ".akari", "render-tmp");
  const failingEnvironment = {
    ...process.env,
    AKARI_EXPORT_ALLOW_DESKTOP: "0",
    FFMPEG: process.execPath,
    FFPROBE: media.ffprobe,
  };
  try {
    const removed = await runAsync(project, ["--out", join(project, "failed-a.mp4")], failingEnvironment);
    assert.equal(removed.status, 2, removed.stderr);
    assert.deepEqual(await readdir(renderTmpRoot), []);

    const kept = await runAsync(project, ["--out", join(project, "failed-b.mp4")], {
      ...failingEnvironment,
      AKARI_KEEP_FAILED_RENDER_TMP: "1",
    });
    assert.equal(kept.status, 2, kept.stderr);
    const keptEntries = await readdir(renderTmpRoot);
    assert.equal(keptEntries.length, 1);
    const owner = JSON.parse(await readFile(join(renderTmpRoot, keptEntries[0], "owner.json"), "utf8"));
    assert.equal(Number.isInteger(owner.pid), true);
    assert.match(owner.started, /^\d{4}-\d{2}-\d{2}T/u);

    const retry = await runAsync(project, ["--out", join(project, "failed-c.mp4")], failingEnvironment);
    assert.equal(retry.status, 2, retry.stderr);
    assert.deepEqual(await readdir(renderTmpRoot), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
