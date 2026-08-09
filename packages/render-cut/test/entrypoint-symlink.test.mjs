import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../bin/is-main-module.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(cliPath, nodeOptions = []) {
  const result = spawnSync(process.execPath, [...nodeOptions, cliPath], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

for (const cliName of ["akari-apply-textstyle.mjs", "fill-caption-words.mjs"]) {
  test(`${cliName} runs identically through a symlink`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), "render-cut-entrypoint-"));
    try {
      const realPath = join(packageRoot, "bin", cliName);
      const linkedPath = join(temporary, cliName);
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
}

test("render-cut entrypoint detection fails open when realpath resolution fails", () => {
  assert.equal(isMainModule(import.meta.url, "/path/that/does/not/exist"), true);
});
