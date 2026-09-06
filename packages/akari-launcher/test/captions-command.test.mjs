import assert from "node:assert/strict";
import test from "node:test";
import { runCaptionsCommand } from "../src/captions-command.mjs";

test("captions delegates the original argv and cwd to the packaged script", async () => {
  const calls = [];
  const argv = ["project with spaces", "--source", "s1", "--readout", "0.4", "--dry-run", "--json"];
  const result = await runCaptionsCommand(argv, {
    assets: { captionsScript: process.execPath }, cwd: "/tmp",
    spawn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{ command: process.execPath, args: [process.execPath, ...argv], options: { stdio: "inherit", cwd: "/tmp" } }]);
});

test("captions reports missing scripts without spawning", async () => {
  for (const captionsScript of [null, "/missing/captions.mjs"]) {
    const errors = [];
    const result = await runCaptionsCommand([], { assets: { captionsScript }, error: (line) => errors.push(line), spawn: () => assert.fail("must not spawn") });
    assert.equal(result.exitCode, 1);
    assert.equal(errors.length, 1);
  }
});

test("captions propagates child exit codes and spawn failure", async () => {
  for (const status of [2, null]) {
    const result = await runCaptionsCommand([], { assets: { captionsScript: process.execPath }, spawn: () => ({ status }) });
    assert.equal(result.exitCode, status ?? 1);
  }
});
