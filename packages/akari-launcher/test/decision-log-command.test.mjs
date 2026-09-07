import assert from "node:assert/strict";
import test from "node:test";
import { runDecisionLogCommand } from "../src/decision-log-command.mjs";

test("decision-log delegates the original argv and cwd to the packaged script", async () => {
  const calls = [];
  const argv = ["settle", "project with spaces", "--actor", "machine:test", "--dry-run", "--json"];
  const result = await runDecisionLogCommand(argv, {
    assets: { decisionLogScript: process.execPath }, cwd: "/tmp",
    spawn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{ command: process.execPath, args: [process.execPath, ...argv], options: { stdio: "inherit", cwd: "/tmp" } }]);
});

test("decision-log reports missing scripts without spawning", async () => {
  for (const decisionLogScript of [null, "/missing/decision-log.mjs"]) {
    const errors = [];
    const result = await runDecisionLogCommand([], { assets: { decisionLogScript }, error: (line) => errors.push(line), spawn: () => assert.fail("must not spawn") });
    assert.equal(result.exitCode, 1);
    assert.equal(errors.length, 1);
  }
});

test("decision-log propagates child exit codes and spawn failure", async () => {
  for (const status of [2, null]) {
    const result = await runDecisionLogCommand([], { assets: { decisionLogScript: process.execPath }, spawn: () => ({ status }) });
    assert.equal(result.exitCode, status ?? 1);
  }
});
