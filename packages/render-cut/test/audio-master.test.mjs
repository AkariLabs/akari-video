import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// docs/contract-2026-07-22-render-basics.md #5 (audio.master: denoise / loudnorm). L2 requires
// measuring the rendered file's actual loudness with ffmpeg's own ebur128 scanner, not trusting
// the command plan alone — this is the "done = appears in the output file" principle from
// planning/contract-2026-07-22-render-basics.md.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// Measures EBU R128 integrated loudness (LUFS) of a file via ffmpeg's own ebur128 filter — the
// same measurement tool the audio contract cites (§ table row 5's L2 column).
function measureIntegratedLoudness(filePath) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const match = result.stderr.match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  assert.ok(match, `ebur128 did not report integrated loudness for ${filePath}: ${result.stderr}`);
  return Number(match[1]);
}

// Builds a render-cut project fixture whose source video carries a loud (well above -14 LUFS),
// audibly noisy dialogue track, so loudnorm/denoise both have real work to do.
async function makeProject({ duration = 4, master } = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-master-test-"));
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x180:rate=10:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    "-af",
    "volume=6dB",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    join(root, "source.mp4"),
  ]);

  const audio = master ? { master } : undefined;
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
        ...(audio ? { audio } : {}),
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("audio.master.loudnorm normalizes the final output to the target LUFS within +/-1 LU", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const target = -20;
  const project = await makeProject({ duration: 4, master: { denoise: "off", loudnorm: target } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /loudnorm=I=-20:TP=-1.5:LRA=11/);

    const outputPath = join(project, state.artifacts[0].path);
    const measured = measureIntegratedLoudness(outputPath);
    t.diagnostic(`target=${target} LUFS measured=${measured} LUFS`);
    assert.ok(
      Math.abs(measured - target) <= 1,
      `expected integrated loudness within +/-1 LU of ${target}, measured ${measured}`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("audio.master with loudnorm omitted defaults to -14 LUFS", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 4, master: { denoise: "off" } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");

    const outputPath = join(project, state.artifacts[0].path);
    const measured = measureIntegratedLoudness(outputPath);
    t.diagnostic(`default target=-14 LUFS measured=${measured} LUFS`);
    assert.ok(
      Math.abs(measured - -14) <= 1,
      `expected integrated loudness within +/-1 LU of -14 (schema default), measured ${measured}`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("audio.master.denoise=strong measurably reduces noise floor versus off, at a fixed loudnorm target", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // Build a noisy source: sine tone mixed with white noise via anoisesrc, so afftdn has real
  // broadband noise to suppress. Both projects share the same loudnorm target so the comparison
  // isolates afftdn's effect rather than loudness differences.
  const duration = 4;
  const root = await mkdtemp(join(tmpdir(), "render-cut-denoise-test-"));
  try {
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x180:rate=10:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=48000:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=duration=${duration}:color=white:amplitude=0.4:sample_rate=48000`,
      "-filter_complex",
      "[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      join(root, "source.mp4"),
    ]);

    async function renderWithDenoise(denoise) {
      const projectRoot = join(root, denoise);
      await mkdir(projectRoot);
      await writeFile(
        join(projectRoot, "edit.json"),
        `${JSON.stringify(
          {
            version: 0,
            output: { width: 320, height: 180, fps: 10 },
            source: { path: "../source.mp4", proxy: null },
            cuts: [{ in: 0, out: duration }],
            overlays: [],
            audio: { master: { denoise, loudnorm: -20 } },
          },
          null,
          2,
        )}\n`,
      );
      await mkdir(join(projectRoot, ".akari"));
      await writeFile(join(projectRoot, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
      const executed = run(projectRoot);
      assert.equal(executed.status, 0, executed.stderr);
      const state = JSON.parse(await readFile(join(projectRoot, ".akari", "render.json"), "utf8"));
      assert.equal(state.verify.verdict, "pass");
      return join(projectRoot, state.artifacts[0].path);
    }

    const offPath = await renderWithDenoise("off");
    const strongPath = await renderWithDenoise("strong");

    // Both are loudnorm'd to the same integrated target, so compare noise floor via max_volume
    // in a silence-adjacent low-energy sense is unreliable; instead compare spectral flatness
    // proxy: afftdn measurably lowers RMS energy relative to peak for broadband noise once mixed
    // with the deterministic tone, which volumedetect's mean/max gap approximates.
    function volumeGap(filePath) {
      const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-af", "volumedetect", "-f", "null", "-"], {
        encoding: "utf8",
      });
      const mean = Number(result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)[1]);
      const max = Number(result.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)[1]);
      return { mean, max, gap: max - mean };
    }

    const offStats = volumeGap(offPath);
    const strongStats = volumeGap(strongPath);
    t.diagnostic(
      `denoise=off mean=${offStats.mean}dB max=${offStats.max}dB gap=${offStats.gap.toFixed(2)}dB; ` +
        `denoise=strong mean=${strongStats.mean}dB max=${strongStats.max}dB gap=${strongStats.gap.toFixed(2)}dB`,
    );
    // afftdn suppresses the noise floor between tone peaks, which widens the mean/max gap
    // (mean drops while peak-carrying tone content survives) relative to the undenoised mix.
    assert.ok(
      strongStats.gap > offStats.gap,
      `expected denoise=strong to widen the peak/mean gap versus denoise=off (off gap=${offStats.gap}, strong gap=${strongStats.gap})`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("audio.master absent preserves today's copy-only behavior (non-regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 4 });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.plan.commands.audio_mix.operation, "copy");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
