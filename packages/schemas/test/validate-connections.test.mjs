import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const cliPath = join(packageRoot, "bin", "validate-connections.mjs");
const exampleRoot = join(packageRoot, "examples");

function run(targetPath) {
  return spawnSync(process.execPath, [cliPath, targetPath], { encoding: "utf8" });
}

test("templates/project-default/.akari/connections.json passes (voicevox auth:none / doctor.status enum sync)", () => {
  const target = join(repoRoot, "templates", "project-default", ".akari", "connections.json");
  const executed = run(target);
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("unknown auth value is still rejected (non-regression)", () => {
  const target = join(exampleRoot, "connections-v0-invalid-auth", "connections.json");
  const executed = run(target);
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(
    executed.stderr,
    /providers\[0\]\.auth は login \/ env-key \/ oauth-mcp \/ none のいずれかである必要があります/,
  );
});
