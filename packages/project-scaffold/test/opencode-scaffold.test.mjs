import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createProject } from "../src/index.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), "akari-scaffold-opencode-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("opencode 対応: .opencode/config.json が生成される", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(repoRoot, "templates", "project-default");
    const destination = join(root, "project");

    const report = await createProject(destination, templateDir);

    const configPath = join(destination, ".opencode", "config.json");
    assert.ok((await stat(configPath)).isFile());

    const config = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(config.name, "AKARI Video Project");
    assert.equal(config.project.type, "akari-video");
    assert.ok(config.skills.autoDiscover);
    assert.equal(config.skills.path, "./skills");
    assert.equal(config.hooks.sessionStart, "./hooks/session-start.mjs");
  });
});

test("opencode 対応: .opencode/skills/ にスキル定義ファイルが生成される", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(repoRoot, "templates", "project-default");
    const destination = join(root, "project");

    await createProject(destination, templateDir);

    const skillsDir = join(destination, ".opencode", "skills");
    assert.ok((await stat(skillsDir)).isDirectory());

    // スキル定義ファイルが存在することを確認
    const analyzeFootage = join(skillsDir, "analyze-footage.yml");
    const editPlan = join(skillsDir, "edit-plan.yml");
    const createProjectSkill = join(skillsDir, "create-project.yml");

    assert.ok((await stat(analyzeFootage)).isFile());
    assert.ok((await stat(editPlan)).isFile());
    assert.ok((await stat(createProjectSkill)).isFile());
  });
});

test("opencode 対応: .opencode/hooks/session-start.mjs が生成される", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(repoRoot, "templates", "project-default");
    const destination = join(root, "project");

    await createProject(destination, templateDir);

    const hookPath = join(destination, ".opencode", "hooks", "session-start.mjs");
    assert.ok((await stat(hookPath)).isFile());

    const hookContent = await readFile(hookPath, "utf8");
    assert.ok(hookContent.includes("SessionStart"));
    assert.ok(hookContent.includes(".akari"));
  });
});

test("opencode 対応: .opencode/skills/ にアダプタリンクが作成される", async () => {
  await withScratchRoot(async (root) => {
    const templateDir = join(repoRoot, "templates", "project-default");
    const destination = join(root, "project");
    const skillsSourceDir = join(repoRoot, "skills");

    await createProject(destination, templateDir, { skillsSourceDir });

    // .opencode/skills/ にスキルディレクトリが存在することを確認
    const opencodeSkillsDir = join(destination, ".opencode", "skills");
    assert.ok((await stat(opencodeSkillsDir)).isDirectory());

    // スキルディレクトリに至少 1 つのスキルがあることを確認
    const entries = await import("node:fs/promises").then(fs => fs.readdir(opencodeSkillsDir));
    assert.ok(entries.length > 0, ".opencode/skills/ にスキルが至少 1 つ存在すること");
  });
});