import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examples = join(root, "examples");
const cli = join(root, "bin", "validate-world-map.mjs");
const schema = read(join(root, "world-map.schema.json"));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const validNames = ["world-map-v3-flat-valid", "world-map-v3-spatial-valid"];
const invalidCases = new Map([
  ["world-map-v3-invalid-c3-edge-timing", "C3"],
  ["world-map-v3-invalid-c5-carry", "C5"],
  ["world-map-v3-invalid-c6-push-in-spatial", "C6"],
  ["world-map-v3-invalid-c7-cut-cover-null", "C7"],
  ["world-map-v3-invalid-c10-same-world-portal", "C10"],
]);

for (const name of [...validNames, ...invalidCases.keys()]) {
  test(`${name} は world-map v3 スキーマに適合する`, () => {
    assert.equal(validate(fixture(name)), true, JSON.stringify(validate.errors));
  });
}

test("スキーマは版・kind・色・未知キー・kind 固有部を拒否する", () => {
  const mutations = [
    (map) => { map.schemaVersion = 2; },
    (map) => { map.kind = "cube"; },
    (map) => { map.worlds[0].palette.accent = "#abc"; },
    (map) => { map.worlds[0].unknown = true; },
    (map) => { delete map.worlds[0].flat; },
  ];
  for (const mutate of mutations) {
    const map = fixture(validNames[0]);
    mutate(map);
    assert.equal(validate(map), false);
  }
});

for (const name of validNames) {
  test(`${name} は strict CLI で通る`, () => {
    const result = run(name, "--strict");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^OK: /);
  });
}

for (const [name, code] of invalidCases) {
  test(`${name} は ${code} だけで落ちる`, () => {
    const args = ["--json", ...(code === "C7" ? ["--strict"] : [])];
    const result = run(name, ...args);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.errors.map((finding) => finding.code), [code]);
  });
}

test("C7 の null は非 strict では warning だけになる", () => {
  const result = run("world-map-v3-invalid-c7-cut-cover-null", "--json");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings.map((finding) => finding.code), ["C7"]);
});

for (const name of ["world-map-v2-flat-legacy", "world-map-v2-spatial-legacy", "world-map-v1-no-worlds-legacy"]) {
  test(`${name} は migrate で v3 JSON を標準出力へ出す`, () => {
    const result = run(name, "--migrate");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).schemaVersion, 3);
  });
}

test("CLI の使い方と存在しない入力の exit code", () => {
  assert.equal(spawnSync(process.execPath, [cli], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, "--unknown"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, join(examples, "missing")], { encoding: "utf8" }).status, 1);
});

test("CLI は object でない JSON をスタックトレースなしで拒否する", () => {
  for (const value of [null, [], 42, "world"]) {
    const result = validateTemporary(value);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^NG: /);
    assert.match(result.stderr, /^\[IO\] ルートは object である必要があります\n$/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /TypeError|\bat\s+file:/);
  }
});

test("CLI は schemaVersion 3 より新しい形式を正規化せず停止する", () => {
  const result = validateTemporary({ schemaVersion: 9 }, "--migrate");
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[IO\] schemaVersion 9 は新しすぎるため検証できません。このファイルは新しい形式です。スキル \/ アプリを更新してください/);
  assert.doesNotMatch(result.stderr, /TypeError|\bat\s+file:/);
});

function fixture(name) { return read(join(examples, name, "planning", "world-map.json")); }
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(name, ...args) { return spawnSync(process.execPath, [cli, join(examples, name), ...args], { encoding: "utf8" }); }
function validateTemporary(value, ...args) {
  const temporary = fs.mkdtempSync(join(os.tmpdir(), "world-map-schema-"));
  const target = join(temporary, "world-map.json");
  try {
    fs.writeFileSync(target, JSON.stringify(value));
    return spawnSync(process.execPath, [cli, target, ...args], { encoding: "utf8" });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
