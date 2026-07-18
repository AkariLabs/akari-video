import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");
const fixtureRoot = join(packageRoot, "fixtures");

async function withFixtures(callback) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-test-"));
  const copied = join(root, "fixtures");
  await cp(fixtureRoot, copied, { recursive: true });
  try {
    return await callback(copied, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function run(project, args = [], env = {}) {
  return spawnSync(process.execPath, [cliPath, project, "--json", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function parseResult(runResult) {
  assert.equal(runResult.signal, null, runResult.stderr);
  assert.notEqual(runResult.stdout.trim(), "", runResult.stderr);
  return JSON.parse(runResult.stdout);
}

test("valid fixture passes and writes both reports", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.version, 1);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0);
    assert.ok(result.skipped.some((item) => item.check === "captions"));

    const stored = JSON.parse(await readFile(join(project, ".akari", "lint.json"), "utf8"));
    assert.equal(stored.verdict, "pass");
    const report = await readFile(
      join(project, ".akari", "reports", "edit-lint-report.html"),
      "utf8",
    );
    assert.match(report, /edit-lint report/);
    assert.doesNotMatch(report, /https?:\/\//);
  });
});

test("v1 accepts multiple sources, array-order cuts, and captions src", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(
      join(project, "captions.json"),
      `${JSON.stringify([
        {
          id: "c-0001",
          src: "s1",
          start: 2,
          end: 3,
          text: "字幕A",
          speaker: null,
          sourceRef: null,
          edited: false,
        },
      ])}\n`,
      "utf8",
    );
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(result.findings.every((finding) => finding.severity === "warning"));
    assert.ok(!result.findings.some((finding) => finding.check === "cuts.order"));
  });
});

for (const [fixture, expectedCheck] of [
  ["v1-missing-src-reference", "cuts.src-reference"],
  ["v1-source-sources-exclusive", "edit.sources-exclusive"],
]) {
  test(`${fixture} reports ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.ok(
        result.findings.some((finding) => finding.check === expectedCheck),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

test("version 2 stops with an honest too-new message", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "version-2"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].check, "edit.version");
    assert.match(result.findings[0].message, /新しすぎる/);
    assert.ok(result.skipped.some((item) => item.check === "edit.validation"));
  });
});

test("v1 rejects duplicate ids, missing src, invalid ranges, and missing source paths", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.sources[1].id = "s1";
    edit.sources[0].path = "missing.mp4";
    edit.cuts[0].out = edit.cuts[0].in;
    delete edit.cuts[1].src;
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");

    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.ok(result.findings.some((finding) => finding.check === "sources.id"));
    assert.ok(result.findings.some((finding) => finding.check === "cuts.range"));
    assert.ok(result.findings.some((finding) => finding.check === "cuts.src"));
    assert.ok(result.findings.some((finding) => finding.check === "references.files"));
  });
});

for (const [fixture, expectedCheck] of [
  ["cuts-order", "cuts.order"],
  ["duration-max", "outputs.duration-max"],
  ["missing-reference", "references.files"],
  ["overlay-range", "overlays.timeline"],
  ["data-mismatch", "overlays.data-attributes"],
]) {
  test(`${fixture} fails with ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "fail");
      assert.ok(
        result.findings.some((finding) => finding.check === expectedCheck),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

test("missing analysis and captions are skipped while ffprobe supplies duration", async () => {
  await withFixtures(async (fixtures, root) => {
    const ffprobe = join(root, "ffprobe-stub");
    await writeFile(ffprobe, "#!/bin/sh\nprintf '60\\n'\n", "utf8");
    await chmod(ffprobe, 0o755);

    const executed = run(join(fixtures, "missing-optionals"), [], { FFPROBE: ffprobe });
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(result.skipped.some((item) => item.check === "analysis.json"));
    assert.ok(result.skipped.some((item) => item.check === "captions"));
  });
});

test("result is deterministic after checked_at is excluded", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    assert.equal(run(project).status, 0);
    const first = await readFile(join(project, ".akari", "lint.json"), "utf8");
    assert.equal(run(project).status, 0);
    const second = await readFile(join(project, ".akari", "lint.json"), "utf8");
    const withoutCheckedAt = (value) =>
      value.replace(/"checked_at": "[^"]+"/, '"checked_at": "<excluded>"');
    assert.equal(withoutCheckedAt(second), withoutCheckedAt(first));
  });
});

test("captions validate source-time visibility and edited metadata", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const captionsPath = join(project, "captions.json");
    await writeFile(
      captionsPath,
      `${JSON.stringify([
        {
          id: "c-0001",
          start: 5,
          end: 6,
          text: "字幕A",
          speaker: null,
          sourceRef: null,
          edited: false,
        },
      ])}\n`,
      "utf8",
    );
    const valid = run(project);
    assert.equal(valid.status, 0, valid.stderr);

    await writeFile(
      captionsPath,
      `${JSON.stringify([
        {
          id: "c-0001",
          start: 11,
          end: 12,
          text: "字幕A",
          speaker: null,
          sourceRef: null,
          edited: "no",
        },
      ])}\n`,
      "utf8",
    );
    const invalid = run(project);
    assert.equal(invalid.status, 1, invalid.stderr);
    const result = parseResult(invalid);
    assert.ok(result.findings.some((finding) => finding.check === "captions.cut-visibility"));
    assert.ok(result.findings.some((finding) => finding.check === "captions.edited"));
  });
});

test("unreadable input returns execution-error exit code", () => {
  const executed = run(join(tmpdir(), "edit-lint-does-not-exist"));
  assert.equal(executed.status, 2);
  assert.match(executed.stderr, /execution error/i);
});

test("media mode reports silence and volume; a configured silence threshold fails", async (t) => {
  const available = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (available.status !== 0) {
    t.skip("ffmpeg is not available");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "edit-lint-media-"));
  try {
    const mediaPath = join(root, "source.wav");
    const generated = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(between(t\\,1\\,2)\\,0\\,0.2*sin(2*PI*440*t)):s=48000:d=3",
        "-c:a",
        "pcm_s16le",
        mediaPath,
      ],
      { encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);
    await writeFile(
      join(root, "edit.json"),
      `${JSON.stringify({
        version: 0,
        output: { width: 1280, height: 720, fps: 30 },
        source: { path: "source.wav", proxy: null },
        cuts: [{ in: 0, out: 3 }],
        overlays: [],
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(root, "analysis.json"), '{"duration":3}\n', "utf8");

    const warningRun = run(root, ["--media"]);
    assert.equal(warningRun.status, 0, warningRun.stderr);
    const warningResult = parseResult(warningRun);
    assert.ok(warningResult.findings.some((finding) => finding.check === "media.silence"));
    assert.ok(warningResult.findings.some((finding) => finding.check === "media.volume"));
    assert.ok(warningResult.findings.every((finding) => finding.severity === "warning"));

    const errorRun = run(root, ["--media", "--silence-error-seconds", "0.5"]);
    assert.equal(errorRun.status, 1, errorRun.stderr);
    const errorResult = parseResult(errorRun);
    assert.ok(
      errorResult.findings.some(
        (finding) => finding.check === "media.silence" && finding.severity === "error",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
