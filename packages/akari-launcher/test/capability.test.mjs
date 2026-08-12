import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { buildCapabilityCatalog, queryCapability, recordCapabilityMiss } from "../src/capability.mjs";
import { discoverCheckoutCapabilitySources } from "../src/capability-sources.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

test("catalog source set is deterministic and nested beat-sync leaf text is searchable", () => {
  const first = buildCapabilityCatalog();
  const second = buildCapabilityCatalog();
  assert.equal(first.source_set_sha256, second.source_set_sha256);
  assert.deepEqual(
    first.sources.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
    second.sources.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
  );
  const result = queryCapability(first, "beat-sync");
  assert.ok(result.matches.some((match) => match.path === "skills/edit-plan/beat-sync.md"));
  assert.deepEqual(Object.keys(result.matches[0]), ["path", "heading", "score", "snippet"]);
});

test("manifest bin resolution includes non-bin entries and refuses escape, missing, and untracked targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-capability-sources-"));
  try {
    const fixtures = [
      ["analysis-report", "render-analysis-report.mjs"],
      ["decision-cards", "report-helper.mjs"],
      ["intake-form", "intake-form-helper.mjs"],
      ["preview-server", "src/server.mjs"],
    ];
    const tracked = [];
    for (const [name, target] of fixtures) {
      const packageRoot = join(root, "packages", name);
      await mkdir(join(packageRoot, target, ".."), { recursive: true });
      await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({ name, bin: { [name]: target } })}\n`, "utf8");
      await writeFile(join(packageRoot, target), `// ${name} public help\n`, "utf8");
      tracked.push(`packages/${name}/package.json`, `packages/${name}/${target}`);
    }
    const discovered = discoverCheckoutCapabilitySources(root, { trackedFiles: tracked });
    for (const [name, target] of fixtures) assert.ok(discovered.includes(`packages/${name}/${target}`));

    const manifest = join(root, "packages", "analysis-report", "package.json");
    await writeFile(manifest, '{"name":"bad","bin":{"bad":"../escape.mjs"}}\n', "utf8");
    assert.throws(() => discoverCheckoutCapabilitySources(root, { trackedFiles: tracked }), /escapes its package root/u);
    await writeFile(manifest, '{"name":"bad","bin":{"bad":"missing.mjs"}}\n', "utf8");
    assert.throws(() => discoverCheckoutCapabilitySources(root, { trackedFiles: tracked }), /not tracked/u);
    assert.throws(
      () => discoverCheckoutCapabilitySources(root, { trackedFiles: [...tracked, "packages/analysis-report/missing.mjs"] }),
      /does not exist/u,
    );
    await writeFile(join(root, "packages", "analysis-report", "missing.mjs"), "// untracked\n", "utf8");
    assert.throws(() => discoverCheckoutCapabilitySources(root, { trackedFiles: tracked }), /not tracked/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest bin resolution can validate without selecting bin targets for npm vendor reference data", async () => {
  const root = await mkdtemp(join(tmpdir(), "akari-capability-reference-only-"));
  try {
    await mkdir(join(root, "packages", "fixture", "bin"), { recursive: true });
    await writeFile(
      join(root, "packages", "fixture", "package.json"),
      '{"name":"fixture","bin":{"fixture":"bin/fixture.mjs"}}\n',
      "utf8",
    );
    await writeFile(join(root, "packages", "fixture", "bin", "fixture.mjs"), "// fixture\n", "utf8");
    const trackedFiles = ["packages/fixture/package.json", "packages/fixture/bin/fixture.mjs"];
    const discovered = discoverCheckoutCapabilitySources(root, { trackedFiles, includeBinTargets: false });
    assert.ok(discovered.includes("packages/fixture/package.json"));
    assert.ok(!discovered.includes("packages/fixture/bin/fixture.mjs"));

    await rm(join(root, "packages", "fixture", "bin", "fixture.mjs"));
    assert.throws(
      () => discoverCheckoutCapabilitySources(root, { trackedFiles, includeBinTargets: false }),
      /does not exist/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("absence receipt is written only for zero hits and always denies build approval", async () => {
  const project = await mkdtemp(join(tmpdir(), "akari-capability-project-"));
  try {
    await mkdir(join(project, ".akari"), { recursive: true });
    await writeFile(join(project, ".akari", "connections.json"), '{"version":1}\n', "utf8");
    const catalog = buildCapabilityCatalog();
    const miss = queryCapability(catalog, "no-such-capability-8d04d357-49b4-43e4");
    assert.equal(miss.matches.length, 0);
    const recorded = await recordCapabilityMiss(project, catalog, miss);
    assert.match(recorded.path, /^\.akari\/reports\/absence\/[a-f0-9]{64}\.json$/u);
    assert.equal(recorded.receipt.verdict, "NO_TEXT_MATCH_REQUIRES_REVIEW");
    assert.equal(recorded.receipt.approved_to_build, false);
    assert.deepEqual(recorded.receipt.matches, []);
    assert.ok(recorded.receipt.sources.length > 0);

    const hit = queryCapability(catalog, "beat-sync");
    await assert.rejects(recordCapabilityMiss(project, catalog, hit), /only for a zero-hit/u);
    assert.equal((await readdir(join(project, ".akari", "reports", "absence"))).length, 1);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("absence writer refuses a reports symlink before writing outside the project", async () => {
  const project = await mkdtemp(join(tmpdir(), "akari-capability-project-"));
  const outside = await mkdtemp(join(tmpdir(), "akari-capability-outside-"));
  try {
    await mkdir(join(project, ".akari"), { recursive: true });
    await writeFile(join(project, ".akari", "connections.json"), '{"version":1}\n', "utf8");
    await symlink(outside, join(project, ".akari", "reports"));
    const catalog = buildCapabilityCatalog();
    const miss = queryCapability(catalog, "no-such-capability-9d779d29-b120");
    await assert.rejects(recordCapabilityMiss(project, catalog, miss), /escapes the project/u);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("absence writer refuses a non-project without creating a report tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "akari-capability-non-project-"));
  try {
    const catalog = buildCapabilityCatalog();
    const miss = queryCapability(catalog, "no-such-capability-c187d7f1");
    await assert.rejects(recordCapabilityMiss(directory, catalog, miss));
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the real source set contains every currently declared non-bin public entry", () => {
  const paths = new Set(discoverCheckoutCapabilitySources(REPO_ROOT));
  for (const path of [
    "packages/analysis-report/render-analysis-report.mjs",
    "packages/decision-cards/report-helper.mjs",
    "packages/intake-form/intake-form-helper.mjs",
    "packages/preview-server/src/server.mjs",
  ]) assert.ok(paths.has(path), path);
});
