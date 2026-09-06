import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  INTAKE_ROOT_FIELDS,
  lintProject,
  validateCaptionTrackDeclaration,
  validateTrackTransitionOutCompatibility,
} from "../src/edit-lint.mjs";
import { createRequire } from "node:module";
import { migrateFixtureTree } from "./helpers/v2-fixture.mjs";

// 幾何の統一 G1: 未移行の v2（output.geometry 未指定）には geometry.fit-compat の warning が
// 必ず 1 件付く。各検査の「所見ゼロ」判定はこの移行案内を除いて数える
// （案内そのものは test/geometry-fit-compat.test.mjs が固定する）。
function withoutGeometryNotice(findings) {
  return findings.filter((finding) => finding.check !== "geometry.fit-compat");
}

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
const require = createRequire(import.meta.url);
const { projectLegacyEdit, readInternalEdit, TRANSITION_TYPE_IDS } = require("../../edit-store/lib/index.js");

test('time_domain: output のアンカー stale 判定は edit-store 正本と一致する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edit-lint-anchor-output-'));
  try {
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 30 },
      sources: [{ id: 'main', path: 'main.mp4' }],
      tracks: [
        { id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 300, source: { kind: 'media', src: 'main', in: 5, out: 15 } }] },
        { id: 'overlay', lane: 'visual', items: [{ id: 'box', at: 30, duration: 30, source: { kind: 'html', path: 'box.html' }, anchor: { caption: 'c-0003' } }] },
      ],
    };
    await writeFile(join(root, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    await writeFile(join(root, 'captions.json'), `${JSON.stringify([
      { id: 'c-0003', start: 1, end: 2, text: 'output', time_domain: 'output' },
    ], null, 2)}\n`);
    const result = await lintProject(root);
    assert.equal(result.findings.filter(finding => finding.check === 'v2.item-anchor-stale').length, 0);
    assert.equal(result.findings.filter(finding => finding.check === 'v2.item-anchor-unresolvable').length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    assert.equal(withoutGeometryNotice(result.findings).length, 0);
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

const WORD_BOOK_FIXTURE = {
  edit: {
    version: 0,
    output: { width: 1280, height: 720, fps: 30 },
    source: { path: "../valid/sample.mp4", proxy: null },
    cuts: [{ in: 0, out: 8 }],
    overlays: [],
  },
  captions: {
    display_policy: {
      mode: "single_line_sequential",
      algorithm: "a4-ja-two-fragment-v1",
      unit_metric: "ascii-half-other-one-v1",
      max_line_units: 3,
      minimum_fragment_duration_seconds: 0.1,
      locale: "ja",
    },
    captions: [
      {
        id: "c-0001", start: 0, end: 2, text: "あかりビデオ",
        speaker: null, sourceRef: null, edited: false,
        words: [{ start: 0, end: 2, text: "あかりビデオ" }],
        display_fragments: ["あかり", "ビデオ"],
      },
      {
        id: "c-0002", start: 2, end: 4, text: "あかりビデオ",
        speaker: null, sourceRef: null, edited: true,
        words: [{ start: 2, end: 4, text: "あかりビデオ" }],
        display_fragments: ["あかり", "ビデオ"],
      },
      {
        id: "c-0003", start: 4, end: 6, text: "ムービー",
        speaker: null, sourceRef: null, edited: false,
        words: [{ start: 4, end: 6, text: "ムービー" }],
        display_fragments: ["ムー", "ビー"],
      },
      {
        id: "c-0004", start: 6, end: 8, text: "alpha beta",
        speaker: null, sourceRef: null, edited: false,
        words: [{ start: 6, end: 7, text: "alpha" }, { start: 7, end: 8, text: "beta" }],
      },
    ],
  },
  extraWordBook: {
    version: 0,
    entries: [
      { surface: "AKARI Video", variants: ["あかりビデオ"], kind: "term" },
      { surface: "動画", variants: ["ムービー"], kind: "notation" },
      { surface: "alpha beta", variants: [], kind: "term", protect_break: true },
      { surface: "ExtraName", variants: ["shadow"], kind: "term" },
    ],
  },
  projectWordBook: {
    version: 0,
    entries: [{ surface: "ProjectName", variants: ["shadow"], kind: "term" }],
  },
  invalidWordBook: { version: 1, entries: [] },
};

async function materializeWordBookFixture(fixtures) {
  const fixture = WORD_BOOK_FIXTURE;
  const project = join(fixtures, "word-book-runtime");
  const memory = join(project, ".akari", "memory");
  await mkdir(memory, { recursive: true });
  await writeFile(join(project, "edit.json"), `${JSON.stringify(fixture.edit, null, 2)}\n`);
  await writeFile(join(project, "captions.json"), `${JSON.stringify(fixture.captions, null, 2)}\n`);
  await writeFile(join(project, "extra-word-book.json"), `${JSON.stringify(fixture.extraWordBook, null, 2)}\n`);
  await writeFile(join(project, "invalid-word-book.json"), `${JSON.stringify(fixture.invalidWordBook)}\n`);
  await writeFile(join(memory, "word-book.json"), `${JSON.stringify(fixture.projectWordBook, null, 2)}\n`);
  await migrateFixtureTree(project);
  return project;
}

async function runWordBookFixture(fixtures, wordBook = "extra-word-book.json") {
  const project = await materializeWordBookFixture(fixtures);
  return run(project, [], {
    AKARI_WORD_BOOK: join(project, wordBook),
    AKARI_HOME: join(fixtures, "isolated-machine"),
    HOME: join(fixtures, "isolated-home"),
  });
}

test("word-book.invalid は壊れた層の code と path を warning にする", async () => {
  await withFixtures(async (fixtures) => {
    const project = await materializeWordBookFixture(fixtures);
    const executed = run(project, [], {
      AKARI_WORD_BOOK: join(project, "invalid-word-book.json"),
      AKARI_HOME: join(fixtures, "isolated-machine"), HOME: join(fixtures, "isolated-home"),
    });
    const findings = parseResult(executed).findings.filter(finding => finding.check === "word-book.invalid");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.match(findings[0].message, /too-new/u);
    assert.match(findings[0].path, /invalid-word-book/u);
  });
});

test("word-book.variant-shadowed は層間 variant 衝突を info にする", async () => {
  await withFixtures(async (fixtures) => {
    const findings = parseResult(await runWordBookFixture(fixtures)).findings
      .filter(finding => finding.check === "word-book.variant-shadowed");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
    assert.match(findings[0].message, /ExtraName.*ProjectName/u);
  });
});

test("captions.word-book-term は未適用 term を warning にする", async () => {
  await withFixtures(async (fixtures) => {
    const findings = parseResult(await runWordBookFixture(fixtures)).findings
      .filter(finding => finding.check === "captions.word-book-term" && finding.path === "captions.json#[0]");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.match(findings[0].message, /words\[0\].*あかりビデオ.*AKARI Video/u);
  });
});

test("edited 行の captions.word-book-term は info に下がる", async () => {
  await withFixtures(async (fixtures) => {
    const findings = parseResult(await runWordBookFixture(fixtures)).findings
      .filter(finding => finding.check === "captions.word-book-term" && finding.path === "captions.json#[1]");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "info");
  });
});

test("captions.word-book-notation は notation variant を warning にする", async () => {
  await withFixtures(async (fixtures) => {
    const findings = parseResult(await runWordBookFixture(fixtures)).findings
      .filter(finding => finding.check === "captions.word-book-notation");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.match(findings[0].message, /ムービー.*動画/u);
  });
});

test("captions.word-book-break-fallback は dropped_terms を warning にする", async () => {
  await withFixtures(async (fixtures) => {
    const findings = parseResult(await runWordBookFixture(fixtures)).findings
      .filter(finding => finding.check === "captions.word-book-break-fallback");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[0].path, "captions.json#[3]");
    assert.match(findings[0].message, /alpha beta/u);
  });
});

test("単語帳が無ければ word-book 規則は静か", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "captions-words-valid");
    const result = parseResult(run(project, [], {
      AKARI_WORD_BOOK: join(fixtures, "missing-word-book.json"),
      AKARI_HOME: join(fixtures, "isolated-machine"), HOME: join(fixtures, "isolated-home"),
    }));
    assert.equal(result.findings.filter(finding => finding.check.includes("word-book")).length, 0);
  });
});

