import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importPackage, resolvePackageFile } from "../resolve-packages.mjs";

async function withScratch(run) {
  const scratch = await mkdtemp(path.join(tmpdir(), "akari-resolve-packages-"));
  try {
    await run(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function addPackageFile(root, relative, source = "export const marker = 'ok';\n") {
  const file = path.join(root, "packages", relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source, "utf8");
  return file;
}

test("resolvePackageFile は呼び出し元から上方探索する", async () => {
  await withScratch(async (scratch) => {
    const expected = await addPackageFile(scratch, "sample/src/index.mjs");
    const from = pathToFileURL(path.join(scratch, "skills", "sample", "bin", "entry.mjs")).href;
    assert.equal(
      resolvePackageFile("sample/src/index.mjs", { from, env: {} }),
      expected,
    );
  });
});

test("resolvePackageFile は AKARI_MONOREPO を使う", async () => {
  await withScratch(async (scratch) => {
    const root = path.join(scratch, "monorepo-root");
    const expected = await addPackageFile(root, "sample/src/index.mjs");
    assert.equal(
      resolvePackageFile("sample/src/index.mjs", {
        from: path.join(scratch, "project", ".claude", "skills", "sample", "bin", "entry.mjs"),
        env: { AKARI_MONOREPO: root, AKARI_INSTALL_DIR: path.join(scratch, "unused") },
      }),
      expected,
    );
  });
});

test("resolvePackageFile は AKARI_INSTALL_DIR を使う", async () => {
  await withScratch(async (scratch) => {
    const root = path.join(scratch, "installed-app");
    const expected = await addPackageFile(root, "sample/src/index.mjs");
    assert.equal(
      resolvePackageFile("sample/src/index.mjs", {
        from: path.join(scratch, "project", ".claude", "skills", "sample", "bin", "entry.mjs"),
        env: { AKARI_INSTALL_DIR: root },
      }),
      expected,
    );
  });
});

test("見つからない場合は専門語のないセットアップ案内 1 行で失敗する", async () => {
  await withScratch(async (scratch) => {
    assert.throws(
      () => resolvePackageFile("missing/src/index.mjs", {
        from: path.join(scratch, "project", "entry.mjs"),
        env: { AKARI_INSTALL_DIR: path.join(scratch, "unused") },
      }),
      (error) => {
        assert.equal(
          error.message,
          "セットアップするには次を実行してください: curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash",
        );
        assert.equal(error.message.split(/\r?\n/u).length, 1);
        assert.doesNotMatch(error.message, /ERR_MODULE_NOT_FOUND|monorepo|import/iu);
        return true;
      },
    );
  });
});

test("importPackage は絶対パスを file URL にして読み込む", async () => {
  await withScratch(async (scratch) => {
    const root = path.join(scratch, "root with spaces");
    await addPackageFile(root, "sample/src/index.mjs", "export const marker = 'loaded';\n");
    const loaded = await importPackage("sample/src/index.mjs", {
      from: path.join(scratch, "outside", "entry.mjs"),
      env: { AKARI_MONOREPO: root, AKARI_INSTALL_DIR: path.join(scratch, "unused") },
    });
    assert.equal(loaded.marker, "loaded");
  });
});

test("3 スキルの resolve-packages.mjs は同一内容", async () => {
  const current = fileURLToPath(new URL("../resolve-packages.mjs", import.meta.url));
  const root = path.resolve(path.dirname(current), "..", "..");
  const copies = [
    path.join(root, "setup-chat-approval", "bin", "resolve-packages.mjs"),
    path.join(root, "analyze-footage", "bin", "person-matte", "resolve-packages.mjs"),
  ];
  const expected = await readFile(current, "utf8");
  for (const copy of copies) assert.equal(await readFile(copy, "utf8"), expected);
});
