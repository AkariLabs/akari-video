import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runWordBookCommand } from "../src/word-book-command.mjs";
import { resolveLauncherAssets, resolveRepoAssets } from "../src/repo-assets.mjs";

test("akari word-book --help は 4 サブコマンドを列挙する", () => {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "akari.mjs");
  const result = spawnSync(process.execPath, [bin, "word-book", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  for (const command of ["resolve", "validate", "add", "apply"]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`, "u"));
  }
});

test("akari word-book --help は akari-tools の word-book CLI へ dispatch する", async () => {
  const calls = [];
  const result = await runWordBookCommand(["--help"], {
    assets: { wordBookScript: "/repo/packages/akari-tools/bin/word-book.mjs" },
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [[process.execPath, ["/repo/packages/akari-tools/bin/word-book.mjs", "--help"], { stdio: "inherit" }]]);
});

test("akari-tools 不在時はインストール方法を示して exit 1", async () => {
  const errors = [];
  const result = await runWordBookCommand(["--help"], {
    assets: { wordBookScript: null },
    logError: (line) => errors.push(line),
    spawn: () => { throw new Error("spawn は呼ばれない"); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join("\n"), /npm install -g akari-video/);
});

test("wordBookScript は own property で、単独でも candidate asset として検出される", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-word-book-assets-"));
  const candidateRoot = path.join(root, "candidate");
  const vendorRoot = path.join(root, "vendor");
  const wordBookScript = path.join(candidateRoot, "packages", "akari-tools", "bin", "word-book.mjs");
  await mkdir(path.dirname(wordBookScript), { recursive: true });
  await mkdir(vendorRoot, { recursive: true });
  await writeFile(wordBookScript, "", "utf8");
  try {
    const repoAssets = resolveRepoAssets(candidateRoot);
    assert.equal(Object.hasOwn(repoAssets, "wordBookScript"), true);
    assert.ok(Object.keys(repoAssets).includes("wordBookScript"));
    assert.equal(JSON.parse(JSON.stringify(repoAssets)).wordBookScript, wordBookScript);
    assert.equal({ ...repoAssets }.wordBookScript, wordBookScript);

    const launcherAssets = resolveLauncherAssets({ candidateRoot, vendorRoot });
    assert.equal(launcherAssets.repoRoot, candidateRoot);
    assert.equal(Object.hasOwn(launcherAssets, "wordBookScript"), true);
    assert.equal(launcherAssets.wordBookScript, wordBookScript);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
