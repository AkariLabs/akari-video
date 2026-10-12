import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { installProjectSkills } from "../src/index.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO_URL_PREFIX = "https://github.com/AkariLabs/akari-video/";

async function markdownFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await markdownFiles(absolute)));
    } else if (entry.name.endsWith(".md")) {
      found.push(absolute);
    }
  }
  return found;
}

function linkTargets(markdown) {
  // コードフェンス内は例示なので対象外にする。
  const text = markdown.replace(/```[\s\S]*?```/g, "");
  return [...text.matchAll(/\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g)].map((match) => match[1]);
}

// プロジェクトには .claude/skills/ しか入らず、リポの docs/・packages/ は無い。
// スキル本文の相対リンクは .claude/skills/ の中で解決でき、リポ側の資料への参照は
// 公開リポの絶対 URL（実在するパス）でなければならない。
test("配布されるスキルの Markdown リンクは、プロジェクト内で解決できる", async () => {
  const project = await mkdtemp(join(tmpdir(), "akari-skill-links-"));
  try {
    await installProjectSkills(project, join(REPO_ROOT, "skills"));
    const skillsDir = join(project, ".claude", "skills");
    const unresolved = [];
    for (const file of await markdownFiles(skillsDir)) {
      for (const target of linkTargets(await readFile(file, "utf8"))) {
        if (target.startsWith(REPO_URL_PREFIX)) {
          const repoPath = target.slice(REPO_URL_PREFIX.length).replace(/^(blob|tree)\/main\//, "");
          if (!existsSync(join(REPO_ROOT, repoPath))) {
            unresolved.push(`${relative(skillsDir, file)} -> ${target}（リポに存在しない）`);
          }
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
          // 外部 URL は対象外
        } else if (!existsSync(resolve(dirname(file), target))) {
          unresolved.push(`${relative(skillsDir, file)} -> ${target}`);
        }
      }
    }
    assert.deepEqual(unresolved, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