test("既定 valid fixture では新規 5 規則が 1 件も鳴らない", async () => {
  await withFixtures(async (fixtures) => {
    const result = parseResult(run(join(fixtures, "valid"), [], {
      AKARI_WORD_BOOK: join(fixtures, "missing-word-book.json"),
      AKARI_HOME: join(fixtures, "isolated-machine"), HOME: join(fixtures, "isolated-home"),
    }));
    const checks = new Set([
      "word-book.invalid", "word-book.variant-shadowed", "captions.word-book-term",
      "captions.word-book-notation", "captions.word-book-break-fallback",
    ]);
    assert.equal(result.findings.filter(finding => checks.has(finding.check)).length, 0);
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

test("output-domain caption spans source boundaries without cut-visibility projection", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001",
      start: 0.5,
      end: 8.5,
      time_domain: "output",
      text: "収録境界を跨ぐ字幕",
      speaker: null,
      sourceRef: null,
      edited: true,
    }])}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    assert.ok(!result.findings.some((finding) => finding.check === "captions.cut-visibility"));
    assert.ok(!result.findings.some((finding) => finding.check === "captions.schema"));
    assert.ok(!result.findings.some(
      (finding) => finding.check === "captions.output-domain-exceeds-duration",
    ));
  });
});

test("output-domain caption beyond the cuts duration warns about render clamping", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001",
      start: 3,
      end: 12,
      time_domain: "output",
      text: "動画総尺でクランプされる字幕",
      speaker: null,
      sourceRef: null,
      edited: true,
    }])}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    const warning = result.findings.find(
      (finding) => finding.check === "captions.output-domain-exceeds-duration",
    );
    assert.equal(warning.severity, "warning");
    assert.match(warning.message, /動画総尺 10\.0s/u);
    assert.match(warning.message, /10\.0s までにクランプして表示/u);
  });
});

