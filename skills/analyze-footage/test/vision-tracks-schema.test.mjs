// vision-tracks.schema.json（契約 §2 の形式）の examples 検証テスト。
//
// ajv は packages/schemas/test/validate-cut-candidates.test.mjs などリポジトリ自身の
// 検証基盤が既に使っている（devDependencies 経由）。CLI 本体（vision-tracks.mjs）は
// 「外部 npm 依存ゼロ」原則を守るが、それはユーザープロジェクトへ配布されるツール本体の
// 話であり、モノレポ自身の node --test（この test/ ディレクトリ）はその制約の対象外
// （既存の packages/schemas のテストと同じ扱い）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../references/vision-tracks.schema.json");
const fixturesDir = resolve(here, "fixtures/vision-tracks");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

function loadFixture(name) {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8"));
}

test("vision-tracks.schema.json 自体が Draft 2020-12 として妥当（strict コンパイルが通る）", () => {
  assert.doesNotThrow(() => new Ajv2020({ strict: true }).compile(schema));
});

test("契約 §2.1 の face-landmarks 例は妥当", () => {
  const ok = validate(loadFixture("example-face-landmarks.json"));
  assert.equal(ok, true, JSON.stringify(validate.errors));
});

test("face_contour は additive な任意点列として受理し、従来の contour 無し例も妥当", () => {
  const legacy = loadFixture("example-face-landmarks.json");
  assert.equal(validate(legacy), true, JSON.stringify(validate.errors));
  legacy.samples[0].detections[0].landmarks.face_contour = [
    [0.66, 0.29], [0.68, 0.46], [0.78, 0.55], [0.88, 0.46], [0.9, 0.29],
  ];
  legacy.samples[0].detections[0].landmarks.left_eyebrow = [[0.7, 0.28], [0.75, 0.26]];
  legacy.samples[0].detections[0].landmarks.right_eyebrow = [[0.82, 0.26], [0.87, 0.28]];
  assert.equal(validate(legacy), true, JSON.stringify(validate.errors));
});

test("契約 §2.2 の hand-pose 例は妥当", () => {
  const ok = validate(loadFixture("example-hand-pose.json"));
  assert.equal(ok, true, JSON.stringify(validate.errors));
});

test("face-landmarks の v0 必須 6 領域のいずれかが欠けると拒否する", () => {
  const ok = validate(loadFixture("invalid-missing-required-landmark.json"));
  assert.equal(ok, false);
  assert.ok(
    validate.errors.some((e) => e.keyword === "required" && e.params.missingProperty === "inner_lips"),
    JSON.stringify(validate.errors),
  );
});

test("座標が 0〜1 の範囲外だと拒否する", () => {
  const ok = validate(loadFixture("invalid-out-of-range-coordinate.json"));
  assert.equal(ok, false);
  assert.ok(
    validate.errors.some((e) => e.schemaPath.includes("/$defs/unit/maximum")),
    JSON.stringify(validate.errors),
  );
});

test("kind が face-landmarks / hand-pose 以外だと拒否する", () => {
  const ok = validate(loadFixture("invalid-unknown-kind.json"));
  assert.equal(ok, false);
  assert.ok(
    validate.errors.some((e) => e.instancePath === "/kind" && e.keyword === "enum"),
    JSON.stringify(validate.errors),
  );
});

test("version が 0 以外だと拒否する（データ契約版管理・追加のみ進化の原則）", () => {
  const example = loadFixture("example-face-landmarks.json");
  example.version = 1;
  const ok = validate(example);
  assert.equal(ok, false);
});

test("トップレベルに未知フィールドを足すと拒否する（additionalProperties: false）", () => {
  const example = loadFixture("example-hand-pose.json");
  example.extra_field = "should not be allowed";
  const ok = validate(example);
  assert.equal(ok, false);
});

test("検出ゼロのフレーム（detections: []）は妥当 — t は残る（欠測と非検出の区別・契約 §2）", () => {
  const example = loadFixture("example-face-landmarks.json");
  const ok = validate(example);
  assert.equal(ok, true);
  assert.deepEqual(example.samples[1].detections, []);
  assert.equal(typeof example.samples[1].t, "number");
});
