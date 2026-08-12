import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createIntegrityFixture } from "./helpers/integrity-fixture.mjs";

const REAL_REPO_ROOT = resolve(import.meta.dirname, "../../..");

test("npm prepack keeps only runnable vendored bins and marks omitted capability bins reference-only", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "akari-capability-pack-"));
  try {
    const fakeRepo = join(temporary, "repo");
    const packageRoot = join(fakeRepo, "packages", "akari-launcher");
    await mkdir(join(fakeRepo, "packages"), { recursive: true });
    await cp(join(REAL_REPO_ROOT, "packages", "akari-launcher"), packageRoot, { recursive: true });
    await writeFixture(fakeRepo, "LICENSE", "fixture license\n");
    await writeFixture(fakeRepo, "skills/analyze-footage/SKILL.md", "# Analyze footage\n\nFixture.\n");
    await writeFixture(fakeRepo, "skills/edit-plan/beat-sync.md", "# Beat sync nested leaf\n\nSynchronize an approved beat marker.\n");
    await writeFixture(fakeRepo, "docs/contract-fixture.md", "# Fixture contract\n\nDistribution proof.\n");
    await cp(
      join(REAL_REPO_ROOT, "presets", "luts", "natural", "natural.cube"),
      await fixturePath(fakeRepo, "presets/luts/natural/natural.cube"),
    );

    const entries = [
      ["analysis-report", "render-analysis-report.mjs"],
      ["decision-cards", "report-helper.mjs"],
      ["intake-form", "intake-form-helper.mjs"],
      ["preview-server", "src/server.mjs"],
    ];
    for (const [name, target] of entries) {
      await writeFixture(fakeRepo, `packages/${name}/package.json`, `${JSON.stringify({
        name: `@fixture/${name}`,
        description: `${name} public fixture`,
        bin: { [name]: target },
      }, null, 2)}\n`);
      await writeFixture(fakeRepo, `packages/${name}/${target}`, `#!/usr/bin/env node\n// ${name} public help surface\n`);
    }
    await writeFixture(fakeRepo, "packages/edit-lint/package.json", `${JSON.stringify({
      name: "@fixture/edit-lint",
      description: "runnable edit-lint fixture",
      type: "module",
      bin: { "edit-lint": "bin/edit-lint.mjs" },
    }, null, 2)}\n`);
    await writeFixture(
      fakeRepo,
      "packages/edit-lint/bin/edit-lint.mjs",
      '#!/usr/bin/env node\nimport { runCli } from "../src/edit-lint.mjs";\nprocess.exitCode = runCli(process.argv.slice(2));\n',
    );
    await writeFixture(
      fakeRepo,
      "packages/edit-lint/src/edit-lint.mjs",
      'export function runCli(args) { if (args.includes("--help")) console.log("fixture edit-lint help"); return 0; }\n',
    );

    assert.equal(run("git", ["init", "-q"], fakeRepo).status, 0);
    const added = run("git", ["add", "."], fakeRepo);
    assert.equal(added.status, 0, added.stderr);
    const packed = run("npm", ["pack", "--json", "--pack-destination", temporary], packageRoot);
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    const archive = join(temporary, JSON.parse(packed.stdout)[0].filename);
    const listing = run("tar", ["-tzf", archive], temporary);
    assert.equal(listing.status, 0, listing.stderr);
    for (const [name, target] of entries) {
      assert.doesNotMatch(listing.stdout, new RegExp(`package/vendor/packages/${escapeRegex(name)}/${escapeRegex(target)}`, "u"));
    }
    assert.match(listing.stdout, /package\/vendor\/packages\/edit-lint\/bin\/edit-lint\.mjs/u);
    assert.match(listing.stdout, /package\/vendor\/packages\/edit-lint\/src\/edit-lint\.mjs/u);
    assert.match(listing.stdout, /package\/vendor\/\.akari-capability-sources\.json/u);

    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    assert.equal(run("tar", ["-xzf", archive, "-C", unpacked], temporary).status, 0);
    const referenceManifest = JSON.parse(await readFile(
      join(unpacked, "package", "vendor", "packages", "analysis-report", "package.json"),
      "utf8",
    ));
    assert.equal(referenceManifest.bin, undefined);
    assert.equal(referenceManifest.akariVideoVendor.execution, "reference-only");
    assert.deepEqual(referenceManifest.akariVideoVendor.omittedBin, {
      "analysis-report": "render-analysis-report.mjs",
    });
    assert.match(referenceManifest.akariVideoVendor.guidance, /~\/\.akari\/app/u);
    assert.match(referenceManifest.description, /render-analysis-report\.mjs is reference-only/u);

    const runnable = run(process.execPath, [
      join(unpacked, "package", "vendor", "packages", "edit-lint", "bin", "edit-lint.mjs"),
      "--help",
    ], temporary);
    assert.equal(runnable.status, 0, runnable.stderr || runnable.stdout);
    assert.match(runnable.stdout, /fixture edit-lint help/u);

    const cli = join(unpacked, "package", "bin", "akari.mjs");
    const omittedQuery = run(process.execPath, [cli, "capability", "render-analysis-report.mjs", "--json"], temporary);
    assert.equal(omittedQuery.status, 0, omittedQuery.stderr || omittedQuery.stdout);
    const omittedResult = JSON.parse(omittedQuery.stdout);
    assert.ok(omittedResult.matches.some((match) =>
      match.path === "packages/analysis-report/package.json"
      && /reference-only/u.test(`${match.heading} ${match.snippet}`)));

    const query = run(process.execPath, [cli, "capability", "beat-sync", "--json"], temporary);
    assert.equal(query.status, 0, query.stderr || query.stdout);
    const result = JSON.parse(query.stdout);
    assert.ok(result.matches.some((match) => match.path === "skills/edit-plan/beat-sync.md"));

    const fullProject = join(temporary, "full-project");
    await mkdir(fullProject);
    await createIntegrityFixture(fullProject, { usePresetLut: true });
    const full = run(process.execPath, [cli, "status", fullProject, "--full", "--json"], temporary);
    assert.equal(full.status, 0, full.stderr || full.stdout);
    assert.equal(JSON.parse(full.stdout).release.state, "ready_for_acceptance");

    const project = join(temporary, "project");
    await writeFixture(temporary, "project/.akari/connections.json", '{"version":1}\n');
    const miss = run(process.execPath, [
      cli,
      "capability",
      "capability-that-does-not-exist-1847",
      "--record-miss",
      "--json",
    ], project);
    assert.equal(miss.status, 0, miss.stderr || miss.stdout);
    const receipt = JSON.parse(miss.stdout);
    assert.equal(receipt.verdict, "NO_TEXT_MATCH_REQUIRES_REVIEW");
    assert.equal(receipt.approved_to_build, false);
    assert.equal((await readdir(join(project, ".akari", "reports", "absence"))).length, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

async function writeFixture(root, relative, text) {
  const path = await fixturePath(root, relative);
  await writeFile(path, text, "utf8");
}

async function fixturePath(root, relative) {
  const path = join(root, relative);
  await mkdir(join(path, ".."), { recursive: true });
  return path;
}

function run(executable, argumentsList, cwd) {
  return spawnSync(executable, argumentsList, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
