import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-asset.mjs");
const fixtureRoot = join(packageRoot, "test", "fixtures", "asset");

function run(fixture) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixture)], {
    encoding: "utf8",
  });
}

test("library meta with title-normalized matched_by passes", () => {
  const executed = run("valid-library/overlay/lower-third-clean");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("catalog meta with title-normalized matched_by passes", () => {
  const executed = run("valid-catalog/audio/whoosh-transition");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("unknown matched_by value fails with the allowed enum", () => {
  const executed = run("invalid-matched-by/audio/whoosh-transition");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /matched_by は title-normalized のいずれかである必要があります/,
  );
});

test("scene3d fragment with texts[] only (no model) passes without a glTF entity", () => {
  const executed = run("valid-scene3d-texts-only/scene3d/hero-texts-only");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("scene3d fragment declaring model still requires a glTF entity", () => {
  const executed = run("invalid-scene3d-model-missing-glb/scene3d/hero-missing-glb");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /scene3d 素材には glTF 実体（\.glb または \.gltf）が必要です/);
});

test("scene3d fragment with neither model nor texts[] still requires a glTF entity", () => {
  const executed = run("invalid-scene3d-neither/scene3d/hero-neither");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /scene3d 素材には glTF 実体（\.glb または \.gltf）が必要です/);
});

test("tier is required, price is optional, and pro cannot use CC0", (t) => {
  const root = mkdtempSync(join(tmpdir(), "akari-tier-validation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "audio", "whoosh-transition");
  cpSync(join(fixtureRoot, "valid-catalog", "audio", "whoosh-transition"), dir, { recursive: true });
  const metaPath = join(dir, "meta.json");
  const original = JSON.parse(readFileSync(metaPath, "utf8"));
  const check = (meta) => {
    writeFileSync(metaPath, JSON.stringify(meta));
    return spawnSync(process.execPath, [cliPath, dir], { encoding: "utf8" });
  };

  const oldPrice = original.price;
  const withoutTierOrPrice = { ...original };
  delete withoutTierOrPrice.tier;
  delete withoutTierOrPrice.price;
  assert.match(check({ ...withoutTierOrPrice, price: oldPrice }).stderr, /必須フィールドがありません: tier/);
  assert.equal(check(withoutTierOrPrice).status, 1);
  assert.equal(check({ ...withoutTierOrPrice, tier: "free" }).status, 0);
  assert.match(check({ ...withoutTierOrPrice, tier: "pro" }).stderr, /tier: pro.*CC0-1.0/);
  assert.match(check({ ...withoutTierOrPrice, tier: "paid" }).stderr, /tier は free \/ pro/);
  const nonCc0 = { ...withoutTierOrPrice, tier: "free", license: { ...original.license, spdx: "MIT" } };
  const warned = check(nonCc0);
  assert.equal(warned.status, 0, warned.stderr);
  assert.match(warned.stderr, /WARN:.*CC0-1.0/);
  const pro = check({ ...nonCc0, tier: "pro", price: 0 });
  assert.equal(pro.status, 0, pro.stderr);
  assert.doesNotMatch(pro.stderr, /WARN:/);
});
