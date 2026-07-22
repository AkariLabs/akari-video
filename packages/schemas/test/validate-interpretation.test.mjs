import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-interpretation.mjs");
const fixtureRoot = join(packageRoot, "test", "fixtures", "interpretation");

function run(caseName) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, caseName, "interpretation.json")], {
    encoding: "utf8",
  });
}

test("valid multi-asset interpretation.json passes", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("newer interpretation.json version stops honestly", () => {
  const executed = run("unsupported-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /新しい形式です。スキル \/ アプリを更新してください/);
});

test("missing arc[].evidence fails (evidence required for arc, per 司令塔裁定 8)", () => {
  const executed = run("invalid-missing-required-field");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /arc\[0\]\.evidence は必須です/);
});

test("dogfood-style underscore field is rejected at the root (裁定 7, additionalProperties: false)", () => {
  const executed = run("invalid-unknown-root-field");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /ルート\._dogfood_note は未定義のフィールドです/);
});

test("flags[].type outside the enum fails (裁定 1)", () => {
  const executed = run("invalid-flag-bad-type");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /assets\[0\]\.flags\[0\]\.type は orphan \/ unclear \/ trouble_overlap のいずれかである必要があります/,
  );
});

test("flags[].evidence is required (裁定 1, 8)", () => {
  const executed = run("invalid-flag-missing-evidence");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /assets\[0\]\.flags\[0\]\.evidence は必須です/);
});

test("open_questions[].answer is required when status is answered (裁定 5)", () => {
  const executed = run("invalid-open-question-answered-without-answer");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /open_questions\[0\]\.answer は status が answered のとき必須です/);
});

test("open_questions[].answer must be omitted (not present) when status is open (裁定 2, 5)", () => {
  const executed = run("invalid-open-question-answer-present-when-open");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /open_questions\[1\]\.answer は status が open のとき省略する必要があります（null にしない）/,
  );
});

test("arc[].refs requires at least one entry (裁定 8)", () => {
  const executed = run("invalid-arc-empty-refs");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /arc\[0\]\.refs は 1 件以上の配列である必要があります/);
});

test("arc[].refs[].asset must reference an existing assets[].ref", () => {
  const executed = run("invalid-dangling-arc-ref");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /arc\[0\]\.refs\[0\]\.asset が assets\[\]\.ref を参照していません: asset-does-not-exist/,
  );
});

test("inputs.analyses[].ref is required (2026-07-22 A3.2 swap 実証を受けた FK 化)", () => {
  const executed = run("invalid-analyses-missing-ref");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /inputs\.analyses\[0\]\.ref は必須です/);
});

test("inputs.analyses[].ref must correspond 1:1 with assets[].ref (no shortfall/surplus on either side)", () => {
  const executed = run("invalid-analyses-ref-mismatch");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /inputs\.analyses\[\]\.ref が assets\[\]\.ref に存在しません: broll-park-typo/,
  );
  assert.match(
    executed.stderr,
    /assets\[\]\.ref に対応する inputs\.analyses\[\]\.ref がありません: broll-park/,
  );
});

test("duplicate assets[].ref is rejected", () => {
  const executed = run("invalid-duplicate-asset-ref");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /assets\[\]\.ref が重複しています: interview-a/);
});

test("relations[].target must reference an existing assets[].ref", () => {
  const executed = run("invalid-relations-dangling-target");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /assets\[0\]\.relations\[0\]\.target が assets\[\]\.ref を参照していません: asset-does-not-exist/,
  );
});

test("relations[].target cannot self-reference its own asset", () => {
  const executed = run("invalid-relations-self-reference");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /assets\[0\]\.relations\[0\]\.target が自素材への自己参照になっています: interview-a/,
  );
});

test("optional context.intake must be omitted, not null (裁定 2)", () => {
  const executed = run("invalid-context-null-intake");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /inputs\.context\.intake は object である必要があります（省略可。null にしない）/,
  );
});

test("context.interview key is required whenever context is present (裁定 9)", () => {
  const executed = run("invalid-context-missing-interview");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /inputs\.context\.interview は必須です/);
});

test("sections[] start/end must both be present or both be omitted", () => {
  const executed = run("invalid-section-mismatched-start-end");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /assets\[0\]\.sections\[0\] は start\/end を両方指定するか、両方省略する必要があります/,
  );
});

test("sections[] end must be greater than start", () => {
  const executed = run("invalid-section-end-before-start");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /assets\[0\]\.sections\[0\] は end > start を満たす必要があります/);
});

test("missing input file fails with a clear message", () => {
  const executed = spawnSync(
    process.execPath,
    [cliPath, join(fixtureRoot, "does-not-exist", "interpretation.json")],
    { encoding: "utf8" },
  );
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /interpretation\.json が見つかりません/);
});
