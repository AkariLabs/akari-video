import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAudioMixCommand } from "../src/plan.mjs";

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

test("audio.master.denoise=strong measurably reduces broadband noise RMS energy versus off (measured pre-loudnorm, so normalization cannot mask the difference)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  // Pure noise gives afftdn nothing to distinguish "signal" from "noise", so it barely engages
  // (verified empirically). A tone at realistic dialogue level plus much quieter broadband noise
  // (a stand-in for room hiss) is what afftdn is designed for; a fixed seed keeps it deterministic.
  const duration = 4;
  const root = await mkdtemp(join(tmpdir(), "render-cut-denoise-test-"));
  try {
    const mixedAudioPath = join(root, "mixed.wav");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=300:sample_rate=48000:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=duration=${duration}:color=white:amplitude=0.02:sample_rate=48000:seed=42`,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]",
      "-map",
      "[a]",
      "-c:a",
      "pcm_s16le",
      mixedAudioPath,
    ]);
    const compositePlaceholder = join(root, "composite-placeholder.mp4");
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x180:rate=10:duration=${duration}`,
      "-i",
      mixedAudioPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      compositePlaceholder,
    ]);

    // Measures RMS energy in a frequency band far from the 300Hz tone (6-9kHz), so only the
    // broadband noise contributes — isolating afftdn's effect on the noise floor specifically
    // from the tone it must preserve.
    function measureNoiseBandRms(filePath) {
      const result = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-nostats", "-i", filePath, "-af", "highpass=f=6000,lowpass=f=9000,astats=metadata=0", "-f", "null", "-"],
        { encoding: "utf8" },
      );
      const match = result.stderr.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
      assert.ok(match, `astats did not report RMS level for ${filePath}: ${result.stderr}`);
      return Number(match[1]);
    }

    // Re-maps buildAudioMixCommand's real filter graph, but stops before the trailing loudnorm
    // step (always the last ";"-separated statement once audio.master is present) so the
    // comparison measures afftdn's effect directly instead of being equalized away by
    // normalization — the same "listen to an intermediate label" technique
    // audio-narration.test.mjs's ducking test uses.
    function renderPreLoudnorm(denoise) {
      const command = buildAudioMixCommand({
        edit: { audio: { master: { denoise, loudnorm: -14 } } },
        projectRoot: root,
        inputPath: compositePlaceholder,
        outputPath: join(root, `unused-${denoise}.mp4`),
        duration,
        ffmpegCommand: "ffmpeg",
        ffprobeCommand: "ffprobe",
      });
      assert.equal(command.operation, "ffmpeg");
      const filterComplexIndex = command.args.indexOf("-filter_complex");
      const filterComplex = command.args[filterComplexIndex + 1];
      const preLoudnormSteps = filterComplex.split(";").slice(0, -1).join(";");
      const targetLabel = denoise === "off" ? "[mixed]" : "[master_dn]";
      const inputArgs = command.args.slice(0, filterComplexIndex);
      const outPath = join(root, `pre-loudnorm-${denoise}.wav`);
      const result = spawnSync(
        "ffmpeg",
        [...inputArgs, "-filter_complex", preLoudnormSteps, "-map", targetLabel, "-c:a", "pcm_s16le", "-ar", "48000", outPath],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      return outPath;
    }

    const offPath = renderPreLoudnorm("off");
    const stdPath = renderPreLoudnorm("std");
    const strongPath = renderPreLoudnorm("strong");
    const offLevel = measureNoiseBandRms(offPath);
    const stdLevel = measureNoiseBandRms(stdPath);
    const strongLevel = measureNoiseBandRms(strongPath);
    t.diagnostic(
      `noise-band (6-9kHz) RMS: denoise=off ${offLevel}dB; denoise=std ${stdLevel}dB; denoise=strong ${strongLevel}dB`,
    );
    assert.ok(
      stdLevel < offLevel - 5,
      `expected denoise=std to measurably reduce broadband noise RMS versus off (off=${offLevel}dB, std=${stdLevel}dB)`,
    );
    assert.ok(
      strongLevel < stdLevel - 5,
      `expected denoise=strong to reduce broadband noise RMS further than std (std=${stdLevel}dB, strong=${strongLevel}dB)`,
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
