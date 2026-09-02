import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { lintProject, runCli } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tableText = await readFile(join(packageRoot, "../schemas/engine-capabilities.json"), "utf8");

function mediaEdit(itemOverrides = {}) {
  const item = {
    id: "media-1",
    at: 0,
    duration: 30,
    source: { kind: "media", src: "main", in: 0, out: 1 },
    ...itemOverrides,
  };
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [
      { id: "main", path: "main.mp4" },
      { id: "mask", path: "mask.mp4" },
    ],
    tracks: [{ id: "visual", lane: "visual", items: [item] }],
  };
}

async function createProject(edit) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-engine-"));
  await Promise.all([
    writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`),
    writeFile(join(root, "main.mp4"), ""),
    writeFile(join(root, "mask.mp4"), ""),
  ]);
  return root;
}

function engineFindings(result) {
  return result.findings.filter((finding) => finding.check.startsWith("engine."));
}

for (const engine of ["gpu", "osr"]) {
  test(`cut perspective is one unsupported-field error for --engine ${engine}`, async () => {
    const root = await createProject(mediaEdit({
      perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    }));
    try {
      const result = await lintProject(root, { engine, writeReports: false, checkedAt: "2000-01-01T00:00:00.000Z" });
      const findings = engineFindings(result);
      assert.equal(result.verdict, "fail");
      assert.equal(findings.length, 1);
      assert.equal(findings[0].check, "engine.unsupported-field");
      assert.equal(findings[0].severity, "error");
      assert.match(findings[0].message, new RegExp(`^${engine} 経路は tracks\\[\\]\\.items\\[\\]\\.perspective`, "u"));
      assert.equal(findings[0].path, "edit.json#tracks[0].items[0].perspective");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("--engine auto collapses matching gpu/osr perspective errors", async () => {
  const root = await createProject(mediaEdit({
    perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  }));
  try {
    const result = await lintProject(root, { engine: "auto", writeReports: false });
    const findings = engineFindings(result);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].check, "engine.unsupported-field");
    assert.match(findings[0].message, /^gpu\/osr: /u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("valid clip adjust is structurally accepted and reported as one unsupported field", async () => {
  const root = await createProject(mediaEdit({
    adjust: {
      basic: { exposure: 0.5, temperature: -0.25, saturation: 0.1 },
      lut: { lut: "cinematic-warm", intensity: 0.75 },
      sections: { basic: true, lut: false },
    },
  }));
  try {
    const result = await lintProject(root, { engine: "auto", writeReports: false });
    const structural = result.findings.filter((finding) => finding.check.startsWith("adjust."));
    assert.deepEqual(structural, []);
    const unsupported = engineFindings(result).filter((finding) => finding.path.endsWith(".adjust"));
    assert.equal(unsupported.length, 1);
    assert.equal(unsupported[0].check, "engine.unsupported-field");
    assert.equal(unsupported[0].severity, "error");
    assert.match(unsupported[0].message, /^gpu\/osr: .*tracks\[\]\.items\[\]\.adjust/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clip adjust structural violations fail before engine capability checks", async () => {
  for (const [adjust, check] of [
    [{ basic: { exposure: 3.01 } }, "adjust.basic.exposure"],
    [{ basic: { gamma: 0.2 } }, "adjust.unknown-key"],
    [{ lut: { lut: "" } }, "adjust.lut.lut"],
    [{ sections: { lut: "off" } }, "adjust.sections.lut"],
  ]) {
    const root = await createProject(mediaEdit({ adjust }));
    try {
      const result = await lintProject(root, { writeReports: false });
      assert.equal(result.verdict, "fail", check);
      assert.ok(result.findings.some((finding) => finding.check === check), JSON.stringify(result.findings));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("the same perspective field is consumed after mask projects the media item to layers", async () => {
  const root = await createProject(mediaEdit({
    mask: "mask",
    perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  }));
  try {
    const result = await lintProject(root, { engine: "gpu", writeReports: false });
    assert.equal(engineFindings(result).some((finding) =>
      finding.path === "edit.json#tracks[0].items[0].perspective"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a canonical field missing from an injected table emits capability-unknown", async () => {
  const root = await createProject(mediaEdit({
    perspective: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  }));
  const table = JSON.parse(tableText);
  table.fields = table.fields.filter((field) => field.path !== "tracks[].items[].perspective");
  try {
    const result = await lintProject(root, {
      engine: "gpu",
      engineCapabilities: table,
      writeReports: false,
    });
    const finding = engineFindings(result).find((entry) => entry.path.endsWith(".perspective"));
    assert.equal(finding?.check, "engine.capability-unknown");
    assert.equal(finding?.severity, "warning");
    assert.match(finding.message, /表の更新漏れ/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frame-engine easing outside its two-value subset emits partial-field", async () => {
  const root = await createProject(mediaEdit({
    keyframes: [
      { t: 0, transform: { x: 0 } },
      { t: 30, transform: { x: 100 }, easing: "out-cubic" },
    ],
  }));
  try {
    const result = await lintProject(root, { engine: "osr", writeReports: false });
    const finding = engineFindings(result).find((entry) => entry.path.endsWith(".easing"));
    assert.equal(finding?.check, "engine.partial-field");
    assert.equal(finding?.severity, "warning");
    assert.match(finding.message, /linear と ease-in-out/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("engine capability hash is written only when --engine is requested", async () => {
  const root = await createProject(mediaEdit());
  try {
    const withoutEngine = await lintProject(root, { checkedAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(Object.hasOwn(withoutEngine.inputs, "engine_capabilities_sha256"), false);
    const firstStored = JSON.parse(await readFile(join(root, ".akari", "lint.json"), "utf8"));
    assert.equal(Object.hasOwn(firstStored.inputs, "engine_capabilities_sha256"), false);

    const withEngine = await lintProject(root, { engine: "gpu", checkedAt: "2000-01-01T00:00:00.000Z" });
    assert.match(withEngine.inputs.engine_capabilities_sha256, /^[a-f0-9]{64}$/u);
    const secondStored = JSON.parse(await readFile(join(root, ".akari", "lint.json"), "utf8"));
    assert.equal(secondStored.inputs.engine_capabilities_sha256, withEngine.inputs.engine_capabilities_sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid --engine returns exit 2 and usage without reading the project", async () => {
  const output = { logs: [], errors: [] };
  const exitCode = await runCli(["missing-project", "--engine", "legacy"], {
    log: (value) => output.logs.push(value),
    error: (value) => output.errors.push(value),
  });
  assert.equal(exitCode, 2);
  assert.match(output.errors.join("\n"), /--engine requires gpu, osr, or auto/u);
  assert.match(output.errors.join("\n"), /\[--engine gpu\|osr\|auto\]/u);
});

test("v1 input returns the same execution error with and without --engine", async () => {
  const root = await createProject({
    version: 1,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: "main", path: "main.mp4", proxy: null }],
    cuts: [{ src: "main", in: 0, out: 1 }],
    overlays: [],
  });
  try {
    const run = async (args) => {
      const output = { logs: [], errors: [] };
      const exitCode = await runCli(args, {
        log: (value) => output.logs.push(value),
        error: (value) => output.errors.push(value),
      });
      return { exitCode, output };
    };
    const withoutEngine = await run([root]);
    const withEngine = await run([root, "--engine", "gpu"]);
    assert.equal(withoutEngine.exitCode, 2);
    assert.equal(withEngine.exitCode, 2);
    assert.deepEqual(withEngine.output, withoutEngine.output);
    assert.match(withEngine.output.errors.join("\n"), /このプロジェクトは古い形式です（edit\.json version 1）/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("version 3 keeps the too-new finding and adds engine.capabilities to skipped", async () => {
  const root = await createProject({ version: 3 });
  try {
    const withoutEngine = await lintProject(root, { writeReports: false });
    const withEngine = await lintProject(root, { engine: "gpu", writeReports: false });
    assert.deepEqual(withEngine.findings, withoutEngine.findings);
    assert.deepEqual(withoutEngine.findings.map((finding) => finding.check), ["edit.version"]);
    assert.equal(withoutEngine.skipped.some((entry) => entry.check === "engine.capabilities"), false);
    assert.ok(withEngine.skipped.some((entry) =>
      entry.check === "engine.capabilities" && entry.reason === "v2 のみ対応"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all 112 existing fixtures keep the default execution classification under --engine auto", async () => {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-engine-fixtures-"));
  const fixtures = join(root, "fixtures");
  try {
    await cp(join(packageRoot, "fixtures"), fixtures, { recursive: true });
    await migrateFixtureTree(fixtures);
    const names = (await readdir(fixtures, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    assert.equal(names.length, 112);
    const failures = [];
    for (const name of names) {
      const fixture = join(fixtures, name);
      let defaultError = null;
      try {
        await lintProject(fixture, { writeReports: false });
      } catch (error) {
        defaultError = error instanceof Error ? error.message : String(error);
      }
      try {
        await lintProject(fixture, { engine: "auto", writeReports: false });
        if (defaultError !== null) {
          failures.push(`${name}: default threw "${defaultError}" but --engine auto returned a result`);
        }
      } catch (error) {
        const engineError = error instanceof Error ? error.message : String(error);
        if (defaultError === null) {
          failures.push(`${name}: default returned a result but --engine auto threw "${engineError}"`);
        } else if (engineError !== defaultError) {
          failures.push(`${name}: error changed from "${defaultError}" to "${engineError}"`);
        }
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
