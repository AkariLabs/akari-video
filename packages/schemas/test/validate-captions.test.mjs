import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const cliPath = join(packageRoot, "bin", "validate-captions.mjs");
const exampleRoot = join(packageRoot, "examples");
const styleParity = JSON.parse(readFileSync(join(
  repositoryRoot, "packages/edit-store/test/fixtures/caption-style-validation-parity.json"
), "utf8"));

function runPath(captionsPath) {
  return spawnSync(process.execPath, [cliPath, captionsPath], { encoding: "utf8" });
}

function run(exampleDir) {
  return runPath(join(exampleRoot, exampleDir, "captions.json"));
}

function runValue(value) {
  const directory = mkdtempSync(join(tmpdir(), "akari-captions-schema-"));
  const path = join(directory, "captions.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return runPath(path);
}

for (const example of [
  "captions-text-style-omitted-valid",
  "captions-text-style-default-only-valid",
  "captions-text-style-record-override-valid",
]) {
  test(`${example} passes`, () => {
    const executed = run(example);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  });
}

for (const [example, message] of [
  ["captions-text-style-opacity-out-of-range-invalid", /background\.opacity/],
  ["captions-text-style-background-mode-invalid", /background\.mode/],
  ["captions-text-style-zone-invalid", /\.zone/],
  ["captions-text-style-size-non-positive-invalid", /\.size_px/],
  ["captions-text-style-color-non-hex-invalid", /\.color/],
]) {
  test(`${example} fails deterministically`, () => {
    const executed = run(example);
    assert.equal(executed.status, 1, executed.stdout);
    assert.match(executed.stderr, /^NG: /);
    assert.match(executed.stderr, message);
  });
}

test("captions object root accepts emphasis_words with the v1 record shape", () => {
  const executed = run("captions-emphasis-words-valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

for (const [example, message] of [
  ["captions-emphasis-words-invalid-id", /emphasis_words\[0\]\.id は e- に続く 4 桁/u],
  ["captions-emphasis-words-empty-word", /emphasis_words\[0\]\.word は空でない文字列/u],
  ["captions-emphasis-words-missing-emotion", /emphasis_words\[0\]\.emotion は空でない文字列/u],
]) {
  test(`${example} fails deterministically`, () => {
    const executed = run(example);
    assert.equal(executed.status, 1, executed.stdout);
    assert.match(executed.stderr, /^NG: /);
    assert.match(executed.stderr, message);
  });
}

test("captions emphasis_words requires t_end > t_start", () => {
  const executed = run("captions-emphasis-words-range-invalid");
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /emphasis_words\[0\]\.t_end は t_start より大きい/u);
  assert.match(executed.stderr, /emphasis_words\[1\]\.t_end は t_start より大きい/u);
});

test("captions array root has no emphasis_words seat", () => {
  const executed = runValue([{
    ...caption,
    emphasis_words: [{
      id: "e-0001", t_start: 0, t_end: 1, word: "今回", emotion: "emphasis",
    }],
  }]);
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /captions\[0\] に未知のキーがあります: emphasis_words/u);
});

for (const captionsPath of [
  "packages/edit-lint/fixtures/captions-words-valid/captions.json",
  "packages/edit-lint/fixtures/captions-reveal-valid/captions.json",
  "packages/edit-lint/fixtures/captions-display-text-valid/captions.json",
  "skills/address-review/dev-fixtures/fixture-project/captions.json",
  "apps/shell/extensions/akari-annotations/evidence/timeline-tracks/fixture/captions.json",
]) {
  test(`existing captions remain valid unchanged: ${captionsPath}`, () => {
    const executed = runPath(join(repositoryRoot, captionsPath));
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /^OK: /);
  });
}

const caption = {
  id: "c-0001",
  start: 0,
  end: 2,
  text: "今回設定します",
  speaker: null,
  sourceRef: { segment: 0 },
  edited: false,
};

const displayPolicy = {
  mode: "single_line_sequential",
  algorithm: "a4-ja-two-fragment-v1",
  unit_metric: "ascii-half-other-one-v1",
  max_line_units: 6,
  minimum_fragment_duration_seconds: 0.72,
  locale: "ja",
  break_hints: {
    preferred_second_starts: ["設定"],
    preferred_first_ends: ["です"],
    protected_terms: ["Claude Code"],
  },
};

test("display policy, manual fragments, and reference-pixel style pass together", () => {
  const executed = runValue({
    display_policy: displayPolicy,
    default_text_style: {
      size_px: 82,
      font_weight: 600,
      line_height: 1.08,
      stroke: { method: "webkit-outline", color: "#050505", width_px: 5 },
      layout: {
        mode: "reference-pixel",
        reference_width_px: 1920,
        reference_height_px: 1080,
        left_px: 261,
        width_px: 1120,
        bottom_px: 29,
        text_align: "center",
        max_lines: 1,
      },
    },
    captions: [{ ...caption, display_fragments: ["今回", "設定します"] }],
  });
  assert.equal(executed.status, 0, executed.stderr);
});

test("display fragments fail closed on text loss, style conflict, and non-NFC text", () => {
  for (const [override, message] of [
    [{ display_fragments: ["今回", "設定"] }, /表示文字列を厳密に保存/u],
    [{ display_fragments: ["今回", "設定します"], style: "karaoke" }, /display_policy と併用できません/u],
    [{ text: "e\u0301", display_fragments: ["e\u0301"] }, /NFC/u],
  ]) {
    const executed = runValue({ display_policy: displayPolicy, captions: [{ ...caption, ...override }] });
    assert.equal(executed.status, 1, executed.stdout);
    assert.match(executed.stderr, message);
  }
});

test("reference-pixel geometry rejects an overflowing box and unsupported max_lines", () => {
  const executed = runValue({
    default_text_style: {
      layout: {
        mode: "reference-pixel",
        reference_width_px: 1920,
        reference_height_px: 1080,
        left_px: 1000,
        width_px: 1000,
        bottom_px: 29,
        text_align: "center",
        max_lines: 2,
      },
    },
    captions: [caption],
  });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /参照幅内/u);
  assert.match(executed.stderr, /max_lines=1/u);
});

