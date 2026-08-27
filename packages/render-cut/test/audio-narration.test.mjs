import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile as rawWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMigratingWriteFile } from "./helpers/v2-fixture.mjs";

const writeFile = createMigratingWriteFile(rawWriteFile);

import { buildAudioMixCommand } from "../src/plan.mjs";

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

// Measures mean_volume (roughly RMS, in dBFS) of [start, start+duration) in filePath via
// ffmpeg's volumedetect filter. Used to prove narration/BGM/ducking effects deterministically
// instead of listening to output.
function measureMeanVolume(filePath, start, duration) {
  return measureVolumeDetect(filePath, start, duration).meanVolume;
}

// Measures max_volume (peak, in dBFS) of [start, start+duration) in filePath. Unlike mean_volume,
// a single audible narration syllable pushes max_volume close to the source's own peak regardless
// of how much silence surrounds it within the window, making it a robust presence/absence check.
function measureMaxVolume(filePath, start, duration) {
  return measureVolumeDetect(filePath, start, duration).maxVolume;
}

function measureVolumeDetect(filePath, start, duration) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", filePath, "-ss", String(start), "-t", String(duration), "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const meanMatch = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  const maxMatch = result.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  assert.ok(meanMatch && maxMatch, `volumedetect did not report mean/max_volume for ${filePath}: ${result.stderr}`);
  return { meanVolume: Number(meanMatch[1]), maxVolume: Number(maxMatch[1]) };
}

function makeTone(path, { frequency, duration, gainDb = 0, sampleRate = 48000 }) {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${frequency}:sample_rate=${sampleRate}:duration=${duration}`,
    "-af",
    `volume=${gainDb}dB`,
    "-c:a",
    "pcm_s16le",
    path,
  ]);
}

function makeSilentSourceVideo(path, { width = 320, height = 180, fps = 10, duration }) {
  ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

// Builds a render-cut project fixture with a video-only source (silent) plus optional BGM
// (constant 440Hz tone) and narration (short tone at a given t). All media is generated
// deterministically with ffmpeg at test time; nothing audio-related is committed to the repo.
async function makeProject({
  duration = 6,
  bgm = { gainDb: -18, ducking: false },
  narration = [{ id: "n-0001", t: 2, durationSeconds: 2, frequency: 880, gainDb: 0 }],
  narrationFileExists = true,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "render-cut-narration-test-"));
  makeSilentSourceVideo(join(root, "source.mp4"), { duration });
  await mkdir(join(root, "audio"));

  const audio = {};
  if (bgm) {
    makeTone(join(root, "audio", "bgm.wav"), { frequency: 440, duration: Math.max(duration, 1) });
    audio.bgm = { path: "audio/bgm.wav", gain_db: bgm.gainDb, ducking: bgm.ducking === true };
  }
  if (narration) {
    audio.narration = narration.map((item) => {
      const relPath = narrationFileExists ? `audio/${item.id}.wav` : `audio/${item.id}-missing.wav`;
      if (narrationFileExists) {
        // sourceGainDb boosts the tone baked into the source WAV file itself (as a real narration
        // recording would already be mixed near broadcast level), independent of item.gainDb which
        // maps to edit.json's audio.narration[].gain_db (the mix-time gain render-cut applies).
        // The sine source's default amplitude peaks around -18dBFS, too quiet on its own to clear
        // an audibility threshold even when the mix is working correctly.
        makeTone(join(root, relPath), { frequency: item.frequency, duration: item.durationSeconds, gainDb: item.sourceGainDb ?? 0 });
      }
      return {
        id: item.id,
        path: relPath,
        t: item.t,
        gain_db: item.gainDb,
        provenance: { provider: "human" },
      };
    });
  }

  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(
      {
        version: 0,
        output: { width: 320, height: 180, fps: 10 },
        source: { path: "source.mp4", proxy: null },
        cuts: [{ in: 0, out: duration }],
        overlays: [],
        audio,
      },
      null,
      2,
    )}\n`,
  );
  await mkdir(join(root, ".akari"));
  await writeFile(join(root, ".akari", "lint.json"), '{"version":1,"verdict":"pass"}\n');
  return root;
}

