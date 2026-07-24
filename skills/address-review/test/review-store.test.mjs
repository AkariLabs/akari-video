import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  locateAnnotations,
  needsConfirmation,
  parseReviewDocument,
  respondToAnnotation,
} from "../bin/core/review-store.mjs";

const execFileAsync = promisify(execFile);
const listCli = fileURLToPath(new URL("../bin/list.mjs", import.meta.url));
const respondCli = fileURLToPath(new URL("../bin/respond.mjs", import.meta.url));
const fixtureProject = fileURLToPath(new URL("../dev-fixtures/fixture-project", import.meta.url));

async function withTempProject(context) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "address-review-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.cp(fixtureProject, temporary, { recursive: true });
  return temporary;
}

async function readReview(projectRoot) {
  return fs.readFile(path.join(projectRoot, "review.json"), "utf8");
}

test("locateAnnotations は波括弧・引用符を含む text でも要素境界を正しく特定する", () => {
  const source = JSON.stringify({
    version: 0,
    annotations: [
      { id: "a-0001", status: "open", text: 'これは "引用" と { 波括弧 } を含む \\ バックスラッシュ' },
      { id: "a-0002", status: "open", text: "普通のテキスト", nested: { points: [[0, 1], [1, 0]] } },
    ],
  });
  const elements = locateAnnotations(source);
  assert.equal(elements.length, 2);
  assert.equal(elements[0].value.id, "a-0001");
  assert.equal(elements[1].value.id, "a-0002");
  assert.equal(source.slice(elements[0].start, elements[0].end), JSON.stringify(JSON.parse(source).annotations[0]));
});

test("needsConfirmation は text 冒頭の [要確認] を検出する（前後空白を許容）", () => {
  assert.equal(needsConfirmation({ text: "[要確認] 曖昧です" }), true);
  assert.equal(needsConfirmation({ text: "  [要確認] 先頭に空白" }), true);
  assert.equal(needsConfirmation({ text: "普通の指示" }), false);
  assert.equal(needsConfirmation({ text: "" }), false);
});

test("respondToAnnotation: open → addressed が原子的に書け、他 annotation はバイト不変", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);

  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-0001",
    action: "edited",
    summary: "BGMを -6dB 下げました",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.annotation.status, "addressed");
  assert.deepEqual(result.annotation.response, {
    summary: "BGMを -6dB 下げました",
    action: "edited",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });

  const after = await readReview(projectRoot);
  const beforeDoc = parseReviewDocument(before);
  const afterDoc = parseReviewDocument(after);
  for (const annotation of beforeDoc.annotations) {
    if (annotation.id === "a-0001") continue;
    const afterElement = locateAnnotations(after).find((element) => element.value.id === annotation.id);
    const beforeElement = locateAnnotations(before).find((element) => element.value.id === annotation.id);
    assert.equal(afterElement.raw, beforeElement.raw, `${annotation.id} のバイト列が変化した`);
  }
  assert.equal(afterDoc.annotations.length, beforeDoc.annotations.length);
});

test("respondToAnnotation: resolved 対象は拒否し review.json は無変更", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);
  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-0004",
    action: "edited",
    summary: "test",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not-open");
  assert.equal(await readReview(projectRoot), before);
});

test("respondToAnnotation: addressed 対象は拒否し review.json は無変更", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);
  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-0003",
    action: "declined",
    summary: "test",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "not-open");
  assert.equal(await readReview(projectRoot), before);
});

test("respondToAnnotation: 未知の id は拒否し review.json は無変更", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);
  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-9999",
    action: "edited",
    summary: "test",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "unknown-id");
  assert.equal(await readReview(projectRoot), before);
});

test("respondToAnnotation: summary 欠落は拒否し review.json は無変更", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);
  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-0001",
    action: "edited",
    summary: "   ",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "missing-summary");
  assert.equal(await readReview(projectRoot), before);
});

test("respondToAnnotation: 不正な action は拒否し review.json は無変更", async (context) => {
  const projectRoot = await withTempProject(context);
  const before = await readReview(projectRoot);
  const result = await respondToAnnotation(path.join(projectRoot, "review.json"), {
    id: "a-0001",
    action: "approved",
    summary: "test",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid-action");
  assert.equal(await readReview(projectRoot), before);
});

test("respondToAnnotation: review.json が無ければ拒否する", async (context) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "address-review-empty-"));
  context.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const result = await respondToAnnotation(path.join(temporary, "review.json"), {
    id: "a-0001",
    action: "edited",
    summary: "test",
    respondedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "no-review");
});

test("CLI list --all-open は [要確認] をスキップし、その旨を報告する", async (context) => {
  const projectRoot = await withTempProject(context);
  const { stdout } = await execFileAsync(process.execPath, [listCli, projectRoot, "--all-open", "--json"]);
  const result = JSON.parse(stdout);
  assert.deepEqual(result.targets.map((a) => a.id).sort(), ["a-0001", "a-0002"]);
  assert.deepEqual(result.skipped.map((a) => a.id), ["a-0005"]);
});

test("CLI list --ids は明示指定なら [要確認] も対象にする", async (context) => {
  const projectRoot = await withTempProject(context);
  const { stdout } = await execFileAsync(process.execPath, [listCli, projectRoot, "--ids", "a-0005", "--json"]);
  const result = JSON.parse(stdout);
  assert.deepEqual(result.targets.map((a) => a.id), ["a-0005"]);
  assert.deepEqual(result.notFound, []);
});

test("CLI respond は成功時 exit 0、ガード拒否時 exit 1 を返す", async (context) => {
  const projectRoot = await withTempProject(context);
  const ok = await execFileAsync(process.execPath, [
    respondCli, projectRoot, "--id", "a-0002", "--action", "declined", "--summary", "見送り", "--json",
  ]);
  assert.equal(JSON.parse(ok.stdout).ok, true);

  await assert.rejects(
    execFileAsync(process.execPath, [
      respondCli, projectRoot, "--id", "a-0004", "--action", "edited", "--summary", "test", "--json",
    ]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).code, "not-open");
      return true;
    },
  );
});
