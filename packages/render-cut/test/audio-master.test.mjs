import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildAudioMixCommand } from "../src/plan.mjs";
import { inspectFullIntegrity } from "../../akari-launcher/src/status-core/integrity.mjs";

// docs/contract-2026-07-22-render-basics.md #5 (audio.master: denoise / loudnorm). L2 requires
// measuring the rendered file's actual loudness with ffmpeg's own ebur128 scanner, not trusting
// the command plan alone — this is the "done = appears in the output file" principle from
// the internal render-basics contract.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = [], env = process.env) {
  return spawnSync(process.execPath, [cliPath, project, ...args], { encoding: "utf8", env });
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
    const failedState = executed.status === 0 ? null : JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(executed.status, 0, `${executed.stderr}\n${JSON.stringify(failedState?.audio_qc)}`);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.audio_qc.verdict, "INCONCLUSIVE");
    assert.equal(state.audio_qc.verdict, "INCONCLUSIVE");
    assert.equal(typeof state.audio_qc.filter_report.raw.output_i, "string");
    assert.equal(typeof state.audio_qc.decoded_measurement.raw.input_i, "string");
    assert.equal(state.audio_qc.decoded_measurement.metric, "ffmpeg-loudnorm-input-v1");
    const receipt = JSON.parse(await readFile(join(project, state.render_receipt.path), "utf8"));
    assert.deepEqual(receipt.audio_qc, state.audio_qc);
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

