#!/usr/bin/env node

// 拡張キット manifest schemaVersion 1 と、その参照先を Node.js 組み込み機能だけで検証する。

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimes } from "../../overlay-runtime/runtimes.mjs";

const usage = "使い方: node packages/schemas/bin/validate-kit-manifest.mjs <kit-dir> [--public-skills <dir>] [--json]";
const ownPath = fileURLToPath(import.meta.url);
const ownDir = path.dirname(ownPath);
const parsed = parseArguments(process.argv.slice(2));

if (parsed.help) {
  console.log(usage);
  process.exit(0);
}
if (parsed.error) {
  console.error(usage);
  process.exit(2);
}

const kitDir = path.resolve(parsed.kitDir);
const errors = [];
const warnings = [];
const manifestPath = path.join(kitDir, "manifest.json");

if (!isDirectory(kitDir)) {
  fail(`キットディレクトリが見つかりません: ${kitDir}`);
  finish();
}
const kitRealDir = fs.realpathSync(kitDir);
if (!isRegularFile(manifestPath)) {
  fail(`manifest.json が見つかりません: ${manifestPath}`);
  finish();
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail(`manifest.json を JSON として読めません: ${messageOf(error)}`);
  finish();
}

validateManifest(manifest);
validateRequiredFiles();
validateRuntimes(manifest);
validateSkills(manifest);
validateTemplates(manifest);
validateAssets(manifest);
validateDocs(manifest);
finish();

function parseArguments(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { help: true };
  let kitDirArgument;
  let publicSkills;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (json) return { error: true };
      json = true;
    } else if (argument === "--public-skills") {
      if (publicSkills !== undefined || index + 1 >= args.length || args[index + 1].startsWith("--")) {
        return { error: true };
      }
      publicSkills = args[index + 1];
      index += 1;
    } else if (argument.startsWith("-")) {
      return { error: true };
    } else if (kitDirArgument === undefined) {
      kitDirArgument = argument;
    } else {
      return { error: true };
    }
  }
  if (kitDirArgument === undefined) return { error: true };
  return { kitDir: kitDirArgument, publicSkills, json };
}

function validateManifest(value) {
  if (!isPlainObject(value)) {
    fail("manifest.json のルートは object である必要があります");
    return;
  }

  const required = ["schemaVersion", "id", "kind", "name", "version", "requires", "license"];
  const optional = ["skills", "templates", "assets", "docs", "provenance"];
  requireFields(value, required, "manifest");
  rejectUnknownFields(value, [...required, ...optional], "manifest");

  if (value.schemaVersion !== 1) fail("schemaVersion は 1 である必要があります");
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
    fail("id は英小文字・数字・ハイフンで構成する必要があります");
  }
  if (value.kind !== "kit") fail('kind は "kit" である必要があります');
  validateNonEmptyString(value.name, "name");
  if (!Number.isInteger(value.version) || value.version < 1) fail("version は 1 以上の整数である必要があります");
  validateRequires(value.requires);
  if (!["LicenseRef-AKARI-Assets-v0", "CC0-1.0"].includes(value.license)) {
    fail("license は LicenseRef-AKARI-Assets-v0 / CC0-1.0 のいずれかである必要があります");
  }
  validateObjectArray(value.skills, "skills", ["dir", "name"], (entry, label) => {
    validateNonEmptyString(entry.dir, `${label}.dir`);
    validateNonEmptyString(entry.name, `${label}.name`);
  });
  validateObjectArray(value.templates, "templates", ["path", "for", "label"], (entry, label) => {
    validateNonEmptyString(entry.path, `${label}.path`);
    if (entry.for !== "world-map") fail(`${label}.for は world-map である必要があります`);
    validateNonEmptyString(entry.label, `${label}.label`);
  });
  validateObjectArray(value.assets, "assets", ["category", "id"], (entry, label) => {
    if (!["overlay", "still", "scene3d", "audio", "broll", "font"].includes(entry.category)) {
      fail(`${label}.category は overlay / still / scene3d / audio / broll / font のいずれかである必要があります`);
    }
    validateNonEmptyString(entry.id, `${label}.id`);
  });
  validateObjectArray(value.docs, "docs", ["path", "label"], (entry, label) => {
    validateNonEmptyString(entry.path, `${label}.path`);
    validateNonEmptyString(entry.label, `${label}.label`);
  });
  if (value.provenance !== undefined) {
    if (!isPlainObject(value.provenance)) {
      fail("provenance は object である必要があります");
    } else {
      requireFields(value.provenance, ["author", "source"], "provenance");
      rejectUnknownFields(value.provenance, ["author", "source"], "provenance");
      validateNonEmptyString(value.provenance.author, "provenance.author");
      validateNonEmptyString(value.provenance.source, "provenance.source");
    }
  }
}

