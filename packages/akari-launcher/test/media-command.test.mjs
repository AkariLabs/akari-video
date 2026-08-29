import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runMediaCommand } from "../src/media-command.mjs";
import { resolveLauncherAssets, resolveRepoAssets } from "../src/repo-assets.mjs";

test("akari media --help は akari-tools の media CLI へ dispatch する", async () => {
  const calls = [];
  const result = await runMediaCommand(["--help"], {
    assets: { mediaScript: "/repo/packages/akari-tools/bin/media.mjs" },
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [[process.execPath, ["/repo/packages/akari-tools/bin/media.mjs", "--help"], { stdio: "inherit" }]]);
});

test("akari-tools 不在時はインストール方法を示して exit 1", async () => {
  const errors = [];
  const result = await runMediaCommand(["--help"], {
    assets: { mediaScript: null },
    logError: (line) => errors.push(line),
    spawn: () => { throw new Error("spawn は呼ばれない"); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(errors.join("\n"), /npm install -g akari-video/);
});

test("mediaScript は own property で、単独でも candidate asset として検出される", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akari-media-assets-"));
  const candidateRoot = path.join(root, "candidate");
  const vendorRoot = path.join(root, "vendor");
  const mediaScript = path.join(candidateRoot, "packages", "akari-tools", "bin", "media.mjs");
  await mkdir(path.dirname(mediaScript), { recursive: true });
  await mkdir(vendorRoot, { recursive: true });
  await writeFile(mediaScript, "", "utf8");
  try {
    const repoAssets = resolveRepoAssets(candidateRoot);
    assert.equal(Object.hasOwn(repoAssets, "mediaScript"), true);
    assert.ok(Object.keys(repoAssets).includes("mediaScript"));
    assert.equal(JSON.parse(JSON.stringify(repoAssets)).mediaScript, mediaScript);
    assert.equal({ ...repoAssets }.mediaScript, mediaScript);

    const launcherAssets = resolveLauncherAssets({ candidateRoot, vendorRoot });
    assert.equal(launcherAssets.repoRoot, candidateRoot);
    assert.equal(Object.hasOwn(launcherAssets, "mediaScript"), true);
    assert.equal(launcherAssets.mediaScript, mediaScript);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
