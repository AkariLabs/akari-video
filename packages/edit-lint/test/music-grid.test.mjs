import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");
const trackId = "bgm-test-track-60";
const bgmRelativePath = `assets/audio/${trackId}/track.wav`;

function run(projectRoot, args = [], env = {}) {
  return spawnSync(process.execPath, [cliPath, projectRoot, "--json", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function parseResult(runResult) {
  assert.equal(runResult.signal, null, runResult.stderr);
  assert.notEqual(runResult.stdout.trim(), "", runResult.stderr);
  return JSON.parse(runResult.stdout);
}

function musicGridFindings(result) {
  return result.findings.filter((finding) =>
    finding.check.startsWith("audio.sfx.music-grid"),
  );
}

function makeEdit(timelineDuration, sfx) {
  return {
    version: 1,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: "s1", path: "source.mp4", proxy: null }],
    cuts: [{ src: "s1", in: 0, out: timelineDuration }],
    overlays: [],
    audio: {
      bgm: {
        path: bgmRelativePath,
        gain_db: 0,
        ducking: false,
        in: 0,
      },
      sfx,
    },
  };
}

async function createProject(timelineDuration, sfx) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-music-grid-"));
  await mkdir(join(root, "assets", "audio", trackId), { recursive: true });
  await writeFile(join(root, "source.mp4"), "", "utf8");
  await writeFile(join(root, "sfx.wav"), "", "utf8");
  await writeFile(
    join(root, "edit.json"),
    `${JSON.stringify(makeEdit(timelineDuration, sfx), null, 2)}\n`,
    "utf8",
  );
  const declarationsPath = join(root, "declarations.json");
  await writeFile(
    declarationsPath,
    `${JSON.stringify({
      [trackId]: {
        bpm: 60,
        beat_offset_s: 0,
        time_signature: "4/4",
        hit_points: [0.001],
      },
    }, null, 2)}\n`,
    "utf8",
  );
  return { root, declarationsPath, trackPath: join(root, bgmRelativePath) };
}

function generateSilentWav(filePath, duration = 10) {
  return spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      String(duration),
      "-c:a",
      "pcm_s16le",
      filePath,
    ],
    { encoding: "utf8" },
  );
}

test("declared SFX on the music grid produces no warning", async (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (available.status !== 0) {
    t.skip("ffmpeg is not available");
    return;
  }

  const project = await createProject(8, [
    { path: "sfx.wav", t: 4, gain_db: -4 },
    { path: "sfx.wav", t: 4.05, gain_db: -4 },
  ]);
  try {
    const generated = generateSilentWav(project.trackPath);
    assert.equal(generated.status, 0, generated.stderr);

    const executed = run(project.root, ["--declarations", project.declarationsPath]);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(musicGridFindings(result).length, 0, JSON.stringify(result.findings, null, 2));
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("SFX 0.3 seconds off the nearest downbeat produces one warning", async (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (available.status !== 0) {
    t.skip("ffmpeg is not available");
    return;
  }

  const project = await createProject(8, [
    { path: "sfx.wav", t: 4.3, gain_db: -4 },
  ]);
  try {
    const generated = generateSilentWav(project.trackPath);
    assert.equal(generated.status, 0, generated.stderr);

    const executed = run(project.root, ["--declarations", project.declarationsPath]);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    const offsetFindings = result.findings.filter(
      (finding) => finding.check === "audio.sfx.music-grid",
    );
    assert.equal(result.verdict, "pass");
    assert.equal(offsetFindings.length, 1, JSON.stringify(result.findings, null, 2));
    assert.match(offsetFindings[0].message, /4\.3/);
    assert.match(offsetFindings[0].message, /0\.3/);
    assert.match(offsetFindings[0].message, /downbeat/);
    assert.equal(
      result.findings.filter((finding) => finding.check === "audio.sfx.music-grid-seam")
        .length,
      0,
    );
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("SFX on a BGM loop seam produces a seam warning", async (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (available.status !== 0) {
    t.skip("ffmpeg is not available");
    return;
  }

  const project = await createProject(12, [
    { path: "sfx.wav", t: 10, gain_db: -4 },
  ]);
  try {
    const generated = generateSilentWav(project.trackPath);
    assert.equal(generated.status, 0, generated.stderr);

    const executed = run(project.root, ["--declarations", project.declarationsPath]);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.filter(
        (finding) => finding.check === "audio.sfx.music-grid-seam",
      ).length >= 1,
      JSON.stringify(result.findings, null, 2),
    );
    assert.equal(
      result.findings.filter((finding) => finding.check === "audio.sfx.music-grid").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});

test("missing declarations, BGM, or SFX skip music grid checks without warnings", async () => {
  for (const caseName of ["bgm-absent", "sfx-empty", "declarations-absent"]) {
    const project = await createProject(8, [
      { path: "sfx.wav", t: 4, gain_db: -4 },
    ]);
    try {
      await writeFile(project.trackPath, "", "utf8");
      const editPath = join(project.root, "edit.json");
      const edit = makeEdit(8, [{ path: "sfx.wav", t: 4, gain_db: -4 }]);
      if (caseName === "bgm-absent") delete edit.audio.bgm;
      if (caseName === "sfx-empty") edit.audio.sfx = [];
      await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");

      let args = ["--declarations", project.declarationsPath];
      let env = {};
      if (caseName === "declarations-absent") {
        const emptyHome = join(project.root, "empty-akari-home");
        await mkdir(emptyHome, { recursive: true });
        args = [];
        env = { AKARI_HOME: emptyHome, AKARI_SOUNDS_DECLARATIONS: "" };
      }

      const executed = run(project.root, args, env);
      assert.equal(executed.status, 0, `${caseName}: ${executed.stderr}`);
      const result = parseResult(executed);
      assert.equal(result.verdict, "pass", caseName);
      assert.equal(
        musicGridFindings(result).length,
        0,
        `${caseName}: ${JSON.stringify(result.findings, null, 2)}`,
      );
      assert.ok(
        result.skipped.some((item) => item.check === "audio.music-grid"),
        `${caseName}: ${JSON.stringify(result.skipped, null, 2)}`,
      );
    } finally {
      await rm(project.root, { recursive: true, force: true });
    }
  }
});

test("missing ffprobe skips music grid checks with a reason", async () => {
  const project = await createProject(8, [
    { path: "sfx.wav", t: 4, gain_db: -4 },
  ]);
  try {
    await writeFile(project.trackPath, "placeholder", "utf8");
    const executed = run(
      project.root,
      ["--declarations", project.declarationsPath],
      { FFPROBE: join(project.root, "no-such-ffprobe-binary") },
    );
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(musicGridFindings(result).length, 0, JSON.stringify(result.findings, null, 2));
    assert.ok(
      result.skipped.some(
        (item) => item.check === "audio.music-grid" && item.reason.length > 0,
      ),
      JSON.stringify(result.skipped, null, 2),
    );
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
