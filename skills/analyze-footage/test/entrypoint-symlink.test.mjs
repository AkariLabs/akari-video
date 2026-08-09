import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../bin/is-main-module.mjs";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(cliPath, nodeOptions = []) {
  const result = spawnSync(process.execPath, [...nodeOptions, cliPath], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("transcribe-cloud.mjs runs identically through a symlink", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "analyze-footage-entrypoint-"));
  try {
    const realPath = join(skillRoot, "bin", "transcribe-cloud.mjs");
    const linkedPath = join(temporary, "transcribe-cloud.mjs");
    await symlink(realPath, linkedPath);

    for (const nodeOptions of [[], ["--preserve-symlinks"]]) {
      const expected = runCli(realPath, nodeOptions);
      assert.notEqual(expected.stdout || expected.stderr, "");
      assert.deepEqual(runCli(linkedPath, nodeOptions), expected);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("analyze-footage entrypoint detection fails open when realpath resolution fails", () => {
  assert.equal(isMainModule(import.meta.url, "/path/that/does/not/exist"), true);
});
