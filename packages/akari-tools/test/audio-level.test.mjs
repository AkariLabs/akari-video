import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runMediaCli } from "../bin/media.mjs";
import { audioLevelProject, formatAudioLevelTable } from "../src/audio-level.mjs";
import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "audio-level");
const measured = {
  metric: "akari-audio-measure-v1",
  integrated_lufs: -23,
  loudness_range_lu: 0,
  true_peak_dbtp: -20,
  sample_peak_dbfs: -20,
  rms_dbfs: -23,
  duration_sec: 5,
  sample_rate: 48000,
  channels: 1,
  source: { size: 1, mtime_ms: 1, sha1_key: "0".repeat(40) },
};

function copyProject(kind, t, { generateMedia = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `audio-level-${kind}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(path.join(fixtureRoot, kind), directory, { recursive: true });
  const assets = path.join(directory, "assets");
  fs.mkdirSync(assets, { recursive: true });
  if (!generateMedia) {
    for (const name of ["tone.wav", "click.wav", "silence.wav", "video.mp4"]) {
      fs.writeFileSync(path.join(assets, name), "fixture", "utf8");
    }
    return { directory, generated: false };
  }
  const ffmpeg = resolveFfmpeg();
  const recipes = [
    ["tone.wav", "sine=f=1000:r=48000:d=5"],
    ["click.wav", "sine=f=1000:r=48000:d=0.3"],
    ["silence.wav", "anullsrc=r=48000:cl=stereo:d=3"],
  ];
  let generated = true;
  for (const [name, source] of recipes) {
    const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source, "-y", path.join(assets, name)]);
    if (result.status !== 0) {
      generated = false;
      fs.writeFileSync(path.join(assets, name), "fixture", "utf8");
    }
  }
  const video = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=5", "-pix_fmt", "yuv420p", "-y", path.join(assets, "video.mp4")]);
  if (video.status !== 0) {
    generated = false;
    fs.writeFileSync(path.join(assets, "video.mp4"), "fixture", "utf8");
  }
  return { directory, generated };
}

const measureRunner = async ({ filePath }) => ({
  ...measured,
  ...(path.basename(filePath) === "click.wav"
    ? { integrated_lufs: null, true_peak_dbtp: -18.1, sample_peak_dbfs: -18.1, rms_dbfs: -21.1, duration_sec: 0.3 }
    : {}),
});
const lintPass = async () => ({ verdict: "pass", findings: [] });

test("v2 dry-run は 1 クリップ 1 行の表を返し edit.json を変えない", async (t) => {
  const { directory } = copyProject("v2", t);
  const before = fs.readFileSync(path.join(directory, "edit.json"), "utf8");
  const result = await audioLevelProject(directory, { measureRunner });
  const table = formatAudioLevelTable(result);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(result.rows.map(({ path: declaredPath, role, gain_db }) => ({ path: declaredPath, role, gain_db })), [
    { path: "assets/click.wav", role: "sfx", gain_db: 12 },
    { path: "assets/tone.wav", role: "sfx", gain_db: 5 },
    { path: "assets/tone.wav", role: "narration", gain_db: 7 },
    { path: "assets/tone.wav", role: "bgm", gain_db: -3 },
  ]);
  assert.match(table[0], /path\s+role\s+basis\s+I\(LUFS\)/u);
  assert.equal(fs.readFileSync(path.join(directory, "edit.json"), "utf8"), before);
});

test("--json は JSON 配列 1 つだけを stdout に出す", async (t) => {
  const { directory } = copyProject("v2", t);
  const stdout = [];
  const code = await runMediaCli(["audio-level", directory, "--json"], { stdout: (line) => stdout.push(line), stderr: () => {}, measureRunner });
  assert.equal(code, 0);
  assert.equal(stdout.length, 1);
  assert.equal(JSON.parse(stdout[0]).length, 4);
});

test("v2 --write は gain と未指定 fade だけを書き指定済み fade を保つ", async (t) => {
  const { directory } = copyProject("v2", t);
  const result = await audioLevelProject(directory, { write: true, measureRunner, lintRunner: lintPass });
  const edit = JSON.parse(fs.readFileSync(path.join(directory, "edit.json"), "utf8"));
  const items = edit.tracks.flatMap((track) => track.items ?? []);
  assert.equal(items.find((item) => item.id === "sfx-click").fade_out, 0.7);
  assert.equal(items.find((item) => item.id === "sfx-click").fade_in, 0);
  assert.equal(items.find((item) => item.id === "n-0001").fade_in, 0.4);
  assert.equal(items.find((item) => item.id === "n-0001").fade_out, 0);
  assert.ok(items.every((item) => item.id === "clip-1" || Object.hasOwn(item, "gain_db")));
  assert.ok(result.rows.every((row) => row.written));
});

test("legacy --write は既存 API 経由で sfx / narration / bgm を更新する", async (t) => {
  const { directory } = copyProject("legacy", t);
  await audioLevelProject(directory, { write: true, measureRunner, lintRunner: lintPass });
  const edit = JSON.parse(fs.readFileSync(path.join(directory, "edit.json"), "utf8"));
  assert.equal(edit.audio.sfx[0].gain_db, 15.1 > 12 ? 12 : 15.1);
  assert.equal(edit.audio.sfx[0].fade_out, 0.7);
  assert.equal(edit.audio.sfx[0].fade_in, 0);
  assert.equal(edit.audio.narration[0].gain_db, 7);
  assert.equal(edit.audio.narration[0].fade_in, 0.4);
  assert.equal(edit.audio.bgm.gain_db, -3);
  assert.equal(edit.audio.bgm.fadeIn, 0.2);
});

test("legacy --write は実 edit-lint の古い形式 error で reject され byte 同一へ戻る", async (t) => {
  const { directory } = copyProject("legacy", t, { generateMedia: false });
  const editPath = path.join(directory, "edit.json");
  const before = fs.readFileSync(editPath);
  await assert.rejects(
    audioLevelProject(directory, { write: true, measureRunner }),
    /古い形式/u,
  );
  assert.deepEqual(fs.readFileSync(editPath), before);
});

test("2 回目の実行は対象 0 件で exit 0", async (t) => {
  const { directory } = copyProject("v2", t);
  await audioLevelProject(directory, { write: true, measureRunner, lintRunner: lintPass });
  const stdout = [];
  const code = await runMediaCli(["audio-level", directory], { stdout: (line) => stdout.push(line), stderr: () => {}, measureRunner });
  assert.equal(code, 0);
  assert.deepEqual(stdout, ["対象 0 件"]);
});

test("lint error は edit.json 全文を巻き戻す", async (t) => {
  const { directory } = copyProject("v2", t);
  const editPath = path.join(directory, "edit.json");
  const before = fs.readFileSync(editPath, "utf8");
  const lintFail = async () => ({ verdict: "fail", findings: [{ severity: "error", message: "injected failure" }] });
  await assert.rejects(
    audioLevelProject(directory, { write: true, measureRunner, lintRunner: lintFail }),
    /edit\.json を元に戻しました/u,
  );
  assert.equal(fs.readFileSync(editPath, "utf8"), before);
});

test("素材不在は stderr warning だけで他の対象を続行する", async (t) => {
  const { directory } = copyProject("v2", t);
  fs.rmSync(path.join(directory, "assets", "click.wav"));
  const stderr = [];
  const stdout = [];
  const code = await runMediaCli(["audio-level", directory], {
    stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line), measureRunner,
  });
  assert.equal(code, 0);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /素材が見つからない/u);
  assert.equal(stdout.length, 4);
});

test("生成可能な環境では fixture を実 edit-lint に通す", async (t) => {
  const { directory, generated } = copyProject("v2", t);
  if (!generated) return t.skip("実行環境が Node 子プロセスから ffmpeg を起動できないため");
  await audioLevelProject(directory, { write: true, measureRunner });
});
