#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_ROOT = join(REPOSITORY_ROOT, "skills", "edit-plan", "bin", "generated");
const VALIDATOR_PATH = join(GENERATED_ROOT, "contract-validators.cjs");
const SCHEMAS = [
  {
    id: "analysis-v0",
    source: "packages/schemas/analysis.schema.json",
    runtimeId: "urn:akari-video:schema:analysis:v0",
    exportName: "validateAnalysis",
  },
  {
    id: "semantic-keep-plan-v1",
    source: "packages/schemas/semantic-keep-plan.schema.json",
    runtimeId: "urn:akari-video:schema:semantic-keep-plan:v1",
    exportName: "validateSemanticKeepPlan",
  },
  {
    id: "cut-candidates-v1",
    source: "packages/schemas/cut-candidates.schema.json",
    runtimeId: "urn:akari-video:schema:cut-candidates:v1",
    exportName: "validateCutCandidates",
  },
];
const REQUIRE_PATTERN = /require\(["']([^"']+)["']\)/gu;
const CHECK = process.argv.includes("--check");

if (process.argv.length > (CHECK ? 3 : 2)) fail("usage: gen-cut-candidate-validators.mjs [--check]");

const desired = await generateFiles();
if (CHECK) {
  await checkGenerated(desired);
  console.log("cut-candidate validators: generated closure is current");
} else {
  await materialize(desired);
  await checkGenerated(desired);
  console.log("cut-candidate validators: generated closure updated");
}

async function generateFiles() {
  const ajv = new Ajv2020({
    allErrors: true,
    code: { source: true, esm: false, lines: true },
    strict: false,
    validateFormats: false,
  });
  const schemaReceipts = [];
  const exportsByName = {};
  for (const entry of SCHEMAS) {
    const sourceBytes = await readFile(join(REPOSITORY_ROOT, entry.source));
    const schema = JSON.parse(sourceBytes.toString("utf8"));
    const runtimeSchema = structuredClone(schema);
    runtimeSchema.$id = entry.runtimeId;
    ajv.addSchema(runtimeSchema, entry.runtimeId);
    exportsByName[entry.exportName] = entry.runtimeId;
    schemaReceipts.push({
      id: entry.id,
      canonical_source_path: entry.source,
      sha256: sha256(sourceBytes),
    });
  }

  let generated = standaloneCode(ajv, exportsByName);
  const files = new Map();
  const absoluteTargets = new Map();
  const targetOwners = new Map();
  const licenses = new Map();
  const require = createRequire(import.meta.url);
  const topLevelSpecifiers = [...generated.matchAll(REQUIRE_PATTERN)].map((match) => match[1]);
  for (const specifier of topLevelSpecifiers) {
    if (isAllowedBuiltin(specifier) || specifier.startsWith(".")) continue;
    const sourcePath = require.resolve(specifier);
    const target = await assignTarget(sourcePath, specifier, absoluteTargets, targetOwners);
    await vendorModule(sourcePath, target, absoluteTargets, targetOwners, files, licenses);
    generated = replaceRequire(generated, specifier, `./${target}`);
  }

  generated = generated.replace(/^"use strict";?/u, '"use strict";');
  generated += `\nconst contractSchemas = Object.freeze(${JSON.stringify(schemaReceipts)});\n`;
  generated += "exports.contractSchemas = contractSchemas;\n";
  files.set("contract-validators.cjs", Buffer.from(generated, "utf8"));
  for (const [path, bytes] of licenses) files.set(path, bytes);
  return files;
}

async function vendorModule(sourcePath, target, absoluteTargets, targetOwners, files, licenses) {
  if (files.has(target)) return;
  let source = await readFile(sourcePath, "utf8");
  files.set(target, Buffer.alloc(0));
  await collectLicense(sourcePath, licenses);
  const localRequire = createRequire(sourcePath);
  const specifiers = [...source.matchAll(REQUIRE_PATTERN)].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (isAllowedBuiltin(specifier)) continue;
    const dependencyPath = localRequire.resolve(specifier);
    const dependencyTarget = await assignTarget(dependencyPath, specifier, absoluteTargets, targetOwners);
    await vendorModule(dependencyPath, dependencyTarget, absoluteTargets, targetOwners, files, licenses);
    let rewritten = relative(dirname(target), dependencyTarget).split(sep).join("/");
    if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
    source = replaceRequire(source, specifier, rewritten);
  }
  source = source.replace(/^\/\/# sourceMappingURL=.*$/gmu, "");
  files.set(target, Buffer.from(source.endsWith("\n") ? source : `${source}\n`, "utf8"));
}

async function assignTarget(sourcePath, specifier, absoluteTargets, targetOwners) {
  if (absoluteTargets.has(sourcePath)) return absoluteTargets.get(sourcePath);
  const owner = await stableModuleIdentity(sourcePath);
  let stem;
  if (specifier.startsWith("ajv/dist/runtime/")) {
    stem = basename(sourcePath, extname(sourcePath));
  } else {
    const packageName = packageNameOf(specifier).replaceAll("@", "").replaceAll("/", "-");
    stem = `${packageName}-${basename(sourcePath, extname(sourcePath))}-${sha256(owner).slice(0, 8)}`;
  }
  const target = `runtime/${stem}.cjs`;
  const existingOwner = targetOwners.get(target);
  if (existingOwner && existingOwner !== owner) {
    throw new Error(`stable vendored runtime target collision: ${target}`);
  }
  targetOwners.set(target, owner);
  absoluteTargets.set(sourcePath, target);
  return target;
}

