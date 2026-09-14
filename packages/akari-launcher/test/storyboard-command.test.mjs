import assert from "node:assert/strict";
import test from "node:test";

import { runStoryboardCommand } from "../src/storyboard-command.mjs";

test("akari storyboard --help は launcher 側で使い方を表示して spawn せず exit 0", async () => {
  const lines = [];
  const result = await runStoryboardCommand(["--help"], {
    log: (line) => lines.push(line),
    spawn: () => { throw new Error("spawn は呼ばれない"); },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(lines[0], "使い方: akari storyboard <projectDir> [--no-capture] [--captures <dir>] [--out <dir>]");
});

test("storyboardScript が未同梱なら日本語エラーを表示して exit 2", async () => {
  const errors = [];
  const result = await runStoryboardCommand(["project"], {
    assets: {},
    logError: (line) => errors.push(line),
    spawn: () => { throw new Error("spawn は呼ばれない"); },
  });
  assert.equal(result.exitCode, 2);
  assert.match(errors.join("\n"), /実行スクリプトが見つかりません/);
});

test("storyboard の引数を印刷スクリプトへそのまま透過する", async () => {
  const calls = [];
  const script = "/repo/packages/decision-cards/render-storyboard-print.mjs";
  const args = ["project", "--no-capture", "--captures", "captures", "--out", "reports"];
  const result = await runStoryboardCommand(args, {
    assets: { storyboardScript: script },
    spawn: (...spawnArgs) => {
      calls.push(spawnArgs);
      return { status: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [[process.execPath, [script, ...args], { stdio: "inherit" }]]);
});
