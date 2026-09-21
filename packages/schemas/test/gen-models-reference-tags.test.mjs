import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url)));
const catalog = read("gen-models.json");
const schema = read("gen-models.schema.json");
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

test("tag_joiner 追加後も全カタログ行を strict schema で受理する", () => {
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.equal(schema.$defs.referenceInput.properties.tag_joiner.default, "");
});

test("H3 / Seedance の tag + joiner + 番号は OpenAPI の明示記法に一致する", () => {
  for (const [id, schemaName, prefix, joiner] of [
    ["fal:h3-ref", "H3ReferenceToVideoInput", "reference_", " "],
    ["fal:seedance-2.0-ref", "Seedance20ReferenceToVideoInput", "", ""],
  ]) {
    const row = catalog.models.find((model) => model.id === id);
    const input = read(`fixtures/gen-models/openapi/${id.replace(":", "_")}.json`).components.schemas[schemaName];
    for (const [slot, type] of [["reference_images", "image"], ["reference_videos", "video"], ["reference_audios", "audio"]]) {
      const ref = row.inputs[slot];
      assert.equal(ref.tag, `${joiner ? "" : "@"}${type[0].toUpperCase()}${type.slice(1)}`);
      assert.equal(ref.tag, ref.tag.trim());
      assert.equal(ref.tag_joiner ?? "", joiner);
      const property = input.properties[`${prefix}${type}_urls`];
      assert.equal(ref.max, property.maxItems);
      for (const n of [1, 2]) assert.ok(property.description.includes(`${ref.tag}${ref.tag_joiner ?? ""}${n}`));
    }
    if (id === "fal:h3-ref") assert.equal(row.as_of, "2026-09-22");
  }
});

test("tag_joiner は省略・空文字・空白を受理しその他を拒否する", () => {
  for (const [value, accepted] of [[undefined, true], ["", true], [" ", true], [null, false], [1, false], ["  ", false], ["\t", false]]) {
    const copy = structuredClone(catalog);
    const ref = copy.models.find(({ id }) => id === "fal:h3-ref").inputs.reference_images;
    if (value === undefined) delete ref.tag_joiner;
    else ref.tag_joiner = value;
    assert.equal(validate(copy), accepted, `joiner=${JSON.stringify(value)}`);
  }
});
