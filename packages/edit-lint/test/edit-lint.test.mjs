import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { INTAKE_ROOT_FIELDS } from "../src/edit-lint.mjs";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");
const lintSourcePath = join(packageRoot, "src", "edit-lint.mjs");
const fixtureRoot = join(packageRoot, "fixtures");
const preparedFixtureRoot = await mkdtemp(join(tmpdir(), "edit-lint-v2-fixtures-"));
const preparedFixtures = join(preparedFixtureRoot, "fixtures");
await cp(fixtureRoot, preparedFixtures, { recursive: true });
await migrateFixtureTree(preparedFixtures);
test.after(() => rm(preparedFixtureRoot, { recursive: true, force: true }));
const styleParity = JSON.parse(await readFile(join(
  packageRoot, "../edit-store/test/fixtures/caption-style-validation-parity.json"
), "utf8"));
const intakeSchema = JSON.parse(await readFile(
  join(packageRoot, "../schemas/intake.schema.json"),
  "utf8",
));

async function withFixtures(callback) {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-test-"));
  const copied = join(root, "fixtures");
  await cp(preparedFixtures, copied, { recursive: true, mode: fsConstants.COPYFILE_FICLONE });
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

function styleRootForCase(item, caption = styleParity.caption) {
  const root = {
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...caption, text_style: { color: "#FFF4D6" } }],
  };
  if (Object.hasOwn(item, "default_text_style")) root.default_text_style = item.default_text_style;
  if (Object.hasOwn(item, "caption_text_style")) root.captions[0].text_style = item.caption_text_style;
  return root;
}

test("INTAKE_ROOT_FIELDS matches intake.schema.json properties", () => {
  assert.deepEqual(
    new Set(INTAKE_ROOT_FIELDS),
    new Set(Object.keys(intakeSchema.properties)),
  );
});

test("valid fixture passes and writes both reports", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
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

test("version 3 stops with an honest too-new message", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "version-3"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].check, "edit.version");
    assert.match(result.findings[0].message, /新しすぎる/);
    assert.ok(result.skipped.some((item) => item.check === "edit.validation"));
  });
});

test("valid v2 fixture passes the Phase 0 track checks", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "v2-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(!result.findings.some((finding) => finding.check.startsWith("v2.")));
    assert.ok(!result.skipped.some((item) => item.check === "edit.v2.extended-validation"));
  });
});

