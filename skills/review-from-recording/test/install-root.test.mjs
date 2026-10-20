// issue #70 / #72: このスキルはプロジェクトへコピーされるため、同梱物（packages/edit-store の互換射影・
// 同梱 whisper-cli・標準モデル置き場）を「自分の位置からの相対パス」では見つけられない。
// install-root.mjs の候補列挙と、それを使う v2 snapshot 読み込み / whisper 探索を固定する。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  candidateInstallRoots,
  resolvePackageFile,
  resourcesRootsFromShim,
} from "../bin/core/install-root.mjs";
import { findWhisperBinary, findWhisperModel } from "../bin/core/transcription.mjs";

const execFileAsync = promisify(execFile);
const skillRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(skillRoot, "..", "..");
const fixtureProject = path.join(skillRoot, "dev-fixtures", "fixture-project");

async function temporaryDirectory(context, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("shim に焼かれた akari.mjs から Resources ルートを逆算する（posix / Windows）", () => {
  const posix = [
    "#!/bin/sh",
    'exec node "/Applications/AKARI Video.app/Contents/Resources/packages/akari-launcher/bin/akari.mjs" "$@"',
  ].join("\n");
  assert.deepEqual(resourcesRootsFromShim(posix), ["/Applications/AKARI Video.app/Contents/Resources"]);
  const windows = '"C:\\Users\\me\\AppData\\Local\\Programs\\AKARI Video\\resources\\packages\\akari-launcher\\bin\\akari.mjs" %*';
  assert.deepEqual(resourcesRootsFromShim(windows), ["C:\\Users\\me\\AppData\\Local\\Programs\\AKARI Video\\resources"]);
  assert.deepEqual(resourcesRootsFromShim("exec node /nowhere.mjs"), []);
});

test("候補ルートは 上方探索 → env → ~/.akari/app → shim の Resources / vendor の順", async (context) => {
  const home = await temporaryDirectory(context, "install-root-home-");
  const resources = path.join(home, "App", "Resources");
  await fs.mkdir(path.join(home, ".akari", "cli", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".akari", "cli", "bin", "akari"),
    `#!/bin/sh\nexec node "${path.join(resources, "packages", "akari-launcher", "bin", "akari.mjs")}" "$@"\n`,
  );
  const from = path.join(home, "project", ".claude", "skills", "compile-review-session", "bin", "core", "x.mjs");
  const roots = candidateInstallRoots({
    from,
    env: { AKARI_INSTALL_DIR: path.join(home, "cli-install"), AKARI_MONOREPO: path.join(home, "mono") },
    homeDir: home,
  });
  assert.equal(roots[0], path.dirname(from));
  const walkUpEnd = roots.indexOf(path.parse(from).root);
  assert.ok(walkUpEnd > 0, "上方探索がファイルシステムのルートまで届く");
  assert.deepEqual(roots.slice(walkUpEnd + 1), [
    path.join(home, "mono"),
    path.join(home, "cli-install"),
    path.join(home, ".akari", "app"),
    resources,
    path.join(resources, "packages", "akari-launcher", "vendor"),
  ]);
});

test("resolvePackageFile はデスクトップ版 Resources の packages/ を shim 経由で見つける", async (context) => {
  const home = await temporaryDirectory(context, "install-root-shim-");
  const resources = path.join(home, "App", "Resources");
  await fs.mkdir(path.join(resources, "packages", "edit-store", "lib"), { recursive: true });
  await fs.writeFile(path.join(resources, "packages", "edit-store", "lib", "index.js"), "module.exports = {};\n");
  await fs.mkdir(path.join(home, ".akari", "cli", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(home, ".akari", "cli", "bin", "akari.cmd"),
    `@echo off\r\nnode "${path.join(resources, "packages", "akari-launcher", "bin", "akari.mjs")}" %*\r\n`,
  );
  const from = path.join(home, "project", ".claude", "skills", "compile-review-session", "bin", "core", "x.mjs");
  assert.equal(
    resolvePackageFile("edit-store/lib/index.js", { from, env: {}, homeDir: home }),
    path.join(resources, "packages", "edit-store", "lib", "index.js"),
  );
  assert.equal(resolvePackageFile("edit-store/lib/missing.js", { from, env: {}, homeDir: home }), null);
});

test("whisper-cli は ~/.akari/tools/bin と <Resources>/media-bin を探索し、未検出時は探索先を返す", async (context) => {
  const home = await temporaryDirectory(context, "install-root-whisper-");
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const resources = path.join(home, "App", "Resources");
  const roots = [path.join(home, "project"), resources];
  const missing = findWhisperBinary(path.join(home, "project"), { env: { PATH: "" }, homeDir: home, roots });
  assert.equal(missing.binary, null);
  assert.ok(missing.searched.includes(path.join(home, ".akari", "tools", "bin", exe)));
  assert.ok(missing.searched.includes(path.join(resources, "media-bin", exe)));
  assert.ok(missing.searched.includes("PATH"));

  await fs.mkdir(path.join(resources, "media-bin"), { recursive: true });
  await fs.writeFile(path.join(resources, "media-bin", exe), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const bundled = findWhisperBinary(path.join(home, "project"), { env: { PATH: "" }, homeDir: home, roots });
  assert.equal(bundled.binary, path.join(resources, "media-bin", exe));

  await fs.mkdir(path.join(home, ".akari", "tools", "bin"), { recursive: true });
  await fs.writeFile(path.join(home, ".akari", "tools", "bin", exe), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const explicit = findWhisperBinary(path.join(home, "project"), {
    env: { PATH: "", WHISPER_CPP_BIN: path.join(home, ".akari", "tools", "bin", exe) },
    homeDir: home,
    roots,
  });
  assert.equal(explicit.binary, path.join(home, ".akari", "tools", "bin", exe), "明示指定が最優先");
});

test("モデルは ~/.akari/tools/models を最初に探索し、英語専用モデルは除外する", async (context) => {
  const home = await temporaryDirectory(context, "install-root-model-");
  const models = path.join(home, ".akari", "tools", "models");
  await fs.mkdir(models, { recursive: true });
  await fs.writeFile(path.join(models, "ggml-base.en.bin"), "x");
  const none = await findWhisperModel(path.join(home, "project"), { env: { PATH: "" }, homeDir: home });
  assert.equal(none.model, null);
  assert.equal(none.searched[0], models, "探索先の先頭は ~/.akari/tools/models");

  await fs.writeFile(path.join(models, "ggml-large-v3-turbo-q5_0.bin"), "x");
  const found = await findWhisperModel(path.join(home, "project"), { env: { PATH: "" }, homeDir: home });
  assert.equal(found.model, path.join(models, "ggml-large-v3-turbo-q5_0.bin"));
});

// プロジェクトへコピーされたスキルからの実行（issue #70 の再現形）。~/.akari/app や shim が無い
// 環境では候補を列挙して失敗し、AKARI_INSTALL_DIR を与えれば v2 snapshot を読める。
test("プロジェクト内コピーからの v2 compile は AKARI_INSTALL_DIR 経由で edit-store を解決する", async (context) => {
  const home = await temporaryDirectory(context, "install-root-copy-home-");
  const project = path.join(home, "project");
  const skillCopy = path.join(project, ".claude", "skills", "compile-review-session");
  await fs.cp(skillRoot, skillCopy, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}dev-fixtures`) && !source.includes(`${path.sep}test`),
  });
  await fs.cp(fixtureProject, project, { recursive: true });
  // STT に依存しないよう transcript を固定する（HOME を差し替えるためモデル探索も当たらない）。
  await fs.writeFile(path.join(project, "review", "sessions", "s-0010", "transcript.json"), JSON.stringify({
    version: 1,
    backend: "fixture",
    segments: [{ start: 2, end: 3, text: "このカットを削除してください", words: [{ start: 2, end: 3, text: "このカットを削除してください" }] }],
  }));
  const cli = path.join(skillCopy, "bin", "compile-review-session.mjs");
  const runCli = async (env) => {
    try {
      return JSON.parse((await execFileAsync(process.execPath, [cli, project, "--session", "s-0010", "--prepare-only", "--json"], { env })).stdout);
    } catch (error) {
      // 失敗セッションがあると exit 1 になるが、--json の本文はそのまま stdout にある。
      if (typeof error?.stdout !== "string" || !error.stdout.trim()) throw error;
      return JSON.parse(error.stdout);
    }
  };
  const baseEnv = { ...process.env, HOME: home, USERPROFILE: home, AKARI_INSTALL_DIR: "", AKARI_MONOREPO: "" };
  delete baseEnv.AKARI_INSTALL_DIR;
  delete baseEnv.AKARI_MONOREPO;

  const failed = await runCli(baseEnv);
  assert.equal(failed.results[0].status, "failed");
  assert.match(failed.results[0].reason, /packages\/edit-store\/lib\/index\.js が見つかりません/);
  assert.match(failed.results[0].reason, /AKARI_INSTALL_DIR/);

  const prepared = await runCli({ ...baseEnv, AKARI_INSTALL_DIR: repoRoot });
  assert.equal(prepared.results[0].status, "prepared", JSON.stringify(prepared.results[0]));
  assert.equal(prepared.results[0].utterances, 1);
  const proposals = JSON.parse(await fs.readFile(path.join(project, "review", "sessions", "s-0010", "compile-proposals.json"), "utf8"));
  assert.equal(proposals.proposals[0].reference.sourceT, 105, "v2 snapshot の cut 写像（cut-2: in 100 + 5 秒）");
});