async function stableModuleIdentity(sourcePath) {
  let directory = dirname(sourcePath);
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (typeof manifest.name !== "string" || manifest.name === "") break;
      const packageRelativePath = relative(directory, sourcePath).split(sep).join("/");
      const contentSha256 = sha256(await readFile(sourcePath));
      return `${manifest.name}\0${packageRelativePath}\0${contentSha256}`;
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`package-relative identity is unavailable for vendored runtime: ${sourcePath}`);
}

async function collectLicense(sourcePath, licenses) {
  let directory = dirname(sourcePath);
  while (directory !== dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (typeof manifest.name !== "string" || manifest.name === "") return;
      const safeName = manifest.name.replaceAll("@", "").replaceAll("/", "-");
      for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"] ) {
        try {
          const bytes = await readFile(join(directory, name), "utf8");
          licenses.set(
            `runtime/licenses/${safeName}.txt`,
            Buffer.from(`${bytes.replace(/[\t\r\n ]+$/u, "")}\n`, "utf8"),
          );
          return;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      throw new Error(`license is missing for vendored runtime package: ${manifest.name}`);
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`package manifest is missing for vendored runtime: ${sourcePath}`);
}

async function materialize(files) {
  await mkdir(GENERATED_ROOT, { recursive: true });
  const existing = await listFiles(GENERATED_ROOT);
  for (const relativePath of existing) {
    if (!files.has(relativePath)) await rm(join(GENERATED_ROOT, relativePath));
  }
  for (const [relativePath, bytes] of files) {
    const destination = join(GENERATED_ROOT, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}

async function checkGenerated(files) {
  for (const [relativePath, expected] of files) {
    let actual;
    try {
      actual = await readFile(join(GENERATED_ROOT, relativePath));
    } catch (error) {
      if (error?.code === "ENOENT") fail(`generated file is missing: ${relativePath}`);
      throw error;
    }
    if (!actual.equals(expected)) fail(`generated file drift: ${relativePath}`);
  }
  const existing = await listFiles(GENERATED_ROOT);
  for (const relativePath of existing) {
    if (!files.has(relativePath)) fail(`unexpected generated file: ${relativePath}`);
  }
  await assertRequireClosure(existing);
  await assertDetachedStartup();
}

async function assertRequireClosure(existing) {
  const existingSet = new Set(existing);
  for (const relativePath of existing.filter((path) => path.endsWith(".cjs"))) {
    const source = await readFile(join(GENERATED_ROOT, relativePath), "utf8");
    for (const match of source.matchAll(REQUIRE_PATTERN)) {
      const specifier = match[1];
      if (isAllowedBuiltin(specifier)) continue;
      if (!specifier.startsWith(".")) fail(`bare generated require is forbidden: ${specifier}`);
      const absoluteResolved = resolve(dirname(join(GENERATED_ROOT, relativePath)), specifier);
      const resolved = normalizeGeneratedPath(relative(GENERATED_ROOT, absoluteResolved));
      if (!existingSet.has(resolved)) fail(`generated require is unresolved: ${relativePath} -> ${specifier}`);
    }
  }
  if (!existing.some((path) => path.startsWith("runtime/licenses/"))) fail("vendored runtime license is missing");
}

async function assertDetachedStartup() {
  const temporary = await mkdtemp(join(tmpdir(), "akari-cut-validator-"));
  try {
    const destination = join(temporary, "generated");
    await cp(GENERATED_ROOT, destination, { recursive: true });
    const script = [
      `const validators=require(${JSON.stringify(join(destination, "contract-validators.cjs"))});`,
      "if(typeof validators.validateAnalysis!=='function') process.exit(3);",
      "if(typeof validators.validateSemanticKeepPlan!=='function') process.exit(4);",
      "if(typeof validators.validateCutCandidates!=='function') process.exit(5);",
      "if(!Array.isArray(validators.contractSchemas)||validators.contractSchemas.length!==3) process.exit(6);",
    ].join("");
    const executed = spawnSync(process.execPath, ["-e", script], {
      cwd: temporary,
      encoding: "utf8",
      env: {},
    });
    if (executed.status !== 0) fail(`detached generated validator startup failed: ${executed.status}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function listFiles(root) {
  try {
    const result = [];
    await walk(root, "", result);
    return result.sort(codePointCompare);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function walk(root, prefix, result) {
  const directory = join(root, prefix);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, relativePath, result);
    else if (entry.isFile()) result.push(relativePath);
    else fail(`generated closure contains a non-file: ${relativePath}`);
  }
}

function replaceRequire(source, from, to) {
  return source.replaceAll(`require(${JSON.stringify(from)})`, `require(${JSON.stringify(to)})`)
    .replaceAll(`require('${from}')`, `require('${to}')`);
}

function normalizeGeneratedPath(path) {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function packageNameOf(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function isAllowedBuiltin(specifier) {
  return specifier.startsWith("node:");
}

function codePointCompare(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? (rightIndex === right.length ? 0 : -1) : 1;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
