import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");
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
  const executed = spawnSync(process.execPath, [cliPath, join(repoRoot, "catalog", "audio", "whoosh-transition")], { encoding: "utf8" });
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.match(executed.stdout, /source: external/);
  assert.equal(executed.stderr.trim(), "");
});

test("source union accepts external and akari-r2, rejects mixed and absent discriminators", (t) => {
  const root = mkdtempSync(join(tmpdir(), "akari-source-union-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "overlay", "lower-third-clean");
  cpSync(join(fixtureRoot, "valid-library", "overlay", "lower-third-clean"), dir, { recursive: true });
  const metaPath = join(dir, "meta.json");
  const original = { ...JSON.parse(readFileSync(metaPath, "utf8")), remote: false };
  const external = JSON.parse(readFileSync(join(fixtureRoot, "valid-catalog", "audio", "whoosh-transition", "meta.json"), "utf8")).source;
  const check = (source, remote = false) => {
    writeFileSync(metaPath, JSON.stringify({ ...original, remote, source }));
    return spawnSync(process.execPath, [cliPath, dir], { encoding: "utf8" });
  };
  const akariR2 = { image: "library/still/example.png", preview: "https://example.test/preview.jpg", width: 1, height: 2, bytes: 3 };
  const acceptedExternal = check(external);
  assert.equal(acceptedExternal.status, 0, acceptedExternal.stderr);
  assert.match(acceptedExternal.stdout, /^OK: .*\nsource: external\s*$/);
  const acceptedR2 = check(akariR2, true);
  assert.equal(acceptedR2.status, 0, acceptedR2.stderr);
  assert.match(acceptedR2.stdout, /^OK: .*\nsource: akari-r2\s*$/);
  for (const source of [{ ...external, image: akariR2.image }, {}]) {
    const rejected = check(source);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /source は url または image の一方だけ/);
  }
  const remoteExternal = check(external, true);
  assert.equal(remoteExternal.status, 1);
  assert.match(remoteExternal.stderr, /remote: true.*akari-r2/);
  const badDimension = check({ ...akariR2, bytes: 0 }, true);
  assert.equal(badDimension.status, 1);
  assert.match(badDimension.stderr, /source.bytes は正整数/);
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
  const dir = join(root, "overlay", "lower-third-clean");
  cpSync(join(fixtureRoot, "valid-library", "overlay", "lower-third-clean"), dir, { recursive: true });
  const metaPath = join(dir, "meta.json");
  const original = { ...JSON.parse(readFileSync(metaPath, "utf8")), remote: false };
  const check = (meta) => {
    writeFileSync(metaPath, JSON.stringify(meta));
    return spawnSync(process.execPath, [cliPath, dir], { encoding: "utf8" });
  };

  const oldPrice = 0;
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