for (const [fixture, expectedCheck] of [
  ["v2-id-duplicate-invalid", "v2.id-unique"],
  ["v2-items-content-invalid", "v2.track-content-exclusive"],
  ["v2-track-overlap-invalid", "v2.track-overlap"],
  ["v2-lane-source-invalid", "v2.lane-source"],
]) {
  test(`${fixture} reports ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.ok(
        result.findings.some(
          (finding) => finding.check === expectedCheck && finding.severity === "error",
        ),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

for (const [fixture, expectedCheck] of [
  ["missing-reference", "references.files"],
  ["overlay-range", "overlays.timeline"],
  ["speed-exceeds-timeline-invalid", "overlays.timeline"],
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

test("fragment referencing var(--x, ...) / var(--y, ...) inline on the root style attribute warns overlays.reserved-css-var-reference but stays pass", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    // overlays[].html is always a file reference (validateReferences requires it to resolve to a
    // regular file); the reserved-var check is exercised by rewriting the referenced fragment's
    // content, not by stuffing markup into edit.json directly.
    const capAPath = join(project, "overlays", "cap-a.html");
    await writeFile(
      capAPath,
      '<div class="knob" style="left: var(--x, 80px); top: var(--y, 1248px);"><span>t</span></div>\n',
      "utf8",
    );

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    const findings = result.findings.filter((f) => f.check === "overlays.reserved-css-var-reference");
    assert.equal(findings.length, 2, JSON.stringify(result.findings, null, 2));
    assert.ok(findings.every((f) => f.severity === "warning"));
    assert.ok(findings.some((f) => f.message.includes("--x")));
    assert.ok(findings.some((f) => f.message.includes("--y")));
    assert.ok(findings.every((f) => /reserved/i.test(f.message)));
  });
});

test("fragment using only non-reserved custom vars (e.g. --block-left) does not warn overlays.reserved-css-var-reference", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const capAPath = join(project, "overlays", "cap-a.html");
    await writeFile(
      capAPath,
      '<div class="knob" style="left: var(--block-left, 80px); top: var(--block-top, 1248px);"><span>t</span></div>\n',
      "utf8",
    );

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((f) => f.check === "overlays.reserved-css-var-reference"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("reserved-var-like names (--xanadu, --yellow, --scaleFactor, --rotateSpeed) do not false-positive as prefix matches", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const capAPath = join(project, "overlays", "cap-a.html");
    await writeFile(
      capAPath,
      [
        '<div class="knob" style="',
        "color: var(--xanadu, red);",
        "border-color: var(--yellow, blue);",
        "transform: scale(var(--scaleFactor, 1)) rotate(var(--rotateSpeed, 0deg));",
        '"><span>t</span></div>\n',
      ].join(" "),
      "utf8",
    );

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((f) => f.check === "overlays.reserved-css-var-reference"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("overlays-reserved-css-var-file: file-referenced fragment referencing var(--rotate, ...) warns overlays.reserved-css-var-reference", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "overlays-reserved-css-var-file"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    const finding = result.findings.find((f) => f.check === "overlays.reserved-css-var-reference");
    assert.ok(finding, JSON.stringify(result.findings, null, 2));
    assert.equal(finding.severity, "warning");
    assert.match(finding.path, /reserved-rotate\.html$/);
    assert.ok(finding.message.includes("--rotate"));
  });
});

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
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);

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

test("display policy, reference-pixel style, master encoding, and true peak lint through the shared kernel", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.output.encoding = { quality: "master", encoder: "x264" };
    edit.audio = { master: { loudnorm: -14, true_peak_dbtp: -1.7 } };
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    await writeFile(join(project, "captions.json"), `${JSON.stringify({
      display_policy: {
        mode: "single_line_sequential",
        algorithm: "a4-ja-two-fragment-v1",
        unit_metric: "ascii-half-other-one-v1",
        max_line_units: 8,
        minimum_fragment_duration_seconds: 0.72,
        locale: "ja",
      },
      default_text_style: {
        size_px: 82,
        font_weight: 600,
        line_height: 1.08,
        stroke: { method: "webkit-outline", color: "#050505", width_px: 5 },
        layout: {
          mode: "reference-pixel", reference_width_px: 1920, reference_height_px: 1080,
          left_px: 261, width_px: 1120, bottom_px: 29, text_align: "center", max_lines: 1,
        },
      },
      captions: [{
        id: "c-0001", start: 5, end: 7, text: "正常です", speaker: null,
        sourceRef: null, edited: true,
      }],
    }, null, 2)}\n`, "utf8");

    const valid = run(project);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.ok(!parseResult(valid).findings.some(finding => finding.severity === "error"));

  });
});

test("shared opt-in text-style parity matrix matches edit-lint and the kernel gate", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const adjustedCaption = { ...styleParity.caption, start: 5, end: 7 };
    for (const item of styleParity.valid_style_cases) {
      await writeFile(join(project, "captions.json"), `${JSON.stringify({
        display_policy: styleParity.display_policy,
        default_text_style: item.style,
        captions: [adjustedCaption],
      }, null, 2)}\n`, "utf8");
      const executed = run(project);
      assert.equal(executed.status, 0, `${item.id}: ${executed.stderr || executed.stdout}`);
    }
    for (const item of styleParity.invalid_cases) {
      await writeFile(join(project, "captions.json"), `${JSON.stringify(styleRootForCase(item, adjustedCaption), null, 2)}\n`, "utf8");
      const executed = run(project);
      assert.equal(executed.status, 1, `${item.id}: ${executed.stderr}`);
      assert.ok(parseResult(executed).findings.some(finding =>
        finding.check === "captions.text-style" || finding.check === "captions.display-policy"
      ), item.id);
    }
  });
});

test("shared caption-style contract accepts reveal-word and rejects an unknown value", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const captionsPath = join(project, "captions.json");
    const baseCaption = { ...styleParity.caption, start: 5, end: 7 };
    await writeFile(captionsPath, `${JSON.stringify([
      { ...baseCaption, style: styleParity.caption_style_contract.accepted.style },
    ], null, 2)}\n`, "utf8");
    const accepted = run(project);
    assert.equal(accepted.status, 0, accepted.stderr);

    await writeFile(captionsPath, `${JSON.stringify([
      { ...baseCaption, style: styleParity.caption_style_contract.unknown.style },
    ], null, 2)}\n`, "utf8");
    const unknown = run(project);
    assert.equal(unknown.status, 1, unknown.stderr);
    assert.ok(parseResult(unknown).findings.some(finding =>
      finding.check === "captions.schema" && /reveal-word/u.test(finding.message)
    ));
  });
});

test("captions-words-valid fixture (words[] + style: karaoke, id c-0001) passes lint", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-words-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.severity === "error"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions-style-invalid fixture rejects an unsupported style value", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-style-invalid"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "captions.schema" && /style/.test(finding.message),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions-text-style-record-override-valid accepts root defaults and record overrides", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-text-style-record-override-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.severity === "error"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("caption text animation accepts defaults and per-caption slot overrides", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify({
      default_text_style: {
        animation: {
          in: { id: "fade-up", duration_sec: 0.4, ease: "ease-out", amp: 1.2 },
          out: { id: "soft-fade", ease: null, amp: null },
        },
      },
      captions: [{
        id: "c-0001", start: 5, end: 9, text: "字幕", speaker: null,
        sourceRef: null, edited: false,
        text_style: { animation: { loop: { id: "float" } } },
      }],
    }, null, 2)}\n`, "utf8");

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    assert.ok(!parseResult(executed).findings.some((finding) => finding.severity === "error"));
  });
});

