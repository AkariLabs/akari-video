import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject } from "../src/edit-lint.mjs";
import { collectFragmentCssNames } from "../src/lint/fragment-css.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "../..");
const fixture = join(packageRoot, "test", "fixtures", "fragment-css-collision");

async function lintCase(ids) {
  const project = await mkdtemp(join(tmpdir(), "edit-lint-fragment-css-collision-"));
  try {
    await cp(fixture, project, { recursive: true });
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.tracks = edit.tracks.filter(
      (track) => track.id === "main" || track.items.some((item) => ids.includes(item.id)),
    );
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await migrateFixtureTree(project);
    return await lintProject(project, { writeReports: false });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

function collisionFindings(result) {
  return result.findings.filter((finding) => finding.check === "overlays.fragment-css-collision");
}

test("overlapping fragments warn once for a shared class and once for a shared keyframes name", async () => {
  const result = await lintCase(["a", "b"]);
  const findings = collisionFindings(result);
  assert.equal(findings.length, 2, JSON.stringify(result.findings, null, 2));
  const classFinding = findings.find((finding) => finding.message.includes('class ".lbl-hashimoto"'));
  const keyframesFinding = findings.find((finding) => finding.message.includes('@keyframes "drift"'));
  assert.ok(classFinding, JSON.stringify(findings, null, 2));
  assert.ok(keyframesFinding, JSON.stringify(findings, null, 2));
  for (const finding of findings) {
    assert.equal(finding.severity, "warning");
    assert.match(finding.message, /overlays\/a\.html/u);
    assert.match(finding.message, /overlays\/b\.html/u);
    assert.match(finding.message, /prefix/u);
  }
});

test("fragments whose clips do not overlap in time do not warn", async () => {
  const result = await lintCase(["a", "seq"]);
  assert.deepEqual(collisionFindings(result), []);
});

test("the same fragment file reused by several clips does not warn", async () => {
  const result = await lintCase(["a", "reuse-a"]);
  assert.deepEqual(collisionFindings(result), []);
});

test("fragments with different class and keyframes names do not warn", async () => {
  const result = await lintCase(["a", "plain"]);
  assert.deepEqual(collisionFindings(result), []);
});

async function listAssetFragments(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await listAssetFragments(path));
    else if (entry.name.endsWith(".html")) paths.push(path);
  }
  return paths;
}

test("bundled asset fragments share no class or keyframes names", async () => {
  const paths = await listAssetFragments(join(repoRoot, "assets"));
  assert.ok(paths.length > 0, "no bundled asset fragments were found");
  const fragments = [];
  for (const path of paths) {
    fragments.push({ path, names: collectFragmentCssNames(await readFile(path, "utf8")) });
  }
  const collisions = [];
  for (let first = 0; first < fragments.length; first += 1) {
    for (let second = first + 1; second < fragments.length; second += 1) {
      for (const name of fragments[first].names.classes) {
        if (fragments[second].names.classes.has(name)) {
          collisions.push(`${fragments[first].path} / ${fragments[second].path}: .${name}`);
        }
      }
      for (const name of fragments[first].names.keyframes) {
        if (fragments[second].names.keyframes.has(name)) {
          collisions.push(`${fragments[first].path} / ${fragments[second].path}: @keyframes ${name}`);
        }
      }
    }
  }
  assert.deepEqual(collisions, []);
});
