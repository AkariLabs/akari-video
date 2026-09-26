import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveTarget } from "../src/media/common.mjs";
import { analysisPathForTarget, recordObservation } from "../src/media/record.mjs";

// 共有ライブラリ参照（edit.json に宣言はあるが実体がプロジェクトに無い素材）を
// resolveTarget() が asset-resolver 経由で解決することを固定する。
// 契約: docs/contract-2026-09-02-asset-reference-model.md §2

const DECLARED = "assets/broll/talkinghead-desk-ja-01/clip.mp4";
const REFERENCE = { version: 0, references: [{ id: "talkinghead-desk-ja-01", category: "broll" }] };

async function fixture(t, { reference = true, libraryFile = true } = {}) {
  const base = realpathSync(await mkdtemp(path.join(os.tmpdir(), "resolve-target-library-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = path.join(base, "project");
  const library = path.join(base, "library");
  await mkdir(path.join(project, ".akari"), { recursive: true });
  await mkdir(path.join(project, "assets"), { recursive: true });
  await writeFile(path.join(project, "edit.json"),
    `${JSON.stringify({ version: 2, sources: [{ id: "src-2", path: DECLARED }] })}\n`);
  if (reference) {
    await writeFile(path.join(project, ".akari/asset-references.json"), `${JSON.stringify(REFERENCE)}\n`);
  }
  await mkdir(path.join(library, "broll/talkinghead-desk-ja-01"), { recursive: true });
  if (libraryFile) {
    await writeFile(path.join(library, "broll/talkinghead-desk-ja-01/clip.mp4"), "fixture");
  }
  return { project, library, options: { cwd: project, env: { ...process.env, AKARI_LIBRARY_ROOT: library } } };
}

test("resolveTarget: 台帳にある参照素材を library 実体へ解決し、宣言パスとプロジェクト根を保つ", async t => {
  const f = await fixture(t);
  const target = resolveTarget(DECLARED, f.options);
  assert.equal(target.inputPath, realpathSync(path.join(f.library, "broll/talkinghead-desk-ja-01/clip.mp4")));
  assert.equal(target.projectRoot, f.project);
  assert.equal(target.projectRelative, DECLARED);
  assert.equal(target.projectRelative.includes(".."), false);
  assert.equal(target.displayPath, DECLARED);
  assert.equal(target.sourceId, "src-2");
  assert.equal(target.isProjectSource, true);
  // projectRoot / projectRelative が無いと record.mjs が sidecar を書かずに黙って返る。
  assert.equal(analysisPathForTarget(target),
    path.join(f.project, ".akari", "sidecars", `${DECLARED}.analysis`, "analysis.json"));
});

test("resolveTarget: source id 指定でも同じ library 実体と宣言パスになる", async t => {
  const f = await fixture(t);
  const target = resolveTarget("src-2", f.options);
  assert.equal(target.inputPath, realpathSync(path.join(f.library, "broll/talkinghead-desk-ja-01/clip.mp4")));
  assert.equal(target.projectRoot, f.project);
  assert.equal(target.projectRelative, DECLARED);
  assert.equal(target.sourceId, "src-2");
});

test("resolveTarget: 台帳に無い・library に実体が無い参照は従来のエラー文で失敗する", async t => {
  const unregistered = await fixture(t, { reference: false });
  assert.throws(() => resolveTarget(DECLARED, unregistered.options),
    { message: `素材ファイルが見つかりません: ${DECLARED}` });
  const missingFile = await fixture(t, { libraryFile: false });
  assert.throws(() => resolveTarget(DECLARED, missingFile.options),
    { message: `素材ファイルが見つかりません: ${DECLARED}` });
});

test("resolveTarget: プロジェクト外へ出る target は library を引かずに失敗する", async t => {
  const f = await fixture(t);
  assert.throws(() => resolveTarget("../outside.mp4", f.options),
    { message: "素材ファイルが見つかりません: ../outside.mp4" });
});

test("resolveTarget: プロジェクト内に実体があれば library より優先し、既存の解決順を変えない", async t => {
  const f = await fixture(t);
  await mkdir(path.dirname(path.join(f.project, DECLARED)), { recursive: true });
  await writeFile(path.join(f.project, DECLARED), "local");
  const target = resolveTarget(DECLARED, f.options);
  assert.equal(target.inputPath, path.join(f.project, DECLARED));
  assert.equal(target.projectRoot, f.project);
  assert.equal(target.projectRelative, DECLARED);
  assert.equal(target.sourceId, "src-2");
  assert.equal(target.isProjectSource, true);
});

test("recordObservation: library 解決時は analysis.json の source が宣言パス基準になり実体パスを焼かない", async t => {
  const f = await fixture(t);
  const target = resolveTarget(DECLARED, f.options);
  await recordObservation({ target, kind: "probe", result: { generated_at: "2026-09-26T00:00:00.000Z", duration_s: 1 } });
  const analysisPath = analysisPathForTarget(target);
  const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
  const expected = path.relative(path.dirname(analysisPath), path.join(f.project, DECLARED))
    .split(path.sep).join("/");
  assert.equal(analysis.source, expected);
  // sidecar から source を解決するとプロジェクト内の宣言パスへ戻る（library 実体ではない）。
  assert.equal(path.resolve(path.dirname(analysisPath), analysis.source), path.join(f.project, DECLARED));
  assert.doesNotMatch(analysis.source, /Users|library/);
});

test("recordObservation: プロジェクト内に実体があるときの source は従来値のまま", async t => {
  const f = await fixture(t);
  const local = path.join(f.project, "assets/source.wav");
  await writeFile(local, "fixture");
  const target = resolveTarget("assets/source.wav", f.options);
  await recordObservation({ target, kind: "probe", result: { generated_at: "2026-09-26T00:00:00.000Z", duration_s: 1 } });
  const analysisPath = analysisPathForTarget(target);
  const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
  const expected = path.relative(path.dirname(analysisPath), local).split(path.sep).join("/");
  assert.equal(analysis.source, expected);
});