test("caption text animation rejects ids absent from the textanim index", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify({
      default_text_style: { animation: { in: { id: "nonexistent-anim" } } },
      captions: [{
        id: "c-0001", start: 5, end: 9, text: "字幕", speaker: null,
        sourceRef: null, edited: false,
      }],
    }, null, 2)}\n`, "utf8");

    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    assert.ok(parseResult(executed).findings.some((finding) =>
      finding.check === "captions.text-style"
        && /presets\/textanim\/index\.jsonl/.test(finding.message)
    ));
  });
});

for (const [fixture, message] of [
  ["captions-text-style-opacity-out-of-range-invalid", /opacity/],
  ["captions-text-style-background-mode-invalid", /mode/],
  ["captions-text-style-zone-invalid", /zone/],
  ["captions-text-style-color-non-hex-invalid", /color/],
]) {
  test(`${fixture} rejects an invalid text style`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "fail");
      assert.ok(
        result.findings.some(
          (finding) => finding.check === "captions.text-style"
            && message.test(finding.message),
        ),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

for (const fixture of ["captions-reveal-valid", "captions-display-text-valid"]) {
  test(`${fixture} accepts the caption direction extension`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 0, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "pass");
      assert.ok(
        !result.findings.some((finding) => finding.severity === "error"),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

test("captions-display-text-invalid rejects a non-string display_text", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-display-text-invalid"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "captions.schema" && /display_text must be a string/.test(finding.message),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions-word-invalid fixture rejects a malformed words[] element", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-word-invalid"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "captions.schema" && /word/.test(finding.message),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions-word-out-of-range fixture warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-word-out-of-range"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some((finding) => finding.check === "captions.words-range"),
      JSON.stringify(result.findings, null, 2),
    );
    assert.ok(
      result.findings
        .filter((finding) => finding.check === "captions.words-range")
        .every((finding) => finding.severity === "warning"),
    );
  });
});

test("captions-short-duration fixture warns only below the 1.0s readability floor", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-short-duration"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    const findings = result.findings.filter(
      (finding) => finding.check === "captions.short-duration",
    );
    assert.deepEqual(
      findings.map(({ severity, path, range }) => ({ severity, path, range })),
      [
        {
          severity: "warning",
          path: "captions.json#[0]",
          range: { start: 0, end: 0.6 },
        },
      ],
    );
    assert.match(findings[0].message, /0\.60s, under the 1\.0s readability floor/);
  });
});

test("words[] rejects unknown fields, requires 0 <= start <= end, and non-empty text", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "captions-words-valid");
    const captionsPath = join(project, "captions.json");
    await writeFile(
      captionsPath,
      `${JSON.stringify([
        {
          id: "c-0001",
          start: 5,
          end: 9,
          text: "字幕",
          speaker: null,
          sourceRef: null,
          edited: false,
          style: "pop",
          words: [
            { start: 5, end: 5.5, text: "" },
            { start: 6, end: 5.9, text: "逆転" },
            { start: 7, end: 7.5, text: "余分", confidence: 0.9 },
          ],
        },
      ])}\n`,
      "utf8",
    );
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    const schemaFindings = result.findings.filter((finding) => finding.check === "captions.schema");
    assert.ok(schemaFindings.some((finding) => /text must be a non-empty string/.test(finding.message)));
    assert.ok(schemaFindings.some((finding) => /0 <= start <= end/.test(finding.message)));
    assert.ok(schemaFindings.some((finding) => /confidence is not defined/.test(finding.message)));
  });
});

test("narration with bgm and full provenance passes with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "narration-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

for (const [fixture, expectedCheck] of [
  ["narration-invalid-id", "audio.narration.id"],
  ["narration-gain-out-of-range", "audio.narration.gain-db"],
  ["narration-missing-provenance", "audio.narration.provenance"],
  ["narration-voicevox-missing-credit", "audio.narration.credit"],
]) {
  test(`${fixture} fails with ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "fail");
      assert.ok(
        result.findings.some(
          (finding) => finding.check === expectedCheck && finding.severity === "error",
        ),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

test("narration path that does not resolve to a file warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "narration-missing-file");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.narration.file" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("audio.bgm: null is tolerated as equivalent to omitted (same convention as source.proxy)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-null-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("bgm + sfx (2 items) all resolving to real files pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-sfx-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("audio.bgm.fadeIn exceeding half the timeline duration warns without failing (clamp preview)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-fade-exceeds-timeline");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "audio.bgm.fadeIn" &&
          finding.severity === "warning" &&
          /clamped to 10s/.test(finding.message),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("audio.bgm.fadeOut negative value fails", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-fade-invalid");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.bgm.fadeOut" && finding.severity === "error",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("sfx path that does not resolve to a file warns without failing (contract §5 decoration/degrade rule)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-file-missing");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.file" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("sfx t beyond the timeline duration warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-t-exceeds-timeline");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.timeline" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("sfx in/out (R6a trim, contract §2): both present, out-only, and in-only all pass", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-in-out-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check === "audio.sfx.in-out").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("sfx in/out: out <= in (reversed) fails with audio.sfx.in-out", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-in-out-reversed-invalid");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.in-out" && finding.severity === "error",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("sfx in/out: out === in fails with audio.sfx.in-out (out must be strictly greater than in)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-in-out-equal-invalid");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.in-out" && finding.severity === "error",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("audio.sfx[].fade_in exceeding half the clip's effective duration warns without failing (audio-clip-fades)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-fade-exceeds-clip");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "audio.sfx.fade-total" &&
          finding.severity === "warning" &&
          /fade_in \+ fade_out 1\.6s exceeds the clip's effective duration 1s/.test(finding.message),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("audio.sfx[].fade_in negative value fails (audio-clip-fades)", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-fade-invalid");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.fade_in" && finding.severity === "error",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

// sfx-in-out-valid's first item now also carries fade_in=0.2/fade_out=0.2 (audio-clip-fades
// extension) against an effective duration of 1s (in=0.5, out=1.5) -- well within the clamp
// ceiling, so no audio.sfx.fade-total warning should fire.
test("audio.sfx[].fade_in/fade_out well-formed (in/out present, fade within effective duration) pass with no fade-total warning", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "sfx-in-out-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check === "audio.sfx.fade-total").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("bgm.in (R6a trim offset, contract §2) passes without disturbing existing bgm checks", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-in-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings, null, 2));
  });
});

test("direction の不在はエラーにしない（既存 fixture の非退行）", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.every((finding) => !finding.check.startsWith("direction.")),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("cuts[].speed + transition_out + output.look + source.chroma_key + audio.master pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "render-basics-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("cuts[].freeze extends the timeline used by overlays", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "freeze-extends-timeline-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("frame-aligned legacy cuts no longer produce the removed frame-grid check", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "cuts-frame-grid-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check === "cuts.frame-grid").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("off-grid legacy cuts no longer produce the removed frame-grid check", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "cuts-frame-grid-shift-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check === "cuts.frame-grid").length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("edit-lint source cannot emit the removed cuts.frame-grid check", async () => {
  const source = await readFile(lintSourcePath, "utf8");
  assert.equal(source.includes("cuts.frame-grid"), false);
});

test("unreadable input returns execution-error exit code", () => {
  const executed = run(join(tmpdir(), "edit-lint-does-not-exist"));
  assert.equal(executed.status, 2);
  assert.match(executed.stderr, /execution error/i);
});

test("review fixture with all five target kinds passes with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    assert.ok(Object.hasOwn(result.inputs, "review_json_sha256"));
  });
});

