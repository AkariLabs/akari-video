import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bin = fileURLToPath(new URL("../bin/decision-log.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("dry-run does not write; real CLI appends and returns one JSON line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "decision-log-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "decision-log.md");
  const original = "| date | proposal | a | 追加 | 理由 | machine:director | source-01 |\n";
  await writeFile(path, original);
  const dry = run("settle", root, "--dry-run", "--json");
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(dry.stdout), { settled: 1, results: [{ subject: "a", result: "消えた" }], path });
  assert.equal(await readFile(path, "utf8"), original);
  const actual = run("settle", root, "--actor", "machine:test");
  assert.equal(actual.status, 0, actual.stderr);
  assert.deepEqual(JSON.parse(actual.stdout), JSON.parse(dry.stdout));
  const after = await readFile(path, "utf8");
  assert.ok(after.startsWith(original));
  assert.match(after, /\| machine:test \| source-01 \|/u);
  assert.equal(JSON.parse(run("settle", root).stdout).settled, 0);
  assert.equal(await readFile(path, "utf8"), after);
});

test("help has the required first line, including via symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "decision-log-help-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const linked = join(root, "linked.mjs");
  await symlink(bin, linked);
  for (const path of [bin, linked]) {
    const result = spawnSync(process.execPath, [path, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split("\n")[0], "使い方: akari decision-log <subcommand> <project-dir> [options]");
  }
});

for (const args of [["unknown", "."], ["settle"], ["settle", ".", "--actor"], ["settle", ".", "--unknown"]]) {
  test(`invalid arguments fail: ${args.join(" ")}`, () => {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.trim());
  });
}