test("既知の caption style_preset は finding を出さない", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕",
      speaker: null, sourceRef: null, edited: true, style_preset: "subtitle-standard",
    }])}\n`, "utf8");
    const result = parseResult(run(project));
    assert.ok(!result.findings.some(finding => finding.check === "captions.style-preset-unknown"));
    assert.ok(!result.findings.some(finding => finding.check === "captions.schema"));
  });
});

test("未知の caption style_preset は warning 1 件と候補最大 5 件を出す", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕",
      speaker: null, sourceRef: null, edited: true, style_preset: "missing-style",
    }])}\n`, "utf8");
    const result = parseResult(run(project));
    const findings = result.findings.filter(finding => finding.check === "captions.style-preset-unknown");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "warning");
    assert.match(findings[0].message, /missing-style/u);
    const candidates = findings[0].message.split("candidates: ")[1]?.split(", ") ?? [];
    assert.ok(candidates.length <= 5);
  });
});

test("presets が無い bundled CLI 相当では存在検査をスキップする", async () => {
  await withFixtures(async (fixtures, root) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕",
      speaker: null, sourceRef: null, edited: true, style_preset: "missing-style",
    }])}\n`, "utf8");
    const result = await lintProject(project, {
      writeReports: false,
      textstyleRepositoryRoot: join(root, "bundle-without-presets"),
    });
    assert.ok(!result.findings.some(finding => finding.check === "captions.style-preset-unknown"));
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
    assert.deepEqual(result.findings.filter((finding) => finding.check.startsWith("v2.")), [{
      id: "F002",
      severity: "warning",
      check: "v2.captions-content-deprecated",
      message: "tracks[].content は deprecated です。visual トラックの items[] に字幕の袋グループ item を置いてください（akari migrate で正規化できます）。",
      path: "edit.json#tracks[2].content",
    }]);
    assert.ok(!result.skipped.some((item) => item.check === "edit.v2.extended-validation"));
  });
});

async function writeAnchorCaptions(project, overrides = {}) {
  const row = {
    id: "c-0001", start: 13, end: 14, text: "アンカー字幕",
    speaker: null, sourceRef: null, edited: false, ...overrides,
  };
  await writeFile(join(project, "captions.json"), `${JSON.stringify([row])}\n`, "utf8");
}

function anchoredHtml(edit, anchor, cache = { at: 30, duration: 60 }) {
  const item = edit.tracks.find(track => track.id === "v-html").items[0];
  Object.assign(item, cache, { anchor });
  return item;
}

test("v2.item-anchor-ref errors when anchor.caption is absent from captions.json", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    anchoredHtml(edit, { caption: "c-9999" });
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await writeAnchorCaptions(project);
    const result = parseResult(run(project));
    assert.ok(result.findings.some(finding => finding.check === "v2.item-anchor-ref"
      && finding.severity === "error"), JSON.stringify(result.findings, null, 2));
  });
});

test("v2.item-anchor-range rejects an interval outside the caption", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    anchoredHtml(edit, { caption: "c-0001", range: { start: 12.5, end: 13.5 } });
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await writeAnchorCaptions(project);
    const result = parseResult(run(project));
    assert.ok(result.findings.some(finding => finding.check === "v2.item-anchor-range"
      && finding.severity === "error"), JSON.stringify(result.findings, null, 2));
  });
});

test("v2.item-anchor-kind rejects anchor on a captions item", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    const item = anchoredHtml(edit, { caption: "c-0001" });
    item.source = { kind: "captions", path: "captions.json" };
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await writeAnchorCaptions(project);
    const result = parseResult(run(project));
    assert.ok(result.findings.some(finding => finding.check === "v2.item-anchor-kind"
      && finding.severity === "error"), JSON.stringify(result.findings, null, 2));
  });
});

test("v2.item-anchor-stale warns with resolved and cached values", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    anchoredHtml(edit, { caption: "c-0001" }, { at: 1, duration: 2 });
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await writeAnchorCaptions(project);
    const result = parseResult(run(project));
    const finding = result.findings.find(entry => entry.check === "v2.item-anchor-stale");
    assert.equal(finding.severity, "warning", JSON.stringify(result.findings, null, 2));
    assert.match(finding.message, /resolves to at=30, duration=30; cached at=1, duration=2/u);
  });
});

test("v2.item-anchor-unresolvable warns when the whole interval is cut", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.tracks.find(track => track.id === "v-main").items = [
      { id: "clip-1", at: 0, duration: 30, source: { kind: "media", src: "main", in: 12, out: 13 } },
      { id: "clip-2", at: 30, duration: 210, source: { kind: "media", src: "main", in: 15, out: 22 } },
    ];
    anchoredHtml(edit, { caption: "c-0001" }, { at: 30, duration: 30 });
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await writeAnchorCaptions(project, { start: 13.5, end: 14.5 });
    const result = parseResult(run(project));
    assert.ok(result.findings.some(finding => finding.check === "v2.item-anchor-unresolvable"
      && finding.severity === "warning"), JSON.stringify(result.findings, null, 2));
  });
});

test("v2 captions track warning covers undeclared, declared, empty cues, and v1 branches", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-valid");
    const editPath = join(project, "edit.json");
    const captionsPath = join(project, "captions.json");
    const declaredEdit = JSON.parse(await readFile(editPath, "utf8"));
    const undeclaredEdit = {
      ...declaredEdit,
      tracks: declaredEdit.tracks.filter(track => track.content?.from !== "captions.json"),
    };
    const renderableCue = [{
      id: "c-0001", start: 0, end: 1, time_domain: "output", text: "字幕",
      speaker: null, sourceRef: null, edited: true,
    }];

    await writeFile(editPath, `${JSON.stringify(undeclaredEdit, null, 2)}\n`, "utf8");
    await writeFile(captionsPath, `${JSON.stringify(renderableCue)}\n`, "utf8");
    const undeclared = parseResult(run(project)).findings.filter(
      finding => finding.check === "v2.captions-track-undeclared",
    );
    assert.equal(undeclared.length, 1);
    assert.equal(undeclared[0].severity, "warning");
    assert.match(undeclared[0].message, /暗黙補完で表示自体はされています/u);
    assert.match(undeclared[0].message, /\{ "id": "captions", "name": "字幕", "at": 0, "duration": <出力尺>, "source": \{ "kind": "captions", "path": "captions\.json" \}, "items": \[\] \}/u);

    await writeFile(editPath, `${JSON.stringify(declaredEdit, null, 2)}\n`, "utf8");
    assert.equal(parseResult(run(project)).findings.filter(
      finding => finding.check === "v2.captions-track-undeclared",
    ).length, 0);

    await writeFile(editPath, `${JSON.stringify(undeclaredEdit, null, 2)}\n`, "utf8");
    await writeFile(captionsPath, '{"captions":[]}\n', "utf8");
    assert.equal(parseResult(run(project)).findings.filter(
      finding => finding.check === "v2.captions-track-undeclared",
    ).length, 0);

    const legacyFindings = [];
    validateCaptionTrackDeclaration({ version: 1, tracks: [] }, renderableCue, legacyFindings);
    assert.equal(legacyFindings.length, 0);
  });
});

test("HTML slot params accept string values (including unmatched future keys) and fail otherwise", async () => {
  await withFixtures(async (fixtures) => {
    const valid = run(join(fixtures, "v2-html-params-valid"));
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(parseResult(valid).verdict, "pass");

    const invalid = run(join(fixtures, "v2-html-params-invalid"));
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.ok(parseResult(invalid).findings.some(finding =>
      finding.check === "v2.html-params" && finding.severity === "error"
    ));
  });
});

for (const [fixture, expectedCheck] of [
  ["v2-id-duplicate-invalid", "v2.id-unique"],
  ["v2-items-content-invalid", "v2.track-content-exclusive"],
  ["v2-track-overlap-invalid", "v2.track-no-overlap"],
  ["v2-audio-track-overlap-invalid", "v2.track-no-overlap"],
  ["v2-lane-source-invalid", "v2.lane-source"],
  ["v2-item-duration-zero-invalid", "v2.item-duration"],
  ["v2-audio-bgm-multiple-invalid", "v2.audio-bgm-multiple"],
  ["v2-audio-bgm-items-invalid", "v2.audio-bgm-multiple"],
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

// Visual duration: 0 represents nothing renderable and must still fail clearly. Audio items are
// intentionally different: migration uses 0 as the unresolved material-duration sentinel.
test("v2-item-duration-zero-invalid reports a clear, purpose-built message naming the field and the rule", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "v2-item-duration-zero-invalid"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    const finding = result.findings.find((entry) => entry.check === "v2.item-duration");
    assert.ok(finding, JSON.stringify(result.findings, null, 2));
    assert.equal(finding.severity, "error");
    assert.equal(finding.message, "item duration must be a positive integer (0 represents nothing on the timeline)");
    assert.equal(finding.path, "edit.json#tracks[0].items[0].duration");
  });
});

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

test("malformed caption unrecognized[] is a captions.schema error", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕", speaker: null,
      sourceRef: null, edited: false, unrecognized: [{ start: 2.2, end: "2.5" }],
    }])}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.ok(result.findings.some((finding) =>
      finding.check === "captions.schema" && /unrecognized span/.test(finding.message)));
  });
});

test("caption 範囲外の unrecognized は warning だけを出す", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕", speaker: null,
      sourceRef: null, edited: false, unrecognized: [{ start: 1.8, end: 2.2 }],
    }])}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    const finding = result.findings.find((item) => item.check === "captions.unrecognized-range");
    assert.equal(finding?.severity, "warning");
    assert.deepEqual(finding?.range, { start: 1.8, end: 2.2 });
  });
});

test("word と重なる unrecognized は warning だけを出す", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([{
      id: "c-0001", src: "s1", start: 2, end: 3, text: "字幕", speaker: null,
      sourceRef: null, edited: false,
      words: [{ start: 2.1, end: 2.5, text: "字幕" }],
      unrecognized: [{ start: 2.4, end: 2.7 }],
    }])}\n`, "utf8");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    const finding = result.findings.find(
      (item) => item.check === "captions.unrecognized-overlaps-word",
    );
    assert.equal(finding?.severity, "warning");
    assert.deepEqual(finding?.range, { start: 2.4, end: 2.7 });
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

