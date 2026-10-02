import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultSourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

function checkedSource(editLintSource, source) {
  if (source.length === 0) throw new Error("edit-lint source is empty");
  if (source.length < editLintSource.length) {
    throw new Error("concatenated edit-lint source is shorter than edit-lint.mjs");
  }
  return source;
}

export function readLintSourceSync(sourceRoot = defaultSourceRoot) {
  const editLintSource = readFileSync(join(sourceRoot, "edit-lint.mjs"), "utf8");
  const lintRoot = join(sourceRoot, "lint");
  const lintFiles = existsSync(lintRoot)
    ? readdirSync(lintRoot, { recursive: true }).filter(path => path.endsWith(".mjs")).sort()
    : [];
  const source = [editLintSource, ...lintFiles.map(path => readFileSync(join(lintRoot, path), "utf8"))]
    .join("\n");
  return checkedSource(editLintSource, source);
}

export async function readLintSource(sourceRoot = defaultSourceRoot) {
  const editLintSource = await readFile(join(sourceRoot, "edit-lint.mjs"), "utf8");
  const lintRoot = join(sourceRoot, "lint");
  const lintFiles = existsSync(lintRoot)
    ? (await readdir(lintRoot, { recursive: true })).filter(path => path.endsWith(".mjs")).sort()
    : [];
  const source = [editLintSource, ...await Promise.all(
    lintFiles.map(path => readFile(join(lintRoot, path), "utf8")),
  )].join("\n");
  return checkedSource(editLintSource, source);
}
