import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "validate-avatar.mjs");
const fixtureRoot = join(packageRoot, "fixtures", "avatar");

function run(fixtureDir) {
  return spawnSync(process.execPath, [cliPath, join(fixtureRoot, fixtureDir)], {
    encoding: "utf8",
  });
}

test("valid avatar directory passes", () => {
  const executed = run("valid");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});

test("missing avatar directory fails", () => {
  const executed = run("does-not-exist");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /avatar ディレクトリが見つかりません/);
});

// ルール (a): rights 欄必須
test("missing rights fails (rule a)", () => {
  const executed = run("invalid-missing-rights");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /rights は必須です（rights 欄必須・欠落は fail/);
});

// ルール (b): person × sellable
test("person subject with sellable distribution fails (rule b)", () => {
  const executed = run("invalid-person-sellable");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /rights\.subject が person のアバターは rights\.distribution を sellable にできません/);
});

// ルール (c): person アバターが公開 catalog/avatars/ 配下
test("person avatar under catalog/avatars fails (rule c)", () => {
  const executed = run("invalid-person-in-catalog/catalog/avatars/impostor");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /rights\.subject が person のアバターは公開リポ catalog\/avatars\/ 配下に置けません/,
  );
});

// ルール (d): AVATAR.md 136 行以上
test("AVATAR.md over 135 lines fails (rule d)", () => {
  const executed = run("invalid-avatar-md-136-lines");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /AVATAR\.md が上限 135 行を超えています/);
  assert.match(executed.stderr, /実測 159 行/);
});

// ルール (e): アセット参照の実ファイル解決（欠落は全数列挙）
test("missing rendition asset file fails and is enumerated (rule e)", () => {
  const executed = run("invalid-missing-asset");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /アセット参照が実ファイルに解決できません/);
  assert.match(executed.stderr, /assets\.expressions\.happy = "happy\.png"/);
});

test("unknown top-level fields still pass (tolerant reader)", () => {
  const executed = run("valid-unknown-fields");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
});

test("newer avatar.json version stops honestly", () => {
  const executed = run("unsupported-version");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /新しい形式です。スキル \/ アプリを更新してください/);
});

test("missing avatar.json fails", () => {
  const executed = run("invalid-no-avatar-json");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /avatar\.json が見つかりません/);
});

test("invalid default_role fails", () => {
  const executed = run("invalid-default-role");
  assert.equal(executed.status, 1);
  assert.match(
    executed.stderr,
    /persona\.default_role は explainer \/ listener \/ tsukkomi \/ narrator \/ guest のいずれかである必要があります/,
  );
});

test("energy out of range fails", () => {
  const executed = run("invalid-energy-out-of-range");
  assert.equal(executed.status, 1);
  assert.match(executed.stderr, /persona\.energy は 0-100 の整数である必要があります/);
});

// schema v0 改訂（S2・2026-07-26）: renditions minItems 1→0 緩和（voice-only アバター）
test("voice-only avatar (renditions: []) passes", () => {
  const executed = run("valid-voice-only");
  assert.equal(executed.status, 0, executed.stderr);
  assert.match(executed.stdout, /^OK: /);
  assert.equal(executed.stderr.trim(), "");
});