test("shared opt-in text-style parity matrix matches the schema validator", () => {
  for (const item of styleParity.valid_style_cases) {
    const executed = runValue({
      display_policy: styleParity.display_policy,
      default_text_style: item.style,
      captions: [styleParity.caption],
    });
    assert.equal(executed.status, 0, `${item.id}: ${executed.stderr}`);
  }
  for (const item of styleParity.invalid_cases) {
    const executed = runValue(styleRootForCase(item));
    assert.equal(executed.status, 1, `${item.id}: ${executed.stdout}`);
    assert.match(executed.stderr, /^NG: /u, item.id);
  }
});

test("shared caption-style contract accepts reveal-word and rejects an unknown value", () => {
  const accepted = runValue({
    captions: [{ ...styleParity.caption, style: styleParity.caption_style_contract.accepted.style }],
  });
  assert.equal(accepted.status, 0, accepted.stderr);

  const unknown = runValue({
    captions: [{ ...styleParity.caption, style: styleParity.caption_style_contract.unknown.style }],
  });
  assert.equal(unknown.status, 1, unknown.stdout);
  assert.match(unknown.stderr, /karaoke\/pop\/reveal\/reveal-word/u);
});

function styleRootForCase(item) {
  const root = {
    display_policy: styleParity.display_policy,
    default_text_style: styleParity.valid_default_style,
    captions: [{ ...styleParity.caption, text_style: { color: "#FFF4D6" } }],
  };
  if (Object.hasOwn(item, "default_text_style")) root.default_text_style = item.default_text_style;
  if (Object.hasOwn(item, "caption_text_style")) root.captions[0].text_style = item.caption_text_style;
  return root;
}