test("captions-overlap-invalid detects every caption overlapping the furthest prior end", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-overlap-invalid"));
    assert.equal(executed.status, 1, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "fail");
    const findings = result.findings.filter(
      (finding) => finding.check === "captions.overlap",
    );
    assert.deepEqual(
      findings.map(({ severity, message, path, range }) => ({ severity, message, path, range })),
      [
        {
          severity: "error",
          message: "caption overlaps c-0001 on the same track",
          path: "captions.json#[1]",
          range: { start: 1, end: 2 },
        },
        {
          severity: "error",
          message: "caption overlaps c-0001 on the same track",
          path: "captions.json#[2]",
          range: { start: 3, end: 4 },
        },
      ],
    );
  });
});

test("captions-overlap-adjacent-valid permits captions whose boundaries only touch", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "captions-overlap-adjacent-valid"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.ok(!result.findings.some((finding) => finding.check === "captions.overlap"));
  });
});

test("captions root emphasis_words accepts valid items and reports invalid item paths", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    const captionsPath = join(project, "captions.json");
    const validItem = {
      id: "e-0001",
      src: "s1",
      t_start: 2,
      t_end: 2.5,
      word: "強調",
      emotion: "emphasis",
      style_hint: "size-pulse",
    };
    await writeFile(
      captionsPath,
      `${JSON.stringify({ emphasis_words: [validItem], captions: [] })}\n`,
      "utf8",
    );
    const validResult = parseResult(run(project));
    assert.equal(
      validResult.findings.filter((finding) => finding.severity === "error").length,
      0,
      JSON.stringify(validResult.findings, null, 2),
    );

    await writeFile(
      captionsPath,
      `${JSON.stringify({ emphasis_words: [{ ...validItem, id: "invalid" }], captions: [] })}\n`,
      "utf8",
    );
    const invalidResult = parseResult(run(project));
    const schemaErrors = invalidResult.findings.filter(
      (finding) => finding.severity === "error" && finding.check === "captions.schema",
    );
    assert.equal(schemaErrors.length, 1, JSON.stringify(invalidResult.findings, null, 2));
    assert.equal(schemaErrors[0].path, "captions.json#emphasis_words[0]");
  });
});