test("explicit -1.7 dBTP real render keeps filter output and independent decoded input evidence distinct and receipt-bound", async (t) => {
  const ffmpegPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (!ffmpegPath) return t.skip("ffmpeg unavailable");
  const ffmpegVersion = spawnSync(ffmpegPath, ["-version"], { encoding: "utf8" }).stdout.split(/\r?\n/u)[0].trim();
  const project = await makeProject({
    duration: 2,
    master: { denoise: "off", loudnorm: -14, true_peak_dbtp: -1.7 },
  });
  try {
    const logPath = join(project, "ffmpeg-audio-evidence.log");
    const wrapper = join(project, "ffmpeg-audio-recorder.sh");
    await writeFile(wrapper, `#!/bin/sh
if [ "$#" -eq 1 ] && [ "$1" = "-version" ]; then
  printf '%s\\n' "$AKARI_FFMPEG_VERSION"
  exit 0
fi
{
  for argument do
    printf '%s\\037' "$argument"
  done
  printf '\\036'
} >> "$AKARI_FFMPEG_LOG"
exec "$AKARI_REAL_FFMPEG" "$@"
`);
    await chmod(wrapper, 0o755);
    const executed = run(project, [], {
      ...process.env,
      FFMPEG: wrapper,
      AKARI_FFMPEG_LOG: logPath,
      AKARI_FFMPEG_VERSION: ffmpegVersion,
      AKARI_REAL_FFMPEG: ffmpegPath,
    });
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.deepEqual(state.audio_qc.configured, { integrated_lufs: -14, true_peak_dbtp: -1.7 });
    assert.deepEqual(Object.keys(state.audio_qc.filter_report.raw).sort(), ["output_i", "output_tp"]);
    assert.deepEqual(Object.keys(state.audio_qc.decoded_measurement.raw).sort(), ["input_i", "input_tp"]);
    assert.equal(state.audio_qc.decoded_measurement.metric, "ffmpeg-loudnorm-input-v1");
    assert.equal(Number(state.audio_qc.filter_report.raw.output_i), state.audio_qc.filter_report.normalized.output_i);
    assert.equal(Number(state.audio_qc.filter_report.raw.output_tp), state.audio_qc.filter_report.normalized.output_tp);
    assert.equal(Number(state.audio_qc.decoded_measurement.raw.input_i), state.audio_qc.decoded_measurement.normalized.input_i);
    assert.equal(Number(state.audio_qc.decoded_measurement.raw.input_tp), state.audio_qc.decoded_measurement.normalized.input_tp);
    assert.notEqual(state.audio_qc.filter_report.raw.output_tp, state.audio_qc.decoded_measurement.raw.input_tp,
      "filter output estimate must not replace the independent decoded input measurement");
    // TP=-3.2, not the configured -1.7: plan.mjs bakes in the 1.5 dB AAC overshoot margin
    // (audio-qc.mjs's AAC_TRUE_PEAK_OVERSHOOT_MARGIN_DBTP) whenever true_peak_dbtp is explicit
    // (task 2026-08-17-render-cut-true-peak-guard 裁定 B). audio_qc.configured stays -1.7 below —
    // the margin is an internal render detail, not a rewrite of what the caller asked for.
    assert.match(state.plan.commands.audio_mix.args.join(" "), /loudnorm=I=-14:TP=-3\.2:LRA=11:print_format=json/u);

    const invocations = (await readFile(logPath, "utf8"))
      .split("\x1e")
      .filter(Boolean)
      .map((record) => record.split("\x1f").slice(0, -1));
    const loudnormCalls = invocations.filter(args => args.some(value => value.includes("loudnorm=")));
    assert.equal(loudnormCalls.length, 2, JSON.stringify(loudnormCalls));
    const filterCall = loudnormCalls.find(args => args.includes("-filter_complex"));
    const decodedCall = loudnormCalls.find(args => args.includes("-af") && args.at(-1) === "-");
    assert.ok(filterCall, "filter execution was not captured");
    assert.ok(decodedCall, "independent decoded measurement execution was not captured");
    assert.notDeepEqual(filterCall, decodedCall);
    // filterCall (plan.mjs's loudnorm mix stage) gets the margin-applied TP=-3.2; decodedCall
    // (audio-qc.mjs's independent second-process measurement) intentionally re-analyzes against
    // the original configured TP=-1.7, since its job is to report where the decoded artifact
    // actually lands relative to what the caller asked for, not the internal applied target.
    assert.match(filterCall.join(" "), /TP=-3\.2/u);
    assert.match(decodedCall.join(" "), /TP=-1\.7/u);
    assert.deepEqual(state.audio_qc.true_peak_margin, { overshoot_margin_dbtp: 1.5, applied_true_peak_dbtp: -3.2 });

    const receipt = JSON.parse(await readFile(join(project, state.render_receipt.path), "utf8"));
    assert.deepEqual(receipt.audio_qc, state.audio_qc);
    const integrity = await inspectFullIntegrity(project);
    assert.equal(integrity.ok, true, integrity.problems.join("; "));
    assert.deepEqual(integrity.candidate.audio_qc, state.audio_qc);
    assert.ok(integrity.warnings.some(value => value.includes("INCONCLUSIVE")));
    t.diagnostic(`filter output TP=${state.audio_qc.filter_report.raw.output_tp}; decoded input TP=${state.audio_qc.decoded_measurement.raw.input_tp}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("audio.master with loudnorm omitted defaults to -14 LUFS", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 4, master: { denoise: "off" } });
  try {
    const executed = run(project);
    const failedState = executed.status === 0 ? null : JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(executed.status, 0, `${executed.stderr}\n${JSON.stringify(failedState?.audio_qc)}`);
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

test("audio filter process failure preserves a content-addressed artifact and MEASUREMENT_ERROR receipt", async (t) => {
  const ffmpegPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (!ffmpegPath) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 1, master: { denoise: "off", loudnorm: -14 } });
  try {
    const wrapper = join(project, "ffmpeg-filter-failure.mjs");
    await writeFile(wrapper, `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.some(value => value.includes("loudnorm=")) && args.at(-1)?.endsWith("final.mp4")) {
  process.stderr.write("fixture audio filter failure\\n");
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(ffmpegPath)}, args, { stdio: "inherit" });
process.exit(result.status ?? 2);
`, "utf8");
    await chmod(wrapper, 0o755);
    const executed = run(project, [], { ...process.env, FFMPEG: wrapper });
    assert.equal(executed.status, 1, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.phase, "error");
    assert.equal(state.audio_qc.verdict, "MEASUREMENT_ERROR");
    assert.deepEqual(state.audio_qc.error, {
      phase: "filter_report",
      code: "PROCESS_FAILED",
      message: "audio filter process exited unsuccessfully",
    });
    assert.match(state.artifacts[0].path, /^\.akari\/reports\/failed-render-artifacts\/[a-f0-9]{64}\.mp4$/u);
    const receipt = JSON.parse(await readFile(join(project, state.render_receipt.path), "utf8"));
    assert.deepEqual(receipt.audio_qc, state.audio_qc);
    assert.equal(receipt.output.path, state.artifacts[0].path);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("failed-render artifact persistence refuses child symlinks and a retargeted reports parent without external writes", async (t) => {
  const ffmpegPath = spawnSync("which", ["ffmpeg"], { encoding: "utf8" }).stdout.trim();
  if (!ffmpegPath) return t.skip("ffmpeg unavailable");
  for (const target of ["failed-render-artifacts", "retargeted-reports"]) {
    await t.test(target, async () => {
      const project = await makeProject({ duration: 1, master: { denoise: "off", loudnorm: -14 } });
      const external = await mkdtemp(join(tmpdir(), "render-cut-failed-artifact-external-"));
      try {
        const wrapper = join(project, "ffmpeg-filter-failure-containment.mjs");
        await writeFile(wrapper, `#!/usr/bin/env node
import { rm, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args.some(value => value.includes("loudnorm=")) && args.at(-1)?.endsWith("final.mp4")) {
  if (process.env.AKARI_TEST_RETARGET_REPORTS === "1") {
    const reports = join(process.env.AKARI_TEST_PROJECT, ".akari", "reports");
    await rm(reports, { recursive: true, force: true });
    await symlink(process.env.AKARI_TEST_EXTERNAL, reports);
  }
  process.stderr.write("fixture audio filter failure\\n");
  process.exit(1);
}
const result = spawnSync(${JSON.stringify(ffmpegPath)}, args, { stdio: "inherit" });
process.exit(result.status ?? 2);
`, "utf8");
        await chmod(wrapper, 0o755);
        if (target === "failed-render-artifacts") {
          await mkdir(join(project, ".akari", "reports"));
          await symlink(external, join(project, ".akari", "reports", "failed-render-artifacts"));
        }
        const executed = run(project, [], {
          ...process.env,
          FFMPEG: wrapper,
          AKARI_TEST_PROJECT: project,
          AKARI_TEST_EXTERNAL: external,
          AKARI_TEST_RETARGET_REPORTS: target === "retargeted-reports" ? "1" : "0",
        });
        assert.equal(executed.status, 2, executed.stderr);
        assert.match(executed.stderr, /not a regular contained project directory/u);
        assert.deepEqual(await readdir(external), []);
      } finally {
        await rm(project, { recursive: true, force: true });
        await rm(external, { recursive: true, force: true });
      }
    });
  }
});
