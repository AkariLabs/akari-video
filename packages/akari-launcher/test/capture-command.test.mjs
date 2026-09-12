import assert from "node:assert/strict";
import test from "node:test";

import { runCaptureCommand } from "../src/capture-command.mjs";

test("capture delegates directly to the v2 capture script", async () => {
  const calls = [];
  const result = await runCaptureCommand(["--auto", "--engine", "osr"], {
    assets: { captureScript: process.execPath },
    spawn: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls[0].args.slice(-3), ["--auto", "--engine", "osr"]);
});

test("capture reports a missing packaged script", async () => {
  const errors = [];
  const result = await runCaptureCommand([], {
    assets: { captureScript: null, repoRoot: "/opt/akari/resources" },
    error: (line) => errors.push(line),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(errors.length, 1);
  // issue #74: 再インストール案内ではなく、欠けている同梱物と探索先を名指しする。
  assert.match(errors[0], /packages\/akari-tools\/bin\/capture\.mjs/);
  assert.match(errors[0], /探索先: \/opt\/akari\/resources/);
  assert.doesNotMatch(errors[0], /再インストール/);
});
