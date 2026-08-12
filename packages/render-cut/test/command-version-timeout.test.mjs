import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { commandVersion } from "../src/render-cut.mjs";

test("commandVersion returns a trimmed version-like first line", () => {
  const expected = "ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers";
  const version = commandVersion("/bin/sh", ["-c", "printf '  %s  \\n' \"$1\"", "sh", expected]);

  assert.equal(version, expected);
  assert.match(version, /\d+\.\d+\.\d+/u);
});

test("commandVersion returns null after timing out an unending command", (t) => {
  const startedAt = Date.now();
  const version = commandVersion(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  t.diagnostic(`commandVersion timeout elapsed: ${elapsedSeconds.toFixed(3)}s`);
  assert.equal(version, null);
  assert.ok(elapsedSeconds >= 4.5, `expected the 5s timeout to wait at least 4.5s, got ${elapsedSeconds}s`);
  assert.ok(elapsedSeconds <= 20, `expected the timeout to return within 20s, got ${elapsedSeconds}s`);
});

test("commandVersion returns null for output without a version", () => {
  const version = commandVersion("/bin/sh", [
    "-c",
    "printf '%s\\n' '既存のブラウザ セッションで開いています。'",
  ]);

  assert.equal(version, null);
});

test("commandVersion reads the installed ffmpeg version when available", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg unavailable");

  const version = commandVersion("ffmpeg", ["-version"]);
  assert.notEqual(version, null);
  assert.match(version, /\d+\.\d+\.\d+/u);
});
