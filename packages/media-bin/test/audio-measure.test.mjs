import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { measureAudioLevels, parseAudioMeasureStderr } from "../src/audio-measure.mjs";
import { resolveFfmpeg } from "../src/index.mjs";
import { runAudioMeasureCli } from "../bin/audio-measure.mjs";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "audio-measure");

function fixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

function createTone(directory, duration = 5, context) {
  const output = path.join(directory, `tone-${duration}.wav`);
  const result = spawnSync(resolveFfmpeg(), [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=f=1000:r=48000:d=${duration}`,
    "-af", "volume=8,volume=-20dB", "-y", output,
  ], { encoding: "utf8" });
  if (result.error?.code === "EPERM") {
    context.skip("実行環境が Node 子プロセスから ffmpeg を起動できないため");
    return null;
  }
  assert.equal(result.status, 0, result.stderr);
  return output;
}

test("実 ffmpeg の 5 秒 tone fixture から Summary と Overall を読む", () => {
  assert.deepEqual(parseAudioMeasureStderr(fixture("tone-1k-minus20db.stderr")), {
    integrated_lufs: -23,
    loudness_range_lu: 0,
    true_peak_dbtp: -20,
    sample_peak_dbfs: -20.002121,
    rms_dbfs: -23.012265,
  });
});

test("0.3 秒 fixture の -70 LUFS は null にするが peak は残す", () => {
  const result = parseAudioMeasureStderr(fixture("click-300ms.stderr"));
  assert.equal(result.integrated_lufs, null);
  assert.equal(result.loudness_range_lu, null);
  assert.equal(result.true_peak_dbtp, -18.1);
  assert.equal(result.sample_peak_dbfs, -18.063921);
});

test("無音 fixture の loudness と peak はすべて null", () => {
  assert.deepEqual(parseAudioMeasureStderr(fixture("silence-3s.stderr")), {
    integrated_lufs: null,
    loudness_range_lu: null,
    true_peak_dbtp: null,
    sample_peak_dbfs: null,
    rms_dbfs: null,
  });
});

test("実 ffmpeg 統合計測は metric・メタデータ・source key を返す", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-measure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = createTone(directory, 5, t);
  if (!filePath) return;
  const result = measureAudioLevels({
    ffmpegPath: resolveFfmpeg(), filePath, cacheDir: path.join(directory, "cache"),
  });
  assert.equal(result.metric, "akari-audio-measure-v1");
  assert.ok(Math.abs(result.integrated_lufs - -23) <= 0.5);
  assert.equal(result.sample_rate, 48000);
  assert.equal(result.channels, 1);
  assert.match(result.source.sha1_key, /^[a-f0-9]{40}$/u);
});

test("キャッシュは key.json から読み、useCache false は再計測して上書きする", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-cache-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cacheDir = path.join(directory, "cache");
  const filePath = createTone(directory, 1.2, t);
  if (!filePath) return;
  const options = { ffmpegPath: resolveFfmpeg(), filePath, cacheDir };
  const first = measureAudioLevels(options);
  const cachePath = path.join(cacheDir, `${first.source.sha1_key}.json`);
  fs.writeFileSync(cachePath, JSON.stringify({ cached: true }), "utf8");
  assert.deepEqual(measureAudioLevels(options), { cached: true });
  const refreshed = measureAudioLevels({ ...options, useCache: false });
  assert.equal(refreshed.metric, "akari-audio-measure-v1");
  assert.equal(JSON.parse(fs.readFileSync(cachePath, "utf8")).metric, "akari-audio-measure-v1");
});

test("cache key は mtime の変更で変わる", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-key-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = createTone(directory, 1.1, t);
  if (!filePath) return;
  const options = { ffmpegPath: resolveFfmpeg(), filePath, cacheDir: path.join(directory, "cache") };
  const first = measureAudioLevels(options);
  const nextTime = new Date(fs.statSync(filePath).mtimeMs + 2000);
  fs.utimesSync(filePath, nextTime, nextTime);
  const second = measureAudioLevels(options);
  assert.notEqual(first.source.sha1_key, second.source.sha1_key);
});

test("CLI の既定 cacheDir は素材親から見つけた projectRoot の .akari 配下", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-cli-cache-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, ".akari"));
  const assets = path.join(directory, "assets");
  fs.mkdirSync(assets);
  const filePath = createTone(assets, 1.3, t);
  if (!filePath) return;
  const stdout = [];
  const stderr = [];
  const code = runAudioMeasureCli([filePath], {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  assert.equal(code, 0, stderr.join("\n"));
  const measured = JSON.parse(stdout[0]);
  assert.equal(fs.existsSync(path.join(directory, ".akari", "cache", "audio-measure", `${measured.source.sha1_key}.json`)), true);
  assert.equal(fs.existsSync(path.join(assets, ".akari")), false);
});