function validateRequires(value) {
  if (!isPlainObject(value)) {
    fail("requires は object である必要があります");
    return;
  }
  requireFields(value, ["cli"], "requires");
  rejectUnknownFields(value, ["cli", "runtimes", "products"], "requires");
  if (typeof value.cli !== "string" || !/^(?:\^|~|>=)?\d+\.\d+\.\d+$/.test(value.cli)) {
    fail("requires.cli は ^x.y.z / ~x.y.z / >=x.y.z / x.y.z のいずれかである必要があります");
  }
  validateStringArray(value.runtimes, "requires.runtimes");
  validateStringArray(value.products, "requires.products");
}

function validateObjectArray(value, label, fields, validateEntry) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    fail(`${label} は配列である必要があります`);
    return;
  }
  value.forEach((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isPlainObject(entry)) {
      fail(`${itemLabel} は object である必要があります`);
      return;
    }
    requireFields(entry, fields, itemLabel);
    rejectUnknownFields(entry, fields, itemLabel);
    validateEntry(entry, itemLabel);
  });
}

function validateRuntimes(value) {
  if (!isPlainObject(value?.requires) || !Array.isArray(value.requires.runtimes)) return;
  const registered = new Set(runtimes.map((entry) => entry.id));
  for (const runtime of value.requires.runtimes) {
    if (typeof runtime === "string" && !registered.has(runtime)) {
      fail(`requires.runtimes に未登録の runtime id があります: ${runtime}`);
    }
  }
}

function validateSkills(value) {
  if (!Array.isArray(value?.skills)) return;
  const publicNames = readPublicSkillNames();
  for (const [index, skill] of value.skills.entries()) {
    if (!isPlainObject(skill) || typeof skill.dir !== "string") continue;
    const label = `skills[${index}]`;
    if (path.isAbsolute(skill.dir) || skill.dir.split(/[\\/]+/u).includes("..")) {
      fail(`${label}.dir は kit-dir 内の相対パスであり、.. を含めてはいけません: ${skill.dir}`);
      continue;
    }
    const skillDir = path.resolve(kitDir, skill.dir);
    if (!isInsideKit(skillDir)) {
      fail(`${label}.dir は kit-dir の外を指せません: ${skill.dir}`);
      continue;
    }
    const skillPath = path.join(skillDir, "SKILL.md");
    if (!isDirectory(skillDir)) {
      fail(`${label}.dir が見つかりません: ${skill.dir}`);
      continue;
    }
    if (!isInside(kitRealDir, fs.realpathSync(skillDir))) {
      fail(`${label}.dir は symlink 経由でも kit-dir の外を指せません: ${skill.dir}`);
      continue;
    }
    if (!isRegularFile(skillPath)) {
      fail(`${label}.dir に SKILL.md が見つかりません: ${skill.dir}`);
      continue;
    }
    const frontmatterName = readFrontmatterName(skillPath);
    if (frontmatterName === undefined) {
      fail(`${label}.dir の SKILL.md frontmatter に name がありません: ${skill.dir}`);
    } else if (typeof skill.name === "string" && frontmatterName !== skill.name) {
      fail(`${label}.name と SKILL.md frontmatter の name が一致しません: ${skill.name} != ${frontmatterName}`);
    }
    if (typeof skill.name === "string" && publicNames?.has(skill.name)) {
      fail(`${label}.name が公開スキル名と重複しています: ${skill.name}`);
    }
  }
}