test("captions overlap and order are isolated by source", async () => {
  await withFixtures(async (_fixtures, root) => {
    const project = join(root, "multisource-captions");
    await cp(join(fixtureRoot, "v1-valid"), project, { recursive: true });
    const editPath = join(project, "edit.json");
    const edit = JSON.parse(await readFile(editPath, "utf8"));
    edit.cuts = [
      { src: "s1", in: 0, out: 10 },
      { src: "s2", in: 0, out: 10 },
    ];
    await writeFile(editPath, `${JSON.stringify(edit)}\n`, "utf8");
    await migrateFixtureTree(project);
    await writeFile(join(project, "captions.json"), `${JSON.stringify([
      { id: "c-0001", src: "s1", start: 0, end: 2, text: "A1", speaker: null, sourceRef: null, edited: false },
      { id: "c-0002", src: "s2", start: 1, end: 3, text: "B1", speaker: null, sourceRef: null, edited: false },
      { id: "c-0003", src: "s1", start: 2, end: 4, text: "A2", speaker: null, sourceRef: null, edited: false },
      { id: "c-0004", src: "s2", start: 3, end: 5, text: "B2", speaker: null, sourceRef: null, edited: false },
    ])}\n`, "utf8");
    const result = parseResult(run(project));
    assert.equal(
      result.findings.filter(
        (finding) => finding.check === "captions.overlap" || finding.check === "captions.order",
      ).length,
      0,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions overlap remains an error within the same source", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v1-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([
      { id: "c-0001", src: "s1", start: 2, end: 4, text: "A1", speaker: null, sourceRef: null, edited: false },
      { id: "c-0002", src: "s1", start: 3, end: 5, text: "A2", speaker: null, sourceRef: null, edited: false },
    ])}\n`, "utf8");
    const result = parseResult(run(project));
    assert.equal(
      result.findings.filter((finding) => finding.check === "captions.overlap").length,
      1,
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("captions overlap remains an error for array-root captions without src", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "captions-overlap-adjacent-valid");
    await writeFile(join(project, "captions.json"), `${JSON.stringify([
      { id: "c-0001", start: 0, end: 2, text: "A", speaker: null, sourceRef: null, edited: false },
      { id: "c-0002", start: 1, end: 3, text: "B", speaker: null, sourceRef: null, edited: false },
    ])}\n`, "utf8");
    const result = parseResult(run(project));
    assert.equal(
      result.findings.filter((finding) => finding.check === "captions.overlap").length,
      1,
      JSON.stringify(result.findings, null, 2),
    );
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

test("narration with bgm passes from item-level audio roles", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "narration-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
  });
});

for (const [fixture, expectedCheck] of [
  ["narration-gain-out-of-range", "audio.narration.gain-db"],
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
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
  });
});

test("bgm + sfx (2 items) all resolving to real files pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "bgm-sfx-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
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
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings, null, 2));
  });
});

test("cuts[].speed + transition_out + output.look + source.chroma_key + audio.master pass with zero findings", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "render-basics-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
  });
});

test("cuts[].transition_out は正準 29 種をすべて受理し未知種別を拒否する", async () => {
  const root = await mkdtemp(join(tmpdir(), "edit-lint-transition-vocabulary-"));
  try {
    const editPath = join(root, "edit.json");
    const editFor = (type) => ({
      version: 2,
      output: { width: 1280, height: 720, fps: 30 },
      sources: [{ id: "main", path: "source.mp4", proxy: null }],
      tracks: [
        { id: "v-main", lane: "visual", items: [
          { id: "cut-1", at: 0, duration: 60, source: {
            kind: "media", src: "main", in: 0, out: 2,
            transition_out: { type, duration: 0.5 },
          } },
          { id: "cut-2", at: 45, duration: 60, source: {
            kind: "media", src: "main", in: 2, out: 4,
          } },
        ] },
      ],
    });
    for (const type of TRANSITION_TYPE_IDS) {
      await writeFile(editPath, `${JSON.stringify(editFor(type))}\n`);
      const result = parseResult(run(root));
      assert.equal(
        result.findings.some((finding) => finding.check === "cuts.transition-out.type"),
        false,
        type,
      );
    }
    await writeFile(editPath, `${JSON.stringify(editFor("future-transition"))}\n`);
    const invalid = parseResult(run(root));
    assert.equal(
      invalid.findings.some((finding) => finding.check === "cuts.transition-out.type"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cuts[].freeze extends the timeline used by overlays", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "freeze-extends-timeline-valid");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
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
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
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
    assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings));
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
  ["cuts-track-overlap-invalid", "v2.track-no-overlap"],
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
      assert.equal(withoutGeometryNotice(result.findings).length, 0, JSON.stringify(result.findings, null, 2));
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
    assert.ok(result.findings.some(finding => finding.check === "v2.track-no-overlap" && finding.severity === "error"), JSON.stringify(result.findings, null, 2));
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
  "timeline-tracks-empty-declared-track",
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

// timeline.tracks.ref-missing 撤去の固定（2026-08-20 cleanup-migrate-lint task）。
// この規則は「宣言された段の ref が実データのどこにも現れなければ警告」で、v0/v1 の
// timeline.tracks 契約導入時から入っていたが、v2 では段の ref が宣言順の連番で毎回生成し
// 直されるため、この警告は「段の中身が 0 個」としか等価にならない。空の段は error ではなく、
// 保存時に削除される旨を v2.empty-track の info で案内する。
// timeline-tracks-empty-declared-track fixture は t2（kind: layers, ref: 9）を宣言しつつ
// 実データに layers を 1 つも持たない、まさにこの「空の段」を再現する。ここで固定しておかないと
// v0/v1 時代の直感から再導入されうる。
test("空の段を持つ v2 プロジェクトは v2.empty-track の info だけを返す", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "timeline-tracks-empty-declared-track"));
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.deepEqual(withoutGeometryNotice(result.findings), [{
      id: "F002",
      severity: "info",
      check: "v2.empty-track",
      message: "empty track will be removed by canonical save",
      path: "edit.json#tracks[1]",
    }], JSON.stringify(result.findings, null, 2));
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

test("fieldtest-shaped v2 non-default track order without transition_out stays clean", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-nondefault-no-transition-valid");
    const raw = JSON.parse(await readFile(join(project, "edit.json"), "utf8"));
    const internal = readInternalEdit(raw);
    const projected = projectLegacyEdit(internal);
    assert.equal(projected.cuts.length, 2);

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.ok(
      !result.findings.some((finding) => finding.check === "cuts.track-transition-unsupported"),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("2026-08-23 cuts-cross-track-overlap 後は PiP 側だけが layers へ退避され、cuts 側 transition は生きる", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-pip-transition-invalid");
    const raw = JSON.parse(await readFile(join(project, "edit.json"), "utf8"));
    const internal = readInternalEdit(raw);
    const projected = projectLegacyEdit(internal);
    // 2026-08-23 の投影変更により、transform.scale 0.25 の pip だけが layers へ退避する。
    // transition_out を持つ cut-a / cut-b は cuts に残り、実際に xfade 可能なので PASS が正しい。
    assert.deepEqual(projected.layers.map(layer => layer.id), ["pip"]);
    assert.deepEqual(projected.cuts.map(cut => cut.src), ["a", "b"]);
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    assert.equal(result.verdict, "pass");
    assert.deepEqual(withoutGeometryNotice(result.findings), []);
  });
});

test("transition_out 宣言つき item 自身が layers へ退避されたら相手 id 付き warning になる", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "v2-layer-evacuated-transition-warning"));
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    const finding = result.findings.find(candidate =>
      candidate.check === "cuts.transition-out.layer-evacuated"
    );
    assert.ok(finding, JSON.stringify(result.findings, null, 2));
    assert.equal(finding.severity, "warning");
    assert.match(finding.message, /他トラックのアイテム（bg-1）.*PiP 経路へ退避/u);
    assert.match(finding.message, /重なりを解消するか、トランジションを削除/u);
    assert.match(finding.path, /tracks\[1\]\.items\[0\]/u);
  });
});

test("重なり 0 の transition_out だけを warning にし、重なり済み・宣言なしは誤検知しない", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-zero-overlap-transition-warning");
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    const zero = result.findings.filter(finding => finding.check === "cuts.transition-out.zero-overlap");
    assert.equal(zero.length, 1, JSON.stringify(result.findings, null, 2));
    assert.equal(zero[0].severity, "warning");
    assert.match(zero[0].message, /のりしろにできる素材の余りがないため効きません/u);

    const editPath = join(project, "edit.json");
    const raw = JSON.parse(await readFile(editPath, "utf8"));
    raw.tracks[0].items[1].source.in = 1;
    raw.tracks[0].items[1].source.out = 3;
    await writeFile(editPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const hiddenHandle = parseResult(run(project));
    assert.equal(
      hiddenHandle.findings.filter(finding => finding.check === "cuts.transition-out.zero-overlap").length,
      0,
      JSON.stringify(hiddenHandle.findings, null, 2),
    );

    raw.tracks[0].items[1].source.in = 0;
    raw.tracks[0].items[1].source.out = 2;
    raw.tracks[0].items[0].duration = 75;
    raw.tracks[0].items[0].source.out = 2.5;
    await writeFile(editPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const overlapped = parseResult(run(project));
    assert.equal(withoutGeometryNotice(overlapped.findings).length, 0, JSON.stringify(overlapped.findings, null, 2));

    delete raw.tracks[0].items[0].source.transition_out;
    raw.tracks[0].items[0].duration = 60;
    raw.tracks[0].items[0].source.out = 2;
    await writeFile(editPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    const undeclared = parseResult(run(project));
    assert.equal(withoutGeometryNotice(undeclared.findings).length, 0, JSON.stringify(undeclared.findings, null, 2));
  });
});

test("v2 の gap をまたぐ transition_out は日本語で事前に fail する", async () => {
  await withFixtures(async (fixtures) => {
    const executed = run(join(fixtures, "v2-gap-transition-invalid"));
    assert.equal(executed.status, 1, executed.stderr || executed.stdout);
    const result = parseResult(executed);
    const finding = result.findings.find(candidate =>
      candidate.check === "cuts.transition-out.non-adjacent"
    );
    assert.ok(finding, JSON.stringify(result.findings, null, 2));
    assert.match(finding.message, /次のクリップとの間にすき間.*すき間を詰める/);
  });
});

test("v2 top-level BGM without a declared audio lane does not create declaration-missing projection noise", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "v2-nondefault-no-transition-valid");
    const editPath = join(project, "edit.json");
    const raw = JSON.parse(await readFile(editPath, "utf8"));
    raw.audio = { bgm: { path: "../bgm-sfx-valid/audio/bgm.wav", gain_db: -12 } };
    await writeFile(editPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr);
    const result = parseResult(executed);
    assert.ok(
      !result.findings.some(finding => finding.check === "timeline.tracks.declaration-missing"
        && finding.path.includes("audio")),
      JSON.stringify(result.findings, null, 2),
    );
  });
});

test("a genuine transition_out in a legacy-shaped fixture remains detected", async () => {
  const legacy = JSON.parse(await readFile(
    join(fixtureRoot, "cuts-track-transition-invalid", "edit.json"),
    "utf8",
  ));
  const findings = [];
  validateTrackTransitionOutCompatibility(legacy, findings);
  assert.ok(
    findings.some((finding) => finding.check === "cuts.track-transition-unsupported"),
    JSON.stringify(findings, null, 2),
  );
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

// issue #40 §2（2026-09-01）: zone 方式の基準出力高さ reference_height_px。
test("text_style.reference_height_px lints as an integer >= 1 and cannot combine with layout", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    const captionsPath = join(project, "captions.json");
    const baseCaption = { ...styleParity.caption, start: 5, end: 7 };
    await writeFile(captionsPath, `${JSON.stringify({
      default_text_style: { zone: "bottom", size_px: 36, reference_height_px: 720 },
      captions: [{ ...baseCaption, text_style: { reference_height_px: 1080, size_px: 54 } }],
    }, null, 2)}\n`, "utf8");
    const valid = run(project);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.ok(!parseResult(valid).findings.some((finding) => finding.check === "captions.text-style"));

    const message = /reference_height_px must be an integer greater than or equal to one/u;
    for (const [id, text_style, expected] of [
      ["zero", { reference_height_px: 0 }, message],
      ["negative", { reference_height_px: -720 }, message],
      ["fraction", { reference_height_px: 720.5 }, message],
      ["string", { reference_height_px: "720" }, message],
      ["layout-conflict", { reference_height_px: 720, layout: styleParity.valid_default_style.layout }, /cannot contain both layout and reference_height_px/u],
    ]) {
      await writeFile(captionsPath, `${JSON.stringify([{ ...baseCaption, text_style }], null, 2)}\n`, "utf8");
      const executed = run(project);
      assert.equal(executed.status, 1, `${id}: ${executed.stderr}`);
      assert.ok(parseResult(executed).findings.some((finding) =>
        finding.check === "captions.text-style" && expected.test(finding.message)
      ), `${id}: ${executed.stdout}`);
    }
  });
});

test("max_characters accepts default and per-caption positive integers", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    await writeFile(join(project, "captions.json"), JSON.stringify({
      default_text_style: { max_characters: 12 },
      captions: [{ ...styleParity.caption, start: 5, end: 7, text_style: { max_characters: 8 } }],
    }));
    const executed = run(project);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.ok(!parseResult(executed).findings.some(finding => finding.check === "captions.text-style"));
  });
});

test("max_characters rejects invalid values in default and per-caption styles", async () => {
  await withFixtures(async (fixtures) => {
    const project = join(fixtures, "valid");
    for (const value of [0, -1, 1.5, "12", null, true]) {
      for (const isDefault of [true, false]) {
        await writeFile(join(project, "captions.json"), JSON.stringify({
          ...(isDefault ? { default_text_style: { max_characters: value } } : {}),
          captions: [{ ...styleParity.caption, start: 5, end: 7,
            ...(!isDefault ? { text_style: { max_characters: value } } : {}) }],
        }));
        const executed = run(project);
        assert.equal(executed.status, 1, executed.stderr || executed.stdout);
        assert.ok(parseResult(executed).findings.some(finding =>
          finding.check === "captions.text-style"
          && /max_characters must be an integer greater than zero/u.test(finding.message)
        ), `${isDefault ? "default" : "caption"}: ${JSON.stringify(value)}`);
      }
    }
  });
});
