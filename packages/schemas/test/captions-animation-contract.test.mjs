import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const schema = JSON.parse(readFileSync(
  join(packageRoot, "captions.schema.json"),
  "utf8",
));
const textanimIds = readFileSync(
  join(repositoryRoot, "presets", "textanim", "index.jsonl"),
  "utf8",
).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line).id);

test("textStyle.animation exposes the in/out/loop slot contract", () => {
  assert.deepEqual(
    schema.$defs.textStyle.properties.animation,
    { $ref: "#/$defs/textAnimation" },
  );
  assert.equal(schema.$defs.textAnimation.additionalProperties, false);
  assert.equal(schema.$defs.textAnimation.minProperties, 1);
  assert.deepEqual(
    Object.keys(schema.$defs.textAnimation.properties).sort(),
    ["in", "loop", "out"],
  );
  assert.equal(schema.$defs.textAnimationSlot.additionalProperties, false);
  assert.deepEqual(schema.$defs.textAnimationSlot.required, ["id"]);
});

test("text animation ids stay identical to the 47-entry textanim index", () => {
  assert.equal(textanimIds.length, 47);
  assert.equal(new Set(textanimIds).size, 47);
  assert.deepEqual(schema.$defs.textAnimationId.enum, textanimIds);
  assert.ok(!schema.$defs.textAnimationId.enum.includes("nonexistent-anim"));
});
