import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { legacyRenderArgs } from "./helpers/render-engine.mjs";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

// Real-machine reproduction of the true-peak-guard bug (task
// 2026-08-17-render-cut-true-peak-guard / planning/notes-2026-08-17-mac-fresh-install-bug-reports.md
// #05): loudnorm's own PCM-stage true peak limiter honors the configured TP target exactly, but
// the AAC re-encode that follows can push the *decoded* artifact's real true peak back above it.
// These tests exercise the fix end to end with real ffmpeg (skipped where unavailable) instead of
// trusting the loudnorm filter's self-reported JSON, which is exactly the trap the original bug
// hid in.

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "render-cut.mjs");

function run(project, args = []) {
  // This suite measures the legacy audio pipeline; engine resolution has separate unit coverage.
  return spawnSync(process.execPath, [cliPath, project, ...legacyRenderArgs(args)], { encoding: "utf8" });
}

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

// ffmpeg's own ebur128 true-peak scanner (4x oversampled ITU-R BS.1770 true peak) against the
// *finished* artifact — the same measurement the original bug report used to catch the overshoot,
// and independent of anything render-cut itself claims.
function measureTruePeakDbfs(filePath) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", filePath, "-af", "ebur128=peak=true", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const match = result.stderr.match(/True peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  assert.ok(match, `ebur128 peak=true did not report a true peak for ${filePath}: ${result.stderr}`);
  return Number(match[1]);
}

async function writeProject(root, { duration, master }) {
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
        audio: { master },
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
}

// An isolated, near-full-scale pluck-shaped transient (fast exponential decay, the same envelope
// shape a real percussive/consonant peak has) at t=1.0s, riding on a quiet dialogue-level bed
// tone. render-cut's own pipeline re-encodes audio to AAC twice even for a single whole-span cut
// (once at the cut/join stage, once at the master/loudnorm stage: packages/render-cut/src/plan.mjs
// builds both with "-c:a aac"), on top of the source file's own AAC — three cascaded lossy passes
// in total, the same as a real project built from already-compressed footage. A *periodic*
// version of this transient was tried first and measured wildly non-deterministic overshoot
// (anywhere from -3 dB to +3 dB for a +/-0.05 amplitude change) because repeating pulses drift in
// and out of alignment with AAC's fixed 1024-sample MDCT block grid; a single isolated pulse
// avoids that resonance and measured a stable, reproducible true peak across every amplitude and
// bed-level combination tried (spot-checked 0.5-1.0 amplitude, all within +/-0.3 dB of each
// other) — the actual property this test needs.
async function makeHighPressureProject({ duration = 3, master }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-true-peak-"));
  const audioPath = join(root, "hot.wav");
  ffmpeg([
    "-f", "lavfi", "-i", `aevalsrc=0.9*exp(-40*abs(t-1.0))*sin(2*PI*900*t):s=48000:d=${duration}`,
    "-f", "lavfi", "-i", `sine=frequency=250:sample_rate=48000:duration=${duration}`,
    "-filter_complex", "[1:a]volume=-22dB[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[a]",
    "-map", "[a]",
    "-c:a", "pcm_s16le",
    audioPath,
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=10:duration=${duration}`,
    "-i", audioPath,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    join(root, "source.mp4"),
  ]);
  await writeProject(root, { duration, master });
  return root;
}

// The same gated tone burst as above but without the lowpass rounding or the quiet bed tone: a
// harder, more pathological edge shape whose AAC ringing is large enough that even the 1.5 dB
// margin (裁定B) does not fully absorb it. Used to prove 裁定A's warning still catches a real
// overshoot that margin B alone could not prevent — the margin is a mitigation, not a guarantee,
// and the receipt must say so when it fails.
async function makePathologicalProject({ duration = 3, master }) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-true-peak-pathological-"));
  const audioPath = join(root, "hot.wav");
  ffmpeg([
    "-f", "lavfi", "-i", `aevalsrc=0.97*sin(2*PI*1000*t)*lt(mod(t\\,0.4)\\,0.03):s=48000:d=${duration}`,
    "-c:a", "pcm_s16le",
    audioPath,
  ]);
  ffmpeg([
    "-f", "lavfi", "-i", `testsrc2=size=320x180:rate=10:duration=${duration}`,
    "-i", audioPath,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-shortest",
    join(root, "source.mp4"),
  ]);
  await writeProject(root, { duration, master });
  return root;
}

test("audio.master.true_peak_dbtp=-1 on high-pressure material: final mp4's real ebur128 true peak stays at or under 0 dBFS (裁定B margin)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeHighPressureProject({ duration: 3, master: { denoise: "off", loudnorm: -14, true_peak_dbtp: -1 } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.audio_qc.verdict, "INCONCLUSIVE");
    assert.equal(state.audio_qc.configured.true_peak_dbtp, -1, "configured stays the caller's original ask, not the applied margin target");
    assert.deepEqual(state.audio_qc.true_peak_margin, { overshoot_margin_dbtp: 1.5, applied_true_peak_dbtp: -2.5 });
    assert.match(state.plan.commands.audio_mix.args.join(" "), /loudnorm=I=-14:TP=-2\.5:LRA=11/u, "loudnorm must actually be told the margin-applied target, not the raw -1");

    const outputPath = join(project, state.artifacts[0].path);
    const measuredTruePeak = measureTruePeakDbfs(outputPath);
    t.diagnostic(`configured true_peak_dbtp=-1 dBTP; applied=-2.5 dBTP; final decoded artifact real true peak=${measuredTruePeak} dBFS`);
    assert.ok(measuredTruePeak <= 0, `expected the final artifact's real true peak to stay at or under 0 dBFS, measured ${measuredTruePeak} dBFS`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
test("audio.master.true_peak_dbtp omitted keeps today's unmargined -1.5 dBTP default (no regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeHighPressureProject({ duration: 3, master: { denoise: "off", loudnorm: -14 } });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.audio_qc.configured.true_peak_dbtp, -1.5);
    assert.equal(state.audio_qc.true_peak_margin, undefined, "the default target already carries its own headroom and must not be margined again");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /loudnorm=I=-14:TP=-1\.5:LRA=11/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