function readPublicSkillNames() {
  const publicSkillsDir = parsed.publicSkills === undefined ? findPublicSkillsDirectory() : path.resolve(parsed.publicSkills);
  if (!publicSkillsDir || !isDirectory(publicSkillsDir)) {
    warnings.push(`公開 skills ディレクトリが見つからないため、名前の重複照合をスキップしました${publicSkillsDir ? `: ${publicSkillsDir}` : ""}`);
    return undefined;
  }
  try {
    return new Set(fs.readdirSync(publicSkillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  } catch (error) {
    warnings.push(`公開 skills ディレクトリを読めないため、名前の重複照合をスキップしました: ${messageOf(error)}`);
    return undefined;
  }
}

function findPublicSkillsDirectory() {
  let current = ownDir;
  while (true) {
    const candidate = path.join(current, "skills");
    if (isDirectory(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readFrontmatterName(skillPath) {
  let source;
  try {
    source = fs.readFileSync(skillPath, "utf8");
  } catch (error) {
    fail(`SKILL.md を読めません: ${skillPath}: ${messageOf(error)}`);
    return undefined;
  }
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (frontmatter === undefined) return undefined;
  const rawName = frontmatter.match(/^name\s*:\s*(.*?)\s*$/mu)?.[1];
  if (!rawName) return undefined;
  if ((rawName.startsWith('"') && rawName.endsWith('"')) || (rawName.startsWith("'") && rawName.endsWith("'"))) {
    return rawName.slice(1, -1);
  }
  return rawName;
}

function validateTemplates(value) {
  if (!Array.isArray(value?.templates)) return;
  for (const [index, template] of value.templates.entries()) {
    if (!isPlainObject(template) || typeof template.path !== "string") continue;
    if (!pathExists(path.resolve(kitDir, template.path))) {
      fail(`templates[${index}].path が見つかりません: ${template.path}`);
    }
  }
}

function validateAssets(value) {
  if (!Array.isArray(value?.assets)) return;
  const validatorPath = path.join(ownDir, "validate-asset.mjs");
  for (const [index, asset] of value.assets.entries()) {
    if (!isPlainObject(asset) || typeof asset.category !== "string" || typeof asset.id !== "string") continue;
    const assetLabel = `${asset.category}/${asset.id}`;
    const assetDir = path.join(kitDir, "assets", asset.category, asset.id);
    if (!isDirectory(assetDir)) {
      fail(`assets[${index}] の素材ディレクトリが見つかりません: ${assetLabel}`);
      continue;
    }
    const executed = spawnSync(process.execPath, [validatorPath, assetDir], { encoding: "utf8" });
    if (executed.status !== 0) {
      const detail = (executed.stderr || executed.stdout || executed.error?.message || "検証に失敗しました").trim();
      fail(`assets[${index}] が validate-asset に失敗しました: ${assetLabel}${detail ? `: ${detail}` : ""}`);
    }
  }
}

function validateDocs(value) {
  if (!Array.isArray(value?.docs)) return;
  for (const [index, document] of value.docs.entries()) {
    if (!isPlainObject(document) || typeof document.path !== "string") continue;
    if (!pathExists(path.resolve(kitDir, document.path))) {
      fail(`docs[${index}].path が見つかりません: ${document.path}`);
    }
  }
}

function validateRequiredFiles() {
  for (const name of ["README.md", "LICENSE.md"]) {
    if (!isRegularFile(path.join(kitDir, name))) fail(`${name} が見つかりません: ${path.join(kitDir, name)}`);
  }
}

function requireFields(value, fields, label) {
  for (const field of fields) if (!hasOwn(value, field)) fail(`${label} に必須フィールドがありません: ${field}`);
}

function rejectUnknownFields(value, fields, label) {
  for (const field of Object.keys(value)) if (!fields.includes(field)) fail(`${label} に未定義のフィールドがあります: ${field}`);
}

function validateStringArray(value, label) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) fail(`${label} は文字列の配列である必要があります`);
}

function validateNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} は空でない文字列である必要があります`);
}

function isInsideKit(candidate) {
  return isInside(kitDir, candidate);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isDirectory(filePath) {
  try { return fs.statSync(filePath).isDirectory(); } catch { return false; }
}

function isRegularFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function pathExists(filePath) {
  try { fs.accessSync(filePath); return true; } catch { return false; }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  errors.push(message);
}

function finish() {
  const result = { ok: errors.length === 0, errors, warnings };
  if (parsed.json) {
    console.log(JSON.stringify(result));
  } else if (result.ok) {
    console.log(`OK: ${kitDir}`);
    for (const warning of warnings) console.warn(`警告: ${warning}`);
  } else {
    for (const error of errors) console.error(`エラー: ${error}`);
    for (const warning of warnings) console.warn(`警告: ${warning}`);
  }
  process.exit(result.ok ? 0 : 1);
}
