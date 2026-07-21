import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createProject } from "../src/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
const validateIntakeCli = join(repoRoot, "packages", "schemas", "bin", "validate-intake.mjs");

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-scaffold-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function validateIntake(intakePath) {
  return spawnSync(process.execPath, [validateIntakeCli, intakePath], { encoding: "utf8" });
}

test("bare template: scaffold generates a draft .akari/intake.json and a CLAUDE.md carrying the intake discipline note", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(root, "empty-template");
    const destination = join(root, "project");
    await mkdir(templateDir, { recursive: true });

    const report = await createProject(destination, templateDir);

    const intakePath = join(destination, ".akari", "intake.json");
    const intake = JSON.parse(await readFile(intakePath, "utf8"));
    assert.equal(intake.version, 1);
    assert.deepEqual(intake.tasks, []);
    assert.equal(intake.status, "draft");
    assert.equal(intake.submitted_at, null);
    assert.equal(intake.autonomy, "checkpoint");

    const validated = validateIntake(intakePath);
    assert.equal(validated.status, 0, validated.stderr);
    assert.match(validated.stdout, /^OK: /);

    const claudeMd = await readFile(join(destination, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /intake\.json/);
    assert.match(claudeMd, /submitted/);
    assert.match(claudeMd, /draft/);
    assert.match(claudeMd, /checkpoint/);

    assert.ok(report.fallback.writtenFiles.includes(".akari/intake.json"));
    assert.ok(report.fallback.writtenFiles.includes("CLAUDE.md"));
  });
});

test("real templates/project-default/: .akari/intake.json is generated via the fallback path (template does not ship one yet) and validates", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(repoRoot, "templates", "project-default");
    const destination = join(root, "project");

    const report = await createProject(destination, templateDir);

    const intakePath = join(destination, ".akari", "intake.json");
    assert.ok((await stat(intakePath)).isFile());

    const validated = validateIntake(intakePath);
    assert.equal(validated.status, 0, validated.stderr);

    assert.ok(report.fallback.writtenFiles.includes(".akari/intake.json"));

    const claudeMd = await readFile(join(destination, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /intake\.json/);
    assert.match(claudeMd, /checkpoint/);

    const agentsMd = await readFile(join(destination, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /intake\.json/);
  });
});
