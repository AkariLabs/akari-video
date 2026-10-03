import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkAvailability } from "../face-expression/face-expression.mjs";

test("face-expression reports ffmpeg and ffprobe unavailable when explicit binaries are missing", async () => {
  const previousFfmpeg = process.env.AKARI_FFMPEG_BIN;
  const previousFfprobe = process.env.AKARI_FFPROBE_BIN;
  try {
    process.env.AKARI_FFMPEG_BIN = "/nonexistent/ffmpeg";
    process.env.AKARI_FFPROBE_BIN = "/nonexistent/ffprobe";

    const availability = await checkAvailability();
    assert.equal(availability.available, false);
    assert.match(availability.reason, /ffmpeg が利用できません/);
    assert.match(availability.reason, /ffprobe が利用できません/);
  } finally {
    if (previousFfmpeg === undefined) delete process.env.AKARI_FFMPEG_BIN;
    else process.env.AKARI_FFMPEG_BIN = previousFfmpeg;
    if (previousFfprobe === undefined) delete process.env.AKARI_FFPROBE_BIN;
    else process.env.AKARI_FFPROBE_BIN = previousFfprobe;
  }
});

test("copied face-expression uses ffmpeg and ffprobe from PATH", {
  skip: process.platform === "win32" ? "shell script を実行できないため" : false,
}, () => {
  const dir = mkdtempSync(join(tmpdir(), "face-expression-copied-skill-test-"));
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const skillDir = join(dir, "proj", ".claude", "skills", "analyze-footage");
    const binDir = join(dir, "bin");
    const homeDir = join(dir, "home");
    mkdirSync(dirname(skillDir), { recursive: true });
    mkdirSync(binDir);
    mkdirSync(homeDir);
    cpSync(resolve(here, "../.."), skillDir, { recursive: true });
    for (const command of ["ffmpeg", "ffprobe"]) {
      const fakeBin = join(binDir, command);
      writeFileSync(fakeBin, '#!/bin/sh\n[ "$1" = "-version" ] || exit 1\nexit 0\n', "utf8");
      chmodSync(fakeBin, 0o755);
    }
    const env = { ...process.env, HOME: homeDir, PATH: `${binDir}:${process.env.PATH}` };
    for (const key of ["AKARI_MONOREPO", "AKARI_INSTALL_DIR", "AKARI_FFMPEG_BIN", "AKARI_FFPROBE_BIN"]) {
      delete env[key];
    }
    const script = join(skillDir, "bin", "face-expression", "face-expression.mjs");
    const result = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8", env });
    const availability = JSON.parse(result.stdout);
    assert.doesNotMatch(availability.reason ?? "", /ffmpeg が利用できません|ffprobe が利用できません/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