test("review src must reference sources[].id", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-src-missing-reference");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.check === "review.src-reference"));
  });
});

test("unresolved insert anchor warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-insert-anchor-unresolved");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "review.insert-anchor-unresolved" &&
          finding.severity === "warning",
      ),
    );
  });
});

test("region target without geometry warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-region-missing-geometry");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "review.target-consistency" &&
          finding.severity === "warning",
      ),
    );
  });
});

test("legacy annotations without targetKind still pass", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-legacy-no-kind");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("newer review.json version stops honestly without format assumptions", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "review-version-too-new");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "review.version" && finding.severity === "error",
      ),
    );
    assert.ok(result.skipped.some((item) => item.check === "review.validation"));
    assert.ok(!result.findings.some((finding) => finding.check === "review.schema"));
  });
});

test("intake.json absent is skipped, not an error", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(result.skipped.some((item) => item.check === "intake"));
  });
});

test("draft intake.json warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "intake-valid-draft");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "intake.status" && finding.severity === "warning",
      ),
    );
  });
});

test("submitted intake.json with valid tasks/target passes with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "intake-valid-submitted");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(
      result.findings.filter((finding) => finding.check.startsWith("intake")).length,
      0,
      JSON.stringify(result.findings),
    );
  });
});

test("intake.json with an unknown task id fails", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "intake-invalid-unknown-task");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "intake.tasks" && finding.severity === "error",
      ),
    );
  });
});

