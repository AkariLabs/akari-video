import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { run } from "../src/cli.mjs";
import { runCaptureCommand } from "../src/capture-command.mjs";
import { resolveRepoAssets } from "../src/repo-assets.mjs";

async function withScript(callback) {
  const root = await mkdtemp(join(tmpdir(), "capture-launcher-"));
  try {
    const script = join(root, "capture.mjs");
    await writeFile(script, "", "utf8");
    await callback({ root, script });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("akari capture forwards arguments to the bundled akari-tools child", async () => {
  await withScript(async ({ root, script }) => {
    const calls = [];
    const result = await runCaptureCommand(["-t", "0", "4.5"], {
      assets: { repoRoot: root, captureScript: script },
      findChromePath: async () => "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      describeChromeNotFound: async () => "missing Chrome",
      spawn: (...args) => { calls.push(args); return { status: 0 }; },
      cwd: "/project",
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls[0], [
      process.execPath,
      [script, "-t", "0", "4.5"],
      { stdio: "inherit", cwd: "/project" },
    ]);
  });
});

test("akari capture --help does not require Chrome", async () => {
  await withScript(async ({ root, script }) => {
    let chromeChecked = false;
    const result = await runCaptureCommand(["--help"], {
      assets: { repoRoot: root, captureScript: script },
      findChromePath: async () => { chromeChecked = true; return null; },
      describeChromeNotFound: async () => "missing Chrome",
      spawn: () => ({ status: 0 }),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(chromeChecked, false);
  });
});

test("launcher reports missing akari-tools and reuses render-cut Chrome guidance", async () => {
  const errors = [];
  const missingTool = await runCaptureCommand(["-t", "0"], {
    assets: { repoRoot: "/missing", captureScript: null },
    error: (line) => errors.push(line),
  });
  assert.equal(missingTool.exitCode, 1);
  assert.match(errors.at(-1), /実行スクリプトが見つかりません/u);

  await withScript(async ({ root, script }) => {
    const result = await runCaptureCommand(["-t", "0", "--engine", "legacy"], {
      assets: { repoRoot: root, captureScript: script },
      findChromePath: async () => null,
      describeChromeNotFound: async () => "render-cut Chrome guidance",
      error: (line) => errors.push(line),
      spawn: () => { throw new Error("must not spawn"); },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(errors.at(-1), "render-cut Chrome guidance");
  });
});

test("v2 capture engines do not require a separately installed Chrome", async () => {
  await withScript(async ({ root, script }) => {
    for (const args of [["-t", "0", "--engine", "osr"], ["-t", "0", "--engine=gpu"], ["-t", "0"]]) {
      let chromeChecked = false;
      const result = await runCaptureCommand(args, {
        assets: { repoRoot: root, captureScript: script },
        platform: "darwin",
        findChromePath: async () => { chromeChecked = true; return null; },
        describeChromeNotFound: async () => "missing Chrome",
        spawn: () => ({ status: 0 }),
      });
      assert.equal(result.exitCode, 0);
      assert.equal(chromeChecked, false);
    }
  });
});

test("cli capture branch runs before project setup and Claude launch", async () => {
  await withScript(async ({ root, script }) => {
    let claudeResolved = false;
    const result = await run(["capture", "--help"], {
      assets: { repoRoot: root, captureScript: script },
      spawn: () => ({ status: 0 }),
      resolveClaude: () => { claudeResolved = true; return "/fake/claude"; },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(claudeResolved, false);
  });
});

test("repo assets resolves the capture script from the checkout", () => {
  const assets = resolveRepoAssets();
  assert.match(assets.captureScript, /packages\/akari-tools\/bin\/capture\.mjs$/u);
});
