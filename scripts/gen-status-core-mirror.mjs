#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = join(REPO_ROOT, "packages", "akari-launcher", "src", "status-core");
const MIRROR_ROOT = join(REPO_ROOT, "plugin", "runtime", "status-core");
const ASSET_GROUPS = [
  {
    label: "LUT",
    sourceRoot: join(REPO_ROOT, "presets", "luts"),
    mirrorRoot: join(REPO_ROOT, "plugin", "runtime", "presets", "luts"),
    include: path => path.endsWith(".cube"),
  },
  {
    label: "caption font",
    sourceRoot: join(REPO_ROOT, "assets", "font", "noto-sans-jp"),
    mirrorRoot: join(REPO_ROOT, "plugin", "runtime", "assets", "font", "noto-sans-jp"),
    include: path => path.endsWith("NotoSansJP-Variable.ttf"),
  },
];
const check = process.argv.includes("--check");

const sourceFiles = await listFiles(SOURCE_ROOT);
const assetGroups = await Promise.all(ASSET_GROUPS.map(async group => ({
  ...group,
  files: (await listFiles(group.sourceRoot)).filter(group.include),
})));
if (sourceFiles.length === 0) throw new Error("canonical status-core has no files");
if (sourceFiles.some((path) => !path.endsWith(".mjs"))) {
  throw new Error("canonical status-core may contain only .mjs source files");
}

if (check) {
  const mirrorFiles = await listFiles(MIRROR_ROOT).catch(() => []);
  const sourceNames = sourceFiles.map((path) => relative(SOURCE_ROOT, path));
  const mirrorNames = mirrorFiles.map((path) => relative(MIRROR_ROOT, path));
  if (JSON.stringify(sourceNames) !== JSON.stringify(mirrorNames)) {
    throw new Error(`status-core mirror file list differs: source=${sourceNames.join(",")} mirror=${mirrorNames.join(",")}`);
  }
  for (const name of sourceNames) {
    const [sourceHash, mirrorHash] = await Promise.all([
      hashFile(join(SOURCE_ROOT, name)),
      hashFile(join(MIRROR_ROOT, name)),
    ]);
    if (sourceHash !== mirrorHash) throw new Error(`status-core mirror SHA differs: ${name}`);
  }
  for (const group of assetGroups) {
    const assetNames = group.files.map((path) => relative(group.sourceRoot, path));
    const mirroredAssetNames = (await listFiles(group.mirrorRoot).catch(() => []))
      .map((path) => relative(group.mirrorRoot, path));
    if (JSON.stringify(assetNames) !== JSON.stringify(mirroredAssetNames)) {
      throw new Error(`plugin runtime ${group.label} file list differs: source=${assetNames.join(",")} mirror=${mirroredAssetNames.join(",")}`);
    }
    for (const name of assetNames) {
      if (await hashFile(join(group.sourceRoot, name)) !== await hashFile(join(group.mirrorRoot, name))) {
        throw new Error(`plugin runtime ${group.label} SHA differs: ${name}`);
      }
    }
  }
  const assetCount = assetGroups.reduce((total, group) => total + group.files.length, 0);
  process.stdout.write(`status-core mirror OK (${sourceNames.length} core + ${assetCount} runtime asset files, byte-identical)\n`);
} else {
  await rm(MIRROR_ROOT, { recursive: true, force: true });
  for (const sourcePath of sourceFiles) {
    const name = relative(SOURCE_ROOT, sourcePath);
    const destination = join(MIRROR_ROOT, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }
  for (const group of assetGroups) {
    await rm(group.mirrorRoot, { recursive: true, force: true });
    for (const sourcePath of group.files) {
      const name = relative(group.sourceRoot, sourcePath);
      const destination = join(group.mirrorRoot, name);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination);
    }
  }
  const assetCount = assetGroups.reduce((total, group) => total + group.files.length, 0);
  process.stdout.write(`generated ${sourceFiles.length} status-core mirror files and ${assetCount} runtime asset files\n`);
}

async function listFiles(root) {
  const result = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
      else throw new Error(`status-core contains unsupported filesystem entry: ${relative(root, path)}`);
    }
  }
  await visit(root);
  return result;
}

async function hashFile(path) {
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
