import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = join(packageRoot, "examples");
const schema = JSON.parse(readFileSync(join(packageRoot, "edit.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function fixture(name) {
  return JSON.parse(readFileSync(join(examplesRoot, name, "edit.json"), "utf8"));
}

test("output.geometry の語彙は \"source\" だけで、v0/v1 の output と v2 の outputV2 の両方が参照する", () => {
  assert.deepEqual(schema.$defs.outputGeometry.enum, ["source"]);
  assert.deepEqual(schema.$defs.output.properties.geometry, { $ref: "#/$defs/outputGeometry" });
  assert.deepEqual(schema.$defs.outputV2.properties.geometry, { $ref: "#/$defs/outputGeometry" });
  // 任意プロパティであること（既存プロジェクトは無指定 = fit 互換のまま valid）。
  for (const definition of [schema.$defs.output, schema.$defs.outputV2]) {
    assert.deepEqual(definition.required, ["width", "height", "fps"]);
  }
});

test("v2 の output.geometry: \"source\" は valid、無指定も valid", () => {
  const value = fixture("edit-v2-valid");
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
  value.output.geometry = "source";
  assert.equal(validate(value), true, JSON.stringify(validate.errors, null, 2));
});

test("v2 の output.geometry は \"fit\" 等を拒む", () => {
  for (const rejected of ["fit", "SOURCE", "", null, 1, ["source"]]) {
    const value = fixture("edit-v2-valid");
    value.output.geometry = rejected;
    assert.equal(validate(value), false, `${JSON.stringify(rejected)} が valid になりました`);
    assert.ok(
      validate.errors?.some(error => error.instancePath === "/output/geometry"),
      JSON.stringify(validate.errors, null, 2),
    );
  }
});

test("v0/v1 の output も同じ語彙で閉じている", () => {
  for (const name of ["edit-v0-sample", "edit-v1-sample"]) {
    const valid = fixture(name);
    valid.output.geometry = "source";
    assert.equal(validate(valid), true, `${name}: ${JSON.stringify(validate.errors, null, 2)}`);
    const invalid = fixture(name);
    invalid.output.geometry = "fit";
    assert.equal(validate(invalid), false, `${name}: "fit" が valid になりました`);
  }
});
