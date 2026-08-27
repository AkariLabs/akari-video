import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { resolvePuppeteerPackagePath } from "../src/render-cut.mjs";
import { ABSENT_LINT_SENTINEL } from "../src/render-receipt.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], {
    encoding: "utf8",
    env: { ...process.env, CHROME_PATH: chromePath },
  });
}

async function makeProject({
  lint = true,
  captions = false,
  withAudio = true,
  overlays = true,
  threeDimensional = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-test-"));
  const source = join(root, "source.mp4");
  const sourceArguments = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10:duration=3",
      ...(withAudio
        ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3"]
        : []),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      ...(withAudio ? ["-c:a", "aac", "-shortest"] : []),
      source,
    ];
  const generated = spawnSync(
    "ffmpeg",
    sourceArguments,
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  await mkdir(join(root, "overlays"));
  await writeFile(
    join(root, "overlays", "label.html"),
    threeDimensional
      ? '<div style="width:320px;height:180px"><canvas style="width:100%;height:100%"></canvas><div data-akari-3d-fallback style="color:white">3D fallback</div><script type="application/json" data-akari-3d-scene>{"model":"model.glb"}</script></div>\n'
      : '<div style="font:700 30px system-ui;color:white;background:#b00020;padding:8px">字幕A</div>\n',
  );
  if (threeDimensional) await writeFile(join(root, "model.glb"), "invalid GLB fixture");
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: threeDimensional ? 2 : 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: threeDimensional
          ? [{ in: 0, out: 0.5 }]
          : [
              { in: 0.5, out: 1.5 },
              { in: 2, out: 3 },
            ],
        overlays: overlays
          ? [
              {
                id: "label",
                html: "overlays/label.html",
                start: threeDimensional ? 0 : 0.1,
                duration: threeDimensional ? 0.5 : 0.7,
                transform: { x: 0, y: -30, scale: 1, rotate: 0 },
                vars: {},
              },
            ]
          : [],
      },
      null,
      2,
    )}\n`,
  );
  if (lint) {
    await mkdir(join(root, ".akari"));
    await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  }
  if (captions) {
    await writeFile(
      join(root, "captions.json"),
      `${JSON.stringify([
        {
          id: "c-0001",
          start: 2.1,
          end: 2.8,
          text: "字幕B",
          speaker: null,
          sourceRef: null,
          edited: false,
        },
      ])}\n`,
    );
  }
  return root;
}

test("missing lint refuses with exit 1 while --force records the override, and invalid lint is friendly", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ lint: false });
  try {
    const refused = run(project, ["--plan-only"]);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /edit-lint first/);

    const forced = run(project, ["--plan-only", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.validation.lint.override.used, true);

    await writeFile(join(project, ".akari", "lint.json"), "{not-json\n");
    const invalid = run(project, ["--plan-only", "--force"]);
    assert.equal(invalid.status, 2, invalid.stderr);
    assert.match(invalid.stderr, /.akari\/lint.json is not valid JSON/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("full --force render without lint reaches receipt creation and records the absence", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ lint: false, overlays: false, withAudio: false });
  try {
    const executed = run(project, ["--force", "--quality", "light"]);
    assert.equal(executed.status, 0, executed.stderr);
    assert.doesNotMatch(executed.stderr, /ENOENT.*lint\.json/u);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.validation.lint.override.used, true);
    const receipt = JSON.parse(await readFile(join(project, state.render_receipt.path), "utf8"));
    assert.equal(receipt.lint_state, "absent");
    assert.equal(
      receipt.lint_sha256,
      createHash("sha256").update(ABSENT_LINT_SENTINEL).digest("hex"),
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("plan commands are stable and the report is self-contained", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject();
  try {
    assert.equal(run(project, ["--plan-only"]).status, 0);
    const first = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(Object.keys(first.inputs).some(path => path.includes("NotoSansJP-Variable.ttf")), false);
    assert.equal(run(project, ["--plan-only"]).status, 0);
    const second = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.deepEqual(second.plan.commands, first.plan.commands);
    const report = await readFile(join(project, ".akari", "reports", "render-report.html"), "utf8");
    assert.match(report, /render-cut report/);
    assert.doesNotMatch(report, /https?:\/\//);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("plan-only accepts the object captions root with default_text_style", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ captions: true, overlays: false });
  try {
    const captions = JSON.parse(await readFile(join(project, "captions.json"), "utf8"));
    await writeFile(join(project, "captions.json"), `${JSON.stringify({
      default_text_style: {
        color: "#AABBCC",
        size_px: 42,
        background: { color: "#11223380", opacity: 0.4 },
        zone: "top-right",
      },
      captions,
    }, null, 2)}\n`);
    const planned = run(project, ["--plan-only"]);
    assert.equal(planned.status, 0, planned.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify, null);
    assert.ok(state.plan);
    const captionFontPath = "akari:assets/font/noto-sans-jp/NotoSansJP-Variable.ttf";
    assert.match(state.inputs[captionFontPath]?.sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.ok(state.inputs[captionFontPath].bytes > 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("plan-only records resolved Puppeteer capture workers", async () => {
  const project = await makeProject();
  try {
    const planned = run(project, ["--plan-only", "--capture-workers=3"]);
    assert.equal(planned.status, 0, planned.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.plan.commands.rasterize["puppeteer-core"].workers, 3);
    assert.equal(state.plan.commands.rasterize["puppeteer-core"].workers_source, "cli");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("caption layout persistence refuses external report-directory symlinks before writing", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  for (const target of ["reports", "caption-layout"]) {
    await t.test(target, async () => {
      const project = await makeProject({ captions: true, overlays: false });
      const external = await mkdtemp(join(tmpdir(), "render-cut-caption-layout-external-"));
      try {
        const captions = JSON.parse(await readFile(join(project, "captions.json"), "utf8"));
        await writeFile(join(project, "captions.json"), `${JSON.stringify({
          display_policy: {
            mode: "single_line_sequential",
            algorithm: "a4-ja-two-fragment-v1",
            unit_metric: "ascii-half-other-one-v1",
            max_line_units: 8,
            minimum_fragment_duration_seconds: 0.72,
            locale: "ja",
          },
          captions,
        }, null, 2)}\n`, "utf8");
        if (target === "reports") {
          await symlink(external, join(project, ".akari", "reports"));
        } else {
          await mkdir(join(project, ".akari", "reports"));
          await symlink(external, join(project, ".akari", "reports", "caption-layout"));
        }

        const planned = run(project, ["--plan-only"]);
        assert.equal(planned.status, 2, planned.stderr);
        assert.match(planned.stderr, /not a regular contained project directory/u);
        assert.deepEqual(await readdir(external), []);
      } finally {
        await rm(project, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
      }
    });
  }
});

test("CLI renders overlays or preserves diagnostics when Chrome cannot launch", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  if (spawnSync(chromePath, ["--version"]).status !== 0) return t.skip("Chrome unavailable");
  const project = await makeProject({ captions: true });
  try {
    const executed = run(project);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.provenance.rasterizer.attempts[0]?.method, "hyperframes");
    const staticAttempt = state.provenance.rasterizer.attempts.find(
      (attempt) => attempt.method === "static-screenshot",
    );
    if (executed.status === 2 && /SIGABRT|timeout/i.test(staticAttempt?.reason ?? "")) {
      const preservedCut = await readFile(join(project, state.provenance.render_tmp_dir, "cut.mp4"));
      assert.ok(preservedCut.length > 0);
      assert.equal(state.verify.verdict, "fail");
      assert.equal(state.provenance.rasterizer.adopted, null);
      return t.skip(`sandbox environment Chrome failure: ${staticAttempt.reason}`);
    }
    assert.equal(executed.status, 0, `${executed.stderr}\n${JSON.stringify(state.verify, null, 2)}\n${JSON.stringify(state.provenance.rasterizer, null, 2)}`);
    assert.equal(state.verify.verdict, "pass");
    assert.ok(
      ["hyperframes", "puppeteer-core", "static-screenshot"].includes(
        state.provenance.rasterizer.adopted,
      ),
    );
    assert.equal(state.artifacts[0].ffprobe.duration_seconds, 2);
    assert.equal(state.artifacts[0].ffprobe.width, 320);
    assert.equal(state.artifacts[0].ffprobe.height, 180);
    assert.equal(state.artifacts[0].ffprobe.fps, 10);
    assert.equal(state.artifacts[0].ffprobe.video_codec, "h264");
    assert.equal(state.artifacts[0].ffprobe.audio_codec, "aac");
    await assert.rejects(readFile(join(project, state.provenance.render_tmp_dir, "cut.mp4")), /ENOENT/);
    // The run directory itself should also be gone (self-cleanup deletes the whole subdirectory,
    // not just cut.mp4), leaving render-tmp's root empty for the next run.
    const remainingRunDirectories = await readdir(join(project, ".akari", "render-tmp")).catch(() => []);
    assert.deepEqual(remainingRunDirectories, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("CLI completes without overlays and adds AAC silence to a video-only source", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ withAudio: false, overlays: false });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.provenance.rasterizer.adopted, "skip");
    assert.equal(state.artifacts[0].ffprobe.video_codec, "h264");
    assert.equal(state.artifacts[0].ffprobe.audio_codec, "aac");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("3D overlays skip HyperFrames and use the puppeteer-core path", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  if (spawnSync(chromePath, ["--version"]).status !== 0) return t.skip("Chrome unavailable");
  if (!resolvePuppeteerPackagePath()) return t.skip("puppeteer-core unavailable");
  const project = await makeProject({ threeDimensional: true });
  try {
    const executed = run(project);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.deepEqual(state.provenance.rasterizer.attempts[0], {
      method: "hyperframes",
      status: "rejected",
      reason: "3D overlay requires the puppeteer-core path",
    });
    const puppeteerAttempt = state.provenance.rasterizer.attempts.find(
      (attempt) => attempt.method === "puppeteer-core",
    );
    if (executed.status === 2 && /SIGABRT|timeout|Failed to launch the browser process/i.test(puppeteerAttempt?.reason ?? "")) {
      return t.skip(`sandbox environment Chrome failure: ${puppeteerAttempt.reason}`);
    }
    assert.equal(
      executed.status,
      0,
      `${executed.stderr}\n${JSON.stringify(state.verify, null, 2)}\n${JSON.stringify(state.provenance.rasterizer, null, 2)}`,
    );
    assert.equal(state.provenance.rasterizer.adopted, "puppeteer-core");
    assert.equal(
      state.provenance.rasterizer.attempts.some(
        (attempt) => attempt.method === "static-screenshot",
      ),
      false,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a verified overlay render keeps exit 0 and records a profile cleanup warning", async (t) => {
  if (process.platform !== "darwin") return t.skip("LaunchServices cleanup requires macOS");
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  if (spawnSync(chromePath, ["--version"]).status !== 0) return t.skip("Chrome unavailable");
  if (spawnSync("/bin/ps", ["-axo", "command="]).status !== 0) return t.skip("process inspection unavailable");
  if (!resolvePuppeteerPackagePath()) return t.skip("puppeteer-core unavailable");
  const project = await makeProject({ threeDimensional: true });
  const outputPath = join(project, "cleanup-warning.mp4");
  try {
    const executed = spawnSync(
      process.execPath,
      [cliPath, project, "--out", outputPath],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CHROME_PATH: chromePath,
          RENDER_CUT_PROFILE_EXIT_TIMEOUT_MS: "1",
        },
      },
    );
    assert.equal(executed.status, 0, executed.stderr);
    assert.ok((await readFile(outputPath)).length > 0);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.match(
      `${state.warnings.join("\n")}\n${executed.stderr}`,
      /Chrome cleanup warning: Chrome processes still reference.*after 1ms/u,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--progress streams machine-readable PROGRESS lines and ends with a done marker before the verdict", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ withAudio: false, overlays: false });
  try {
    const executed = run(project, ["--progress"]);
    assert.equal(executed.status, 0, executed.stderr);
    const lines = executed.stdout.split(/\r?\n/u).filter((line) => line !== "");
    const progressLines = lines.filter((line) => line.startsWith("PROGRESS "));
    assert.ok(progressLines.length > 0, `expected at least one PROGRESS line, got:\n${executed.stdout}`);
    for (const line of progressLines.slice(0, -1)) {
      assert.match(line, /^PROGRESS out_time_ms=\d+ total_ms=\d+$/);
    }
    assert.match(progressLines.at(-1), /^PROGRESS done total_ms=\d+$/);
    const doneTotal = Number(progressLines.at(-1).match(/total_ms=(\d+)/)[1]);
    for (const line of progressLines.slice(0, -1)) {
      const [, outTimeMs, totalMs] = line.match(/out_time_ms=(\d+) total_ms=(\d+)/);
      assert.equal(Number(totalMs), doneTotal);
      assert.ok(Number(outTimeMs) <= Number(totalMs));
    }
    // The PROGRESS lines must come before the final verdict line, and CLI behavior/exit code must
    // be unaffected by --progress.
    const verdictIndex = lines.findIndex((line) => line.startsWith("PASS:") || line.startsWith("FAIL:"));
    assert.ok(verdictIndex > 0);
    assert.ok(lines.indexOf(progressLines.at(-1)) < verdictIndex);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--fps refuses to bypass v2 retime", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ withAudio: false, overlays: false });
  try {
    const executed = run(project, ["--fps", "5"]);
    assert.equal(executed.status, 2);
    assert.match(executed.stderr, /retime/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("--quality/--encoder are rejected with an unknown value before any rendering starts", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ withAudio: false, overlays: false });
  try {
    const badQuality = run(project, ["--plan-only", "--quality", "ultra"]);
    assert.equal(badQuality.status, 2);
    assert.match(badQuality.stderr, /--quality must be one of/);

    const badEncoder = run(project, ["--plan-only", "--encoder", "nvenc"]);
    assert.equal(badEncoder.status, 2);
    assert.match(badEncoder.stderr, /--encoder must be one of/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
