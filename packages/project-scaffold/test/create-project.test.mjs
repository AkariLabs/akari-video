import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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
    assert.equal(intake.title, null);

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
    const editJson = JSON.parse(await readFile(join(destination, "edit.json"), "utf8"));
    assert.equal(editJson.version, 2);
    assert.deepEqual(editJson.output, { width: 1920, height: 1080, fps: 30 });
    assert.deepEqual(editJson.sources, []);
    assert.deepEqual(editJson.tracks, []);
    assert.ok(report.fallback.writtenFiles.includes("edit.json"));
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
    const editJson = JSON.parse(await readFile(join(destination, "edit.json"), "utf8"));
    assert.equal(editJson.version, 2);
    assert.deepEqual(editJson.output, { width: 1920, height: 1080, fps: 30 });
    assert.deepEqual(editJson.sources, []);
    assert.deepEqual(editJson.tracks, []);
    assert.ok(report.fallback.writtenFiles.includes("edit.json"));

    const claudeMd = await readFile(join(destination, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /intake\.json/);
    assert.match(claudeMd, /checkpoint/);

    const agentsMd = await readFile(join(destination, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /intake\.json/);
  });
});

test("existing edit.json is preserved when applying the scaffold to an existing project", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(root, "empty-template");
    const destination = join(root, "project");
    const existingEdit = '{"version":1,"custom":true}\n';
    await mkdir(templateDir, { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "edit.json"), existingEdit, "utf8");

    const report = await createProject(destination, templateDir);

    assert.equal(await readFile(join(destination, "edit.json"), "utf8"), existingEdit);
    assert.ok(report.fallback.skippedExisting.includes("edit.json"));
    assert.ok(!report.fallback.writtenFiles.includes("edit.json"));
  });
});

test("git が利用できなくてもプロジェクト作成を完了し、レポートへスキップ理由を記録する", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(root, "empty-template");
    const destination = join(root, "project");
    const fakeBin = join(root, "bin");
    const fakeGit = join(fakeBin, "git");
    await mkdir(templateDir, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(fakeGit, [
      "#!/bin/sh",
      "echo 'xcode-select: note: No developer tools were found, requesting install.' >&2",
      "exit 1",
      ""
    ].join("\n"), "utf8");
    await chmod(fakeGit, 0o755);

    const originalPath = process.env.PATH;
    process.env.PATH = originalPath ? `${fakeBin}${delimiter}${originalPath}` : fakeBin;
    try {
      const report = await createProject(destination, templateDir);

      assert.ok((await stat(join(destination, "edit.json"))).isFile());
      assert.ok((await stat(join(destination, ".akari"))).isDirectory());
      assert.ok((await stat(join(destination, "CLAUDE.md"))).isFile());
      assert.equal(report.git.action, "skipped");
      assert.match(report.git.reason, /git が利用できないためスキップ/);
      assert.match(report.git.reason, /xcode-select: note: No developer tools were found/);

      const reportHtml = await readFile(
        join(destination, ".akari", "reports", "create-project-report.html"),
        "utf8"
      );
      assert.match(reportHtml, /git が利用できないためスキップ/);
      assert.match(reportHtml, /xcode-select: note: No developer tools were found/);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});

test("installProjectSkills 経由の createProject(): dev-fixtures/ ディレクトリはスキルコピーから除外される（F10 元栓）", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(root, "empty-template");
    const destination = join(root, "project");
    await mkdir(templateDir, { recursive: true });

    // 実スキル同梱の開発用フィクスチャ（例: skills/address-review/dev-fixtures/fixture-project/
    // edit.json）を模した合成 skillsSourceDir。SKILL.md 等の本体ファイルは従来どおりコピーされ、
    // dev-fixtures/ ディレクトリだけが除外されることを確認する。
    const skillsSourceDir = join(root, "skills-source");
    const skillDir = join(skillsSourceDir, "address-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# address-review\n", "utf8");
    const fixtureDir = join(skillDir, "dev-fixtures", "fixture-project");
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, "edit.json"), "{}\n", "utf8");
    await writeFile(join(fixtureDir, "source.mp4"), "", "utf8");

    await createProject(destination, templateDir, { skillsSourceDir });

    const installedSkillDir = join(destination, ".claude", "skills", "address-review");
    assert.ok((await stat(join(installedSkillDir, "SKILL.md"))).isFile());

    await assert.rejects(
      () => stat(join(installedSkillDir, "dev-fixtures")),
      (error) => error.code === "ENOENT"
    );
  });
});
