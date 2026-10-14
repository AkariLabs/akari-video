import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runSpeakersCommand } from "../src/speakers-command.mjs";
import { runToolsCommand } from "../src/tools-command.mjs";
import { resolveLauncherAssets, resolveRepoAssets } from "../src/repo-assets.mjs";

for (const [command, field, run] of [
  ["speakers", "speakersScript", runSpeakersCommand],
  ["tools", "toolsScript", runToolsCommand],
]) {
  test(`akari ${command} は同梱 CLI に引数を渡す`, async () => {
    const calls = [];
    const script = path.join("packages", "akari-tools", "bin", `${command}.mjs`);
    const result = await run(["--help"], { assets: { [field]: script }, spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    } });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [[process.execPath, [script, "--help"], { stdio: "inherit" }]]);
  });

  test(`akari ${command} の実行体が無いときは再導入を案内する`, async () => {
    const errors = [];
    const result = await run([], { assets: { [field]: null }, logError: line => errors.push(line),
      spawn: () => { throw new Error("起動されません"); } });
    assert.equal(result.exitCode, 1);
    assert.match(errors.join("\n"), /npm install -g akari-video/);
  });
}

test("話者と道具の実行体は個別に解決される", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "launcher-voice-"));
  try {
    const candidateRoot = path.join(root, "candidate");
    const vendorRoot = path.join(root, "vendor");
    await mkdir(vendorRoot, { recursive: true });
    for (const command of ["speakers", "tools"]) {
      const file = path.join(candidateRoot, "packages", "akari-tools", "bin", `${command}.mjs`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "", "utf8");
    }
    const repo = resolveRepoAssets(candidateRoot);
    const launcher = resolveLauncherAssets({ candidateRoot, vendorRoot });
    for (const field of ["speakersScript", "toolsScript"]) {
      assert.equal(Object.hasOwn(repo, field), true);
      assert.equal(launcher[field], repo[field]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
