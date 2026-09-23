import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGenerationMeta } from "../../src/cli/meta-validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const FIXTURES = path.join(REPO, "packages/schemas/fixtures/generation-meta");
const SCHEMA = path.join(REPO, "packages/schemas/generation-meta.schema.json");

async function fixtureDocuments() {
  const names = (await readdir(FIXTURES)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => ({
    label: name,
    value: JSON.parse(await readFile(path.join(FIXTURES, name), "utf8")),
    valid: true,
  })));
}

function changed(source, mutate) {
  const value = structuredClone(source);
  mutate(value);
  return value;
}

function mutationDocuments(fixtures) {
  const byName = Object.fromEntries(fixtures.map(({ label, value }) => [label, value]));
  const done = byName["done.json"];
  const generating = byName["generating.json"];
  const planned = byName["planned.json"];
  const mutations = [
    ["next.kind 不正", byName["still-next.json"], (meta) => { meta.next.kind = "still"; }, "kind"],
    ["placeholder.sha256 不正", byName["generating-placeholder.json"], (meta) => { meta.placeholder.sha256 = "invalid"; }, "sha256"],
    ["next.status 不正", byName["still-next.json"], (meta) => { meta.next.status = "done"; }, "status"],
    ["next.model の id 欠け", byName["still-next.json"], (meta) => { delete meta.next.model.id; }, "id"],
    ["next.inputs 未知キー", byName["still-next.json"], (meta) => { meta.next.inputs.unknown = true; }, "unknown"],
    ["next.inputs mode 既存 enum", byName["still-next.json"], (meta) => { meta.next.inputs.mode = "frames"; }, "mode"],
    ["frames_or_refs は下書き限定", done, (meta) => { meta.inputs.frames_or_refs = "frames"; }, "frames_or_refs"],
    ["next.frames_or_refs 不正", byName["still-next.json"], (meta) => { meta.next.inputs.frames_or_refs = "video"; }, "frames_or_refs"],
    ["next.updated_at 不正", byName["still-next.json"], (meta) => { meta.next.updated_at = "yesterday"; }, "updated_at"],
    ["placeholder.item_id 欠け", byName["generating-placeholder.json"], (meta) => { delete meta.placeholder.item_id; }, "item_id"],
    ["version 2", done, (meta) => { meta.version = 2; }, "version"],
    ["kind 不正", done, (meta) => { meta.kind = "unknown"; }, "kind"],
    ["generating の request_id 欠け", generating, (meta) => { delete meta.job.request_id; }, "request_id"],
    ["done の result 欠け", done, (meta) => { delete meta.result; }, "result"],
    ["sha256 が 63 桁", done, (meta) => { meta.result.sha256 = "a".repeat(63); }, "sha256"],
    ["as_of 書式不正", done, (meta) => { meta.model.as_of = "2026/09/12"; }, "as_of"],
    ["inputs の prompt 欠け", done, (meta) => { delete meta.inputs.prompt; }, "prompt"],
    ["ルートの未知キー", done, (meta) => { meta.unknown_root = true; }, "unknown_root"],
    ["history status 不正", done, (meta) => { meta.history[0].status = "queued"; }, "history"],
    ["cost.source 不正", done, (meta) => { meta.cost.source = "manual"; }, "source"],
    ["camera.notation 不正", generating, (meta) => { meta.inputs.camera.notation = "pan"; }, "notation"],
    ["duration_s が 0", done, (meta) => { meta.output.duration_s = 0; }, "duration_s"],
    ["model の未知キー", done, (meta) => { meta.model.unknown_model = true; }, "unknown_model"],
    ["reference の未知キー", done, (meta) => { meta.inputs.first_frame.unknown_reference = true; }, "unknown_reference"],
    ["camera の未知キー", generating, (meta) => { meta.inputs.camera.unknown_camera = true; }, "unknown_camera"],
    ["inputs の未知キー", done, (meta) => { meta.inputs.unknown_inputs = true; }, "unknown_inputs"],
    ["output の未知キー", done, (meta) => { meta.output.unknown_output = true; }, "unknown_output"],
    ["cost の未知キー", done, (meta) => { meta.cost.unknown_cost = true; }, "unknown_cost"],
    ["job の未知キー", done, (meta) => { meta.job.unknown_job = true; }, "unknown_job"],
    ["provenance の未知キー", done, (meta) => { meta.provenance.unknown_provenance = true; }, "unknown_provenance"],
    ["result の未知キー", done, (meta) => { meta.result.unknown_result = true; }, "unknown_result"],
    ["historyEntry の未知キー", planned, (meta) => { meta.history[0].unknown_history = true; }, "unknown_history"],
  ];
  return mutations.map(([label, source, mutate, field]) => ({
    label,
    value: changed(source, mutate),
    valid: false,
    field,
  }));
}

test("generation-meta fixtures 9 本を受理する", async () => {
  const fixtures = await fixtureDocuments();
  assert.equal(fixtures.length, 9);
  for (const fixture of fixtures) {
    assert.deepEqual(validateGenerationMeta(fixture.value), { ok: true, errors: [] }, fixture.label);
  }
});

test("planned audio is valid; unknown kind remains invalid", async () => {
  const planned = JSON.parse(await readFile(path.join(FIXTURES, "planned.json"), "utf8"));
  planned.kind = "audio";
  planned.inputs.prompt = "";
  assert.deepEqual(validateGenerationMeta(planned), { ok: true, errors: [] });
  planned.kind = "unknown";
  assert.equal(validateGenerationMeta(planned).ok, false);
});

test("generation-meta の変異 12 件以上を欄名付きで拒否する", async () => {
  const mutations = mutationDocuments(await fixtureDocuments());
  assert.ok(mutations.length >= 12);
  for (const mutation of mutations) {
    const checked = validateGenerationMeta(mutation.value);
    assert.equal(checked.ok, false, mutation.label);
    assert.ok(checked.errors.length > 0, mutation.label);
    assert.match(checked.errors.join("\n"), new RegExp(mutation.field, "u"), mutation.label);
  }
});

test("同梱 validator と AJV の判定がドリフトしていない", async (t) => {
  let Ajv2020;
  try {
    ({ default: Ajv2020 } = await import("ajv/dist/2020.js"));
  } catch (error) {
    t.skip(`ajv/dist/2020.js を解決できないため skip: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const schema = JSON.parse(await readFile(SCHEMA, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("date-time", (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value));
  const validateWithAjv = ajv.compile(schema);
  const fixtures = await fixtureDocuments();
  const documents = [...fixtures, ...mutationDocuments(fixtures)];
  for (const document of documents) {
    assert.equal(validateGenerationMeta(document.value).ok, validateWithAjv(document.value), document.label);
  }
  console.log(`generation-meta AJV ドリフト検査: ${documents.length} 件一致`);
});