test("narration merges into the final mix; output audio exists and total duration matches the video", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({ duration: 6 });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.equal(state.artifacts[0].ffprobe.audio_codec, "aac");
    assert.ok(
      Math.abs(state.artifacts[0].ffprobe.duration_seconds - 6) <= state.plan.duration_tolerance_seconds,
      `expected output duration ~6s, got ${state.artifacts[0].ffprobe.duration_seconds}s`,
    );
    assert.ok(
      state.verify.findings.some((finding) => finding.check === "verify.narration-audio" && finding.severity === "info"),
      "expected a passing verify.narration-audio finding because edit.json declares audio.narration",
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("narration gain_db is honored: -20dB output is measurably quieter than 0dB during the narration window", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const loud = await makeProject({
    duration: 6,
    bgm: null,
    narration: [{ id: "n-0001", t: 2, durationSeconds: 2, frequency: 880, gainDb: 0 }],
  });
  const quiet = await makeProject({
    duration: 6,
    bgm: null,
    narration: [{ id: "n-0001", t: 2, durationSeconds: 2, frequency: 880, gainDb: -20 }],
  });
  try {
    const loudExecuted = run(loud);
    const quietExecuted = run(quiet);
    assert.equal(loudExecuted.status, 0, loudExecuted.stderr);
    assert.equal(quietExecuted.status, 0, quietExecuted.stderr);

    const loudState = JSON.parse(await readFile(join(loud, ".akari", "render.json"), "utf8"));
    const quietState = JSON.parse(await readFile(join(quiet, ".akari", "render.json"), "utf8"));
    const loudLevel = measureMeanVolume(join(loud, loudState.artifacts[0].path), 2, 2);
    const quietLevel = measureMeanVolume(join(quiet, quietState.artifacts[0].path), 2, 2);

    t.diagnostic(`gain_db=0 region mean_volume=${loudLevel.toFixed(2)}dB; gain_db=-20 region mean_volume=${quietLevel.toFixed(2)}dB; delta=${(loudLevel - quietLevel).toFixed(2)}dB`);
    assert.ok(
      quietLevel < loudLevel - 5,
      `expected gain_db=-20 output (${quietLevel}dB) to be notably quieter than gain_db=0 (${loudLevel}dB)`,
    );
  } finally {
    await rm(loud, { recursive: true, force: true });
    await rm(quiet, { recursive: true, force: true });
  }
});

test("ducking measurably lowers the BGM level during the narration window when narration is the sidechain trigger", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const root = await mkdtemp(join(tmpdir(), "render-cut-ducking-test-"));
  try {
    const duration = 8;
    await mkdir(join(root, "audio"));
    makeTone(join(root, "audio", "bgm.wav"), { frequency: 440, duration });
    // Boost the narration source well above the -24dBFS-ish compressor threshold so the ducking
    // effect is clearly separable from measurement noise (docs/contract-2026-07-14-edit-json-v1-audio.md §4).
    makeTone(join(root, "audio", "narration.wav"), { frequency: 880, duration: 2, gainDb: 24 });
    const placeholder = join(root, "composite-placeholder.wav");
    ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${duration}`, "-c:a", "pcm_s16le", placeholder]);

    const results = {};
    for (const ducking of [true, false]) {
      const edit = {
        audio: {
          bgm: { path: "audio/bgm.wav", gain_db: -18, ducking },
          narration: [{ id: "n-0001", path: "audio/narration.wav", t: 2, gain_db: 0 }],
        },
      };
      const command = buildAudioMixCommand({
        edit,
        projectRoot: root,
        inputPath: placeholder,
        outputPath: join(root, `unused-${ducking}.wav`),
        duration,
        ffmpegCommand: "ffmpeg",
        ffprobeCommand: "ffprobe",
      });
      assert.equal(command.operation, "ffmpeg");
      assert.equal(command.hasNarration, true);
      assert.equal(command.args.join(" ").includes("sidechaincompress"), ducking, `sidechaincompress should only appear when ducking is true (ducking=${ducking})`);

      // Re-map the same real filter graph render-cut would use, but output only the (possibly
      // ducked) BGM branch with narration excluded from the audible signal, so its measurement
      // is not contaminated by narration's own tone. This mirrors the audio contract's suggested
      // "narration muted for listening" measurement approach while still exercising the exact
      // sidechaincompress wiring buildAudioMixCommand produces.
      const filterComplexIndex = command.args.indexOf("-filter_complex");
      const filterComplex = command.args[filterComplexIndex + 1];
      const bgmLabel = filterComplex.includes("sidechaincompress") ? "[bgm_ducked]" : "[bgm]";
      // Drop the trailing "...amix=...[mixed]" statement (always the last ";"-separated step):
      // it already consumes the bgm/bgm_ducked pad, and a pad can only be mapped to output XOR
      // consumed by another filter, not both.
      const filterStepsWithoutFinalMix = filterComplex.split(";").slice(0, -1).join(";");
      const inputArgs = command.args.slice(0, filterComplexIndex);
      const listeningPath = join(root, `listening-${ducking}.wav`);
      const listeningArgs = [...inputArgs, "-filter_complex", filterStepsWithoutFinalMix, "-map", bgmLabel, "-c:a", "pcm_s16le", "-ar", "48000", listeningPath];
      // Dropping the trailing amix step leaves whichever narration-derived pad it alone consumed
      // dangling: [nar_mix] when ducking split narration via asplit (its sibling [nar_sc] is
      // consumed by sidechaincompress), or plain [narration] when ducking is off. Give it a
      // throwaway second output so the filtergraph stays fully connected.
      const danglingNarrationLabel = ducking ? "[nar_mix]" : "[narration]";
      listeningArgs.push("-map", danglingNarrationLabel, "-c:a", "pcm_s16le", "-ar", "48000", join(root, `discard-narration-${ducking}.wav`));
      const listening = spawnSync(command.command, listeningArgs, { encoding: "utf8" });
      assert.equal(listening.status, 0, listening.stderr);

      results[ducking ? "ducked" : "flat"] = {
        window: measureMeanVolume(listeningPath, 2, 2),
        control: measureMeanVolume(listeningPath, 0, 2),
      };
    }

    t.diagnostic(
      `ducking=true window=${results.ducked.window.toFixed(2)}dB control=${results.ducked.control.toFixed(2)}dB; ` +
        `ducking=false window=${results.flat.window.toFixed(2)}dB control=${results.flat.control.toFixed(2)}dB`,
    );

    assert.ok(
      results.ducked.window < results.flat.window - 1.5,
      `expected ducking:true window level (${results.ducked.window}dB) to be at least 1.5dB lower than ducking:false (${results.flat.window}dB)`,
    );
    assert.ok(
      Math.abs(results.ducked.control - results.flat.control) < 1,
      `expected the pre-narration control regions to match closely regardless of ducking: true=${results.ducked.control}dB false=${results.flat.control}dB`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Regression for the T5 incident (2026-07-21): [narration] was referenced twice in the ducking
// filter graph (once by sidechaincompress, once by the final amix) without an asplit. ffmpeg 8.1.1
// accepts that without error but silently leaves the second reference unconnected, so narration
// disappeared from the real, produced output whenever bgm.ducking was true — a combination the
// earlier tests never rendered end-to-end (the audibility test used ducking:false, and the ducking
// test measured a narration-excluded "listening" derivative). This test renders the real CLI output
// with both bgm.ducking:true and narration present, and checks narration is actually audible in it.
test("narration remains audible in the real output when ducking is on (asplit regression)", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    duration: 6,
    bgm: { gainDb: -18, ducking: true },
    narration: [{ id: "n-0001", t: 2, durationSeconds: 2, frequency: 880, gainDb: 0, sourceGainDb: 12 }],
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.match(state.plan.commands.audio_mix.args.join(" "), /asplit=2\[nar_sc\]\[nar_mix\]/);

    const outputPath = join(project, state.artifacts[0].path);
    const narrationWindowMax = measureMaxVolume(outputPath, 2, 2);
    t.diagnostic(`ducking:true narration-window max_volume=${narrationWindowMax.toFixed(2)}dB`);
    assert.ok(
      narrationWindowMax >= -12,
      `expected narration to be audible (max_volume >= -12dB) during [2,4]s with ducking:true, got ${narrationWindowMax}dB`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("a narration file that cannot be found is skipped with a warning; the render still succeeds with BGM only", async (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");
  const project = await makeProject({
    duration: 6,
    bgm: { gainDb: -18, ducking: false },
    narration: [{ id: "n-0001", t: 2, durationSeconds: 2, frequency: 880, gainDb: 0 }],
    narrationFileExists: false,
  });
  try {
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stderr, /render-cut warning:.*narration n-0001.*(file not found|skipped)/i);

    const state = JSON.parse(await readFile(join(project, ".akari", "render.json"), "utf8"));
    assert.equal(state.verify.verdict, "pass");
    assert.ok(state.warnings.length > 0);
    assert.ok(state.warnings.some((warning) => warning.includes("n-0001")));
    assert.ok(
      !state.verify.findings.some((finding) => finding.check === "verify.narration-audio"),
      "verify.narration-audio should not appear once the only narration element degraded away",
    );

    const outputPath = join(project, state.artifacts[0].path);
    const narrationWindow = measureMeanVolume(outputPath, 2, 2);
    const control = measureMeanVolume(outputPath, 0, 2);
    t.diagnostic(`narration-window level=${narrationWindow.toFixed(2)}dB; bgm-only control level=${control.toFixed(2)}dB`);
    assert.ok(
      Math.abs(narrationWindow - control) < 1,
      `expected the narration window (${narrationWindow}dB) to match the BGM-only baseline (${control}dB) since narration should be skipped`,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("narration in/out adds the trim prefix while an omitted window keeps the legacy filter byte-identical and avoids ffprobe", async () => {
  const root = await mkdtemp(join(tmpdir(), "render-cut-narration-trim-plan-"));
  try {
    const narrationPath = join(root, "voice.wav");
    const probePath = join(root, "ffprobe-fixture.mjs");
    const callsPath = join(root, "ffprobe-calls.txt");
    await rawWriteFile(narrationPath, "fixture");
    await rawWriteFile(probePath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(callsPath)}, "probe\\n");
process.stdout.write(JSON.stringify({ format: { duration: 12 } }));
`);
    await chmod(probePath, 0o755);

    const build = narration => buildAudioMixCommand({
      edit: { audio: { narration } },
      projectRoot: root,
      inputPath: join(root, "composite.mp4"),
      outputPath: join(root, "final.mp4"),
      duration: 12,
      ffmpegCommand: "ffmpeg",
      ffprobeCommand: probePath,
    });
    const untrimmed = build([{ id: "n-0001", path: "voice.wav", t: 0, gain_db: 0 }]);
    const untrimmedFilter = untrimmed.args[untrimmed.args.indexOf("-filter_complex") + 1];
    assert.match(untrimmedFilter, /^\[1:a\]volume=0dB,adelay=0:all=1\[nar_raw0\]/);
    assert.doesNotMatch(untrimmedFilter, /atrim=start=/);
    await assert.rejects(readFile(callsPath, "utf8"), { code: "ENOENT" });

    const trimmed = build([{
      id: "n-0001", path: "voice.wav", t: 0, in: 5.8, out: 9.7, gain_db: 0,
    }]);
    const trimmedFilter = trimmed.args[trimmed.args.indexOf("-filter_complex") + 1];
    assert.match(trimmedFilter, /\[1:a\]atrim=start=5\.8:end=9\.7,asetpts=PTS-STARTPTS,volume=0dB/);
    assert.equal((await readFile(callsPath, "utf8")).trim().split("\n").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
