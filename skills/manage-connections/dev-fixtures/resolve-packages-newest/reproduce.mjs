import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scratch = mkdtempSync(path.join(os.tmpdir(), "akari-resolve-packages-newest-"));
const homeDir = path.join(scratch, "home");
const oldApp = path.join(homeDir, ".akari", "app");
const resources = path.join(scratch, "Resources");
const project = path.join(scratch, "project");
const relativeFiles = ["creator-root/src/index.mjs", "media-bin/src/index.mjs"];
const oldFiles = [
  "packages/akari-launcher/package.json",
  ...relativeFiles.map((file) => `packages/${file}`),
];

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}

function display(absolute) {
  return absolute.replace(homeDir, "$HOME").replace(scratch, "$TMP").replaceAll(path.sep, "/");
}

const childSource = `
import { pathToFileURL } from "node:url";
const [resolverFile, installRootFile, from, relative] = process.argv.slice(1);
const resolver = await import(pathToFileURL(resolverFile));
const reference = await import(pathToFileURL(installRootFile));
const options = { from, env: {} };
console.log(JSON.stringify({
  skill: resolver.resolvePackageFile(relative, options),
  reference: reference.resolveNewestPackageFile(relative, options),
}));
`;

try {
  mkdirSync(oldApp, { recursive: true });
  // 旧タグから必要な packages/ のみを archive で取り出す。
  const archive = spawnSync("git", ["archive", "v0.1.40", ...oldFiles], {
    cwd: repo, maxBuffer: 8 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr?.toString()}`);
  checked("tar", ["-xf", "-", "-C", oldApp], { input: archive.stdout });

  for (const file of ["packages/akari-launcher/package.json", ...relativeFiles.map((item) => `packages/${item}`)]) {
    const target = path.join(resources, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repo, file), target);
  }
  const oldVersion = JSON.parse(readFileSync(path.join(oldApp, "packages", "akari-launcher", "package.json"), "utf8")).version;
  const desktopVersion = JSON.parse(readFileSync(path.join(resources, "packages", "akari-launcher", "package.json"), "utf8")).version;
  assert.equal(oldVersion, "0.1.40");

  const shim = path.join(homeDir, ".akari", "cli", "bin", "akari");
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, `exec node "${path.join(resources, "packages", "akari-launcher", "bin", "akari.mjs")}" "$@"\n`);

  const skills = [
    ["manage-connections", "bin/resolve-packages.mjs"],
    ["analyze-footage", "bin/person-matte/resolve-packages.mjs"],
  ];
  for (const [name, file] of skills) {
    const target = path.join(project, ".claude", "skills", name, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repo, "skills", name, file), target);
  }

  console.log(`old launcher: ${oldVersion}; desktop launcher: ${desktopVersion}`);
  for (const [condition, oldPresent] of [["old CLI + desktop", true], ["desktop only", false]]) {
    if (!oldPresent) rmSync(oldApp, { recursive: true, force: true });
    for (const [name, file] of skills) {
      const resolverFile = path.join(project, ".claude", "skills", name, file);
      const from = path.join(path.dirname(resolverFile), "entry.mjs");
      for (const relative of relativeFiles) {
        const output = checked(process.execPath, [
          "--input-type=module", "-e", childSource,
          resolverFile,
          path.join(repo, "skills", "compile-review-session", "bin", "core", "install-root.mjs"),
          from, relative,
        ], {
          env: { ...process.env, HOME: homeDir, AKARI_MONOREPO: "", AKARI_INSTALL_DIR: "" },
        });
        const result = JSON.parse(output);
        assert.equal(result.skill, result.reference);
        console.log(`${condition} | ${name} | ${relative} | selected=${display(result.skill)} | install-root=${display(result.reference)} | match=yes`);
      }
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