test("submitted intake.json without submitted_at fails", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "intake-invalid-missing-submitted-at");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "intake.submitted_at" && finding.severity === "error",
      ),
    );
  });
});

test("intake.json with duration_s and keep_length both set fails", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "intake-invalid-target-exclusive");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "intake.target-exclusive" && finding.severity === "error",
      ),
    );
  });
});

for (const [fixture, expectedCheck] of [
  ["cuts-track-overlap-invalid", "v2.track-overlap"],
  ["audio-sfx-track-invalid-value", "audio.sfx.track"],
]) {
  test(`${fixture} fails with ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "fail");
      assert.ok(result.findings.some(finding => finding.severity === "error" && finding.check === expectedCheck), JSON.stringify(result.findings, null, 2));
    });
  });
}

for (const fixture of [
  "cuts-track-at-omitted-equivalent",
  "cuts-track-gap-valid",
  "cuts-track-split-valid",
]) {
  test(`${fixture} passes with no track-overlap findings`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 0, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "pass");
      assert.ok(!result.findings.some((finding) => finding.check === "cuts.track-overlap"));
    });
  });
}

for (const fixture of [
  "cuts-transform-omitted-valid",
  "cuts-transform-full-valid",
  "cuts-transform-partial-valid",
]) {
  test(`${fixture} passes with no cut transform or opacity findings`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 0, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "pass");
      assert.equal(result.findings.length, 0, JSON.stringify(result.findings, null, 2));
    });
  });
}

test("P0 2026-08-20 track-identity-and-duration: 総尺は cuts の合計ではなく visual 全体の最大終端（layers の方が長ければ layers が決める）", async () => {
  // base(cuts) は 5s で終わるが upper(layers) は 11s まで伸びている。overlay は 9-10s に置かれていて
  // cuts だけの合計（旧定義, 5s）なら overlays.timeline error になるが、layers を含む visual 全体の
  // 最大終端（11s）なら収まる。段を動かして本編から layers 側へ落ちたクリップが総尺を縮めない
  // ことの直接の回帰確認（症状 2: "overlay ends after timeline duration" の誤検知）。
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "v2-layer-extends-timeline-for-overlay-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.check === "overlays.timeline"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("layers on the same v2 track overlapping fail closed", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "layers-track-overlap-warning"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.ok(result.findings.some(finding => finding.check === "v2.track-overlap" && finding.severity === "error"), JSON.stringify(result.findings, null, 2));
  });
});

test("sfx on the same track at the same t warn without failing", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "sfx-track-overlap-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "audio.sfx.track-overlap" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

for (const fixture of [
  "timeline-tracks-omitted",
]) {
  test(`${fixture} passes without timeline track findings`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 0, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "pass");
      assert.ok(
        !result.findings.some((finding) => finding.check.startsWith("timeline.tracks")),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

test("declared timeline ref without edit data warns without failing", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "timeline-tracks-ref-missing-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "timeline.tracks.ref-missing" &&
          finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

// task 2026-08-07-track-transition-lint-guard (task #14's finding, verified with a real render:
// gap-aware track compositing splits an xfade-blended pair of same-track cuts into two separate,
// non-overlapping composite windows -- the second window points past where the actually-shrunk
// clip's content ends, and the base track's background visibly leaks through early).
test("transition_out on the LAST cut of a gap-aware track is a no-op and does not fail lint", async () => {
  // Mirrors buildMultiSourceCutCommand's own hasAnyTransition check (plan.mjs) and
  // predictedDuration's overlap accounting: a track's last cut has no following same-track cut
  // to blend into, so its transition_out never actually renders and isn't a real hazard.
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "cuts-track-transition-last-cut-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.check === "cuts.track-transition-unsupported"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("duplicate captions timeline track warns while multiple audio timeline tracks do not (R6c 複数音声トラック化による singleton 緩和)", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "timeline-tracks-singleton-duplicate-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    const findings = result.findings.filter(
      (finding) => finding.check === "timeline.tracks.singleton",
    );
    assert.equal(findings.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(findings[0].severity, "warning");
    assert.ok(findings[0].message.includes("captions"), JSON.stringify(findings, null, 2));
  });
});

test("non-zero ref audio timeline track declaration warns neither audio-ref nor declaration-missing (R6c-2 ライダー)", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "timeline-tracks-singleton-duplicate-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.check === "timeline.tracks.audio-ref"),
      JSON.stringify(result.findings, null, 2),
    );
    assert.ok(
      !result.findings.some(
        (finding) =>
          finding.check === "timeline.tracks.declaration-missing" &&
          finding.path.includes("audio"),
      ),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

// captions.overlay-link 撤去の固定（2026-08-07）。
// この規則は「caption の id と一致する overlays[].id が無ければ警告」で、edit-lint 初版から
// 入っていたが、通るプロジェクトが 1 つも存在しなかった（このリポジトリ自身の字幕フィクスチャ
// 6/6 で全字幕に 1 件ずつ発火）。字幕のオーバーレイは消費側が captions[] から合成するもので、
// edit.json に手書きで並べる設計ではないため、規則そのものが実装と食い違っていた。
// 常時全件発火する警告は本物の指摘を埋めるだけなので撤去した。ここで固定しておかないと、
// 「字幕とオーバーレイを対応させるべきでは」という直感から再導入されうる。
test("captions.overlay-link は発火しない（撤去済み・字幕は消費側が overlays を合成する）", async () => {
  await withFixtures(async (fixtures) => {
    for (const name of ["captions-display-text-valid", "captions-words-valid", "captions-reveal-valid", "captions-text-style-record-override-valid"]) {
      const project = join(fixtures, name);
      const result = parseResult(run(project));
      const linked = result.findings.filter((finding) => finding.check === "captions.overlay-link");
      assert.deepEqual(linked, [], `${name} に overlay-link が残っている`);
    }
  });
});
