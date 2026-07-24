import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-recipe.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "recipe");
const exampleRoot = join(packageRoot, "examples", "recipe-v0-sample");

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture, "recipe.json")], {
    encoding: "utf8",
  });
}

test("example recipe-v0-sample passes", () => {
  const executed = spawnSync(
    process.execPath,
    [cliPath, join(exampleRoot, "product-demo-quick-cuts.json")],
    { encoding: "utf8" },
  );
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("valid recipe passes without findings", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("unknown top-level and confirmed fields still pass when provenance still matches (tolerant reader)", () => {
  const executed = run("valid-unknown-fields");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("missing version fails", () => {
  const executed = run("invalid-missing-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /version は必須です/);
});

test("newer recipe.json version stops honestly", () => {
  const executed = run("unsupported-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /新しい形式です。スキル \/ アプリを更新してください/);
});

test("empty confirmed fails (nothing confirmed means no reason to freeze)", () => {
  const executed = run("invalid-empty-confirmed");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confirmed は少なくとも 1 件の確認済みフィールドを持つ必要があります/);
});

test("unknown aspect value fails", () => {
  const executed = run("invalid-bad-aspect");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confirmed\.aspect は 16:9 \/ 9:16 \/ 1:1/);
});

test("unknown workflow value fails", () => {
  const executed = run("invalid-bad-workflow");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /workflow は edit \/ research/);
});

test("path-like source_project fails", () => {
  const executed = run("invalid-source-project-path");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /source_project はパスではなく/);
});

test("confirmed/provenance key mismatch fails in both directions", () => {
  const executed = run("invalid-provenance-mismatch");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /provenance\.bgm_profile が欠けています/);
  assert.match(executed.stderr, /provenance\.caption_style_ref に対応する confirmed\.caption_style_ref がありません/);
});

test("non-kebab-case name fails", () => {
  const executed = run("invalid-bad-name-casing");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /name は kebab-case/);
});

test("unknown confirmed_by value fails", () => {
  const executed = run("invalid-bad-confirmed-by");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confirmed_by は intake \/ structure-confirm \/ edit-approval \/ render-approval/);
});

test("empty narration object fails", () => {
  const executed = run("invalid-empty-narration");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confirmed\.narration は engine または voice のうち少なくとも 1 件/);
});

test("duplicate overlay_kinds entry fails", () => {
  const executed = run("invalid-duplicate-overlay-kind");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /confirmed\.overlay_kinds に重複した値があります: telop/);
});
