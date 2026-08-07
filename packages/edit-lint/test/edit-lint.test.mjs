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
const styleParity = JSON.parse(await readFile(join(
  packageRoot, "../edit-store/test/fixtures/caption-style-validation-parity.json"
), "utf8"));

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

test("overlay track accepts missing/zero/integer and rejects negative, fractional, and non-number values", async () => {
  await withFixtures(async (fixtures) => {
    const validPath = join(fixtures, "valid", "edit.json");
    const validEdit = JSON.parse(await readFile(validPath, "utf8"));
    validEdit.overlays[0].track = 0;
    validEdit.overlays[1].track = 2;
    await writeFile(validPath, `${JSON.stringify(validEdit, null, 2)}\n`, "utf8");
    const valid = run(join(fixtures, "valid"));
    assert.equal(valid.status, 0, valid.stderr);
    assert.ok(!parseResult(valid).findings.some((finding) => finding.check === "overlays.track"));

    const invalid = run(join(fixtures, "overlay-track-invalid"));
    assert.equal(invalid.status, 1, invalid.stderr);
    const findings = parseResult(invalid).findings.filter((finding) => finding.check === "overlays.track");
    assert.equal(findings.length, 3, JSON.stringify(findings, null, 2));
  });
});

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

for (const [fixture, expectedCheck] of [
  ["overlays-background-role-invalid", "overlays.role"],
  ["overlays-background-transform-invalid", "overlays.role.transform"],
  ["overlays-background-vars-locked-invalid", "overlays.role.vars"],
  ["overlays-background-overlap-invalid", "overlays.role.overlap"],
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

test("overlays-background-valid passes with no overlays.role findings", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "overlays-background-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      !result.findings.some((finding) => finding.check?.startsWith("overlays.role")),
      JSON.stringify(result.findings, null, 2),
    );
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
    assert.equal(valid.status, 0, valid.stderr);
    assert.ok(!parseResult(valid).findings.some(finding => finding.severity === "error"));

    edit.emphasis_words = [{
      id: "e-0001", t_start: 5.1, t_end: 5.2, word: "正", emotion: "emphasis",
    }];
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    const invalid = run(project);
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.ok(parseResult(invalid).findings.some(finding => finding.check === "captions.display-policy-emphasis"));
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
      assert.equal(executed.status, 0, `${item.id}: ${executed.stderr}`);
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

test("beats (見せ場マーカー) v0: 3 items with mixed kinds and optional basis pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "beats-v0-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("beats v1: src present / omitted (single-source compatibility) both pass", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "beats-v1-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

for (const [fixture, expectedCheck] of [
  ["beats-invalid-id", "beats.id"],
  ["beats-duplicate-id", "beats.id"],
  ["beats-strength-out-of-range", "beats.strength"],
  ["beats-missing-kind", "beats.kind"],
  ["beats-v1-src-missing-reference", "beats.src-reference"],
  ["beats-v0-src-present", "beats.src"],
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

test("beats[].t is not compared against the source duration (source-seconds anchor; no --media decode)", async () => {
  await withFixtures(async (fixtures) => {
    // beats-v0-valid の b-0002/b-0003 は timeline 尺（cuts 合計 20s）も analysis.json の
    // source 実尺（60s）も超えない位置にあるが、beats は timeline 秒ではなく source 秒アンカー
    // （contract-2026-07-22-edit-json-v1-beats.md §3）であるため、実尺を超える t でも
    // findings を出さないことを確認する（同 §7 の将来課題）。
    const project = join(fixtures, "beats-v0-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.beats[2].t = 9999;
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("emphasis_words (語レベル演出) v0: 3 words with mixed emotions and optional style_hint pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "emphasis-words-v0-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("emphasis_words v1: src present / omitted (single-source compatibility) both pass", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "emphasis-words-v1-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

for (const [fixture, expectedCheck] of [
  ["emphasis-words-invalid-id", "emphasis_words.id"],
  ["emphasis-words-range-invalid", "emphasis_words.range"],
  ["emphasis-words-empty-word", "emphasis_words.word"],
  ["emphasis-words-missing-emotion", "emphasis_words.emotion"],
  ["emphasis-words-v0-src-present", "emphasis_words.src"],
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

test("emphasis_words[].t_start / t_end are not compared against the source duration (source-seconds anchor)", async () => {
  await withFixtures(async (fixtures) => {
    // emphasis-words-v0-valid の e-0002/e-0003 は analysis.json の source 実尺（60s）も
    // timeline 尺（cuts 合計 20s）も超える位置にあるが、emphasis_words は timeline 秒ではなく
    // source 秒アンカー（contract-2026-07-23-edit-json-v1-emphasis-words.md §3）であるため
    // findings を出さないことを確認する（同 §7 の将来課題）。
    const project = join(fixtures, "emphasis-words-v0-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.emphasis_words[2].t_start = 9999;
    edit.emphasis_words[2].t_end = 9999.5;
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("direction (演出宣言): preset + intensity 70 + empty overrides pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "direction-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

test("direction: preset only (intensity / overrides omitted) passes", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "direction-preset-only");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

for (const [fixture, expectedCheck] of [
  ["direction-missing-preset", "direction.preset"],
  ["direction-intensity-out-of-range", "direction.intensity"],
  ["direction-intensity-negative", "direction.intensity"],
  ["direction-intensity-not-integer", "direction.intensity"],
  ["direction-overrides-array", "direction.overrides"],
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

test("direction が object でない場合は direction.structure エラーになる", async () => {
  await withFixtures(async (fixtures) => {
    // docs/contract-2026-07-23-edit-json-v1-direction.md §1: direction は配列ではなく
    // オブジェクト（宣言はファイルに 1 つ）。配列で書かれた宣言は静的検証でエラーにする。
    const project = join(fixtures, "direction-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.direction = [{ preset: "youtube-long-standard" }];
    await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "direction.structure" && finding.severity === "error",
      ),
      JSON.stringify(result.findings, null, 2),
    );
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
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
  });
});

for (const [expectedCheck] of [
  ["output.look.intensity"],
  ["chroma-key.color"],
  ["cuts.speed"],
  ["cuts.transition-out.type"],
  ["audio.master.denoise"],
  ["audio.master.loudnorm"],
]) {
  test(`render-basics-invalid reports ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, "render-basics-invalid"));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.ok(
        result.findings.some((finding) => finding.check === expectedCheck && finding.severity === "error"),
        JSON.stringify(result.findings, null, 2),
      );
    });
  });
}

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

test("caption silence coverage warns only above its configurable threshold in media mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-caption-silence-"));
  try {
    const mediaPath = join(root, "source.wav");
    const ffmpeg = join(root, "ffmpeg-stub");
    await writeFile(mediaPath, "", "utf8");
    await writeFile(
      ffmpeg,
      `#!/bin/sh
case "$*" in
  *silencedetect*)
    echo "[silencedetect @ 0x0] silence_start: 2" 1>&2
    echo "[silencedetect @ 0x0] silence_end: 5 | silence_duration: 3" 1>&2
    ;;
  *volumedetect*)
    echo "[Parsed_volumedetect_0 @ 0x0] mean_volume: -20.0 dB" 1>&2
    echo "[Parsed_volumedetect_0 @ 0x0] max_volume: -5.0 dB" 1>&2
    ;;
esac
exit 0
`,
      "utf8",
    );
    await chmod(ffmpeg, 0o755);
    await writeFile(
      join(root, "edit.json"),
      `${JSON.stringify({
        version: 0,
        output: { width: 1280, height: 720, fps: 30 },
        source: { path: "source.wav", proxy: null },
        cuts: [{ in: 0, out: 12 }],
        overlays: [],
      }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(join(root, "analysis.json"), '{"duration":12}\n', "utf8");
    const writeCaption = async (end) => {
      await writeFile(
        join(root, "captions.json"),
        `${JSON.stringify([
          {
            id: "c-0001",
            start: 0,
            end,
            text: "AKARI Video",
            speaker: null,
            sourceRef: null,
            edited: false,
          },
        ], null, 2)}\n`,
        "utf8",
      );
    };
    const coverageFindings = (executed) =>
      parseResult(executed).findings.filter(
        (finding) => finding.check === "media.caption-silence-coverage",
      );

    await writeCaption(6);
    const above = run(root, ["--media"], { FFMPEG: ffmpeg });
    assert.equal(above.status, 0, above.stderr);
    assert.equal(coverageFindings(above).length, 1);
    assert.match(coverageFindings(above)[0].message, /50\.0%/);

    await writeCaption(12);
    const below = run(root, ["--media"], { FFMPEG: ffmpeg });
    assert.equal(below.status, 0, below.stderr);
    assert.equal(coverageFindings(below).length, 0);

    await writeCaption(10);
    const boundary = run(root, ["--media"], { FFMPEG: ffmpeg });
    assert.equal(boundary.status, 0, boundary.stderr);
    assert.equal(coverageFindings(boundary).length, 0);

    await writeCaption(6);
    const raisedThreshold = run(
      root,
      ["--media", "--caption-silence-warn-percent", "50"],
      { FFMPEG: ffmpeg },
    );
    assert.equal(raisedThreshold.status, 0, raisedThreshold.stderr);
    assert.equal(coverageFindings(raisedThreshold).length, 0);

    const loweredThreshold = run(
      root,
      ["--media", "--caption-silence-warn-percent=49"],
      { FFMPEG: ffmpeg },
    );
    assert.equal(loweredThreshold.status, 0, loweredThreshold.stderr);
    assert.equal(coverageFindings(loweredThreshold).length, 1);

    const withoutMedia = run(root, [], {
      FFMPEG: join(root, "ffmpeg-must-not-run"),
    });
    assert.equal(withoutMedia.status, 0, withoutMedia.stderr);
    const withoutMediaResult = parseResult(withoutMedia);
    assert.ok(
      !withoutMediaResult.findings.some(
        (finding) => finding.check === "media.caption-silence-coverage",
      ),
    );
    assert.ok(
      withoutMediaResult.skipped.some(
        (item) =>
          item.check === "media" &&
          item.reason === "media checks require --media",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  ["cuts-track-overlap-invalid", "cuts.track-overlap"],
  ["cuts-at-negative-invalid", "cuts.at"],
  ["cuts-track-invalid-value", "cuts.track"],
  ["cuts-transform-scale-invalid", "cuts.transform"],
  ["cuts-opacity-out-of-range-invalid", "cuts.opacity"],
  ["cuts-transform-rotate-invalid", "cuts.transform"],
  ["cuts-transform-unknown-key-invalid", "cuts.transform"],
  ["layers-track-invalid-value", "layers.track"],
  ["audio-sfx-track-invalid-value", "audio.sfx.track"],
]) {
  test(`${fixture} fails with ${expectedCheck}`, async () => {
    await withFixtures(async (fixtures) => {
      const executed = run(join(fixtures, fixture));
      assert.equal(executed.status, 1, executed.stderr);
      const result = parseResult(executed);
      assert.equal(result.verdict, "fail");
      assert.ok(
        result.findings.some(
          (finding) => finding.severity === "error" && finding.check === expectedCheck,
        ),
        JSON.stringify(result.findings, null, 2),
      );
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

test("layers on the same track overlapping in the output axis warn without failing", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "layers-track-overlap-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "layers.track-overlap" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
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

test("gap-aware output axis duration exceeding duration_max warns without failing when the gapless sum still fits", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "outputs-duration-max-gaps-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) => finding.check === "outputs.duration-max-gaps" && finding.severity === "warning",
      ),
      JSON.stringify(result.findings, null, 2),
    );
    assert.ok(!result.findings.some((finding) => finding.check === "outputs.duration-max"));
  });
});

for (const fixture of [
  "timeline-tracks-omitted",
  "timeline-tracks-declared-valid",
  "timeline-tracks-interleaved",
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

test("edit data without a declared timeline track warns when timeline is present", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "timeline-tracks-declaration-missing-warning"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(
      result.findings.some(
        (finding) =>
          finding.check === "timeline.tracks.declaration-missing" &&
          finding.severity === "warning",
      ),
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
