import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(packageRoot, "gen-models.json");
const schemaPath = join(packageRoot, "gen-models.schema.json");
const cliPath = join(packageRoot, "bin", "validate-gen-models.mjs");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test("14 行のカタログが strict スキーマに適合する", () => {
  assert.equal(catalog.version, 1);
  assert.equal(catalog.models.length, 14);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors, null, 2));

  const withUnknownField = structuredClone(catalog);
  withUnknownField.models[0].unknown = true;
  assert.equal(validate(withUnknownField), false, "additionalProperties は拒否される必要があります");
});

test("全モデル id は一意で verified は documented のみ", () => {
  const ids = catalog.models.map((model) => model.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(catalog.models.map((model) => model.verified)), new Set(["documented"]));
});

test("price.by_resolution のキーは resolutions に含まれる（空文字は共通価格）", () => {
  for (const model of catalog.models) {
    if (!model.price) continue;
    const resolutions = new Set(model.resolutions ?? []);
    for (const key of Object.keys(model.price.by_resolution)) {
      assert.ok(key === "" || resolutions.has(key), `${model.id}: ${key}`);
    }
  }
});

test("禁止語はキーにも値にも存在しない", () => {
  const forbidden = "cap" + "ability";
  visit(catalog, (key, value) => {
    assert.notEqual(key, forbidden);
    assert.notEqual(value, forbidden);
  });
});

test("CLI は正本を受理し、引数違反を exit 2 にする", () => {
  const valid = spawnSync(process.execPath, [cliPath, catalogPath], { encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /^OK: /);

  const usage = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /^使い方: /);

  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^使い方: /);
});

test("CLI は id 重複と価格解像度の不整合を拒否する", () => {
  const invalid = structuredClone(catalog);
  invalid.models[1].id = invalid.models[0].id;
  invalid.models[0].price.by_resolution.unknown = 1;
  const target = join(tmpdir(), `akari-gen-models-invalid-${process.pid}.json`);
  writeFileSync(target, `${JSON.stringify(invalid, null, 2)}\n`, "utf8");
  const executed = spawnSync(process.execPath, [cliPath, target], { encoding: "utf8" });
  assert.equal(executed.status, 1, executed.stdout);
  assert.match(executed.stderr, /id が重複しています/);
  assert.match(executed.stderr, /price\.by_resolution\.unknown/);
});

function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    callback(key, child);
    visit(child, callback);
  }
}
