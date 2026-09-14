import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runGenerateCommand } from "../../src/cli/index.mjs";
import { validateGenerationMeta } from "../../src/cli/meta-validate.mjs";
import { runStillCommand } from "../../src/cli/still.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const validator = join(packageRoot, "..", "schemas", "bin", "validate-generation-meta.mjs");
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw3jAAAAAElFTkSuQmCC",
  "base64",
);

async function temporaryProject(t, edit) {
  const projectDir = await mkdtemp(join(tmpdir(), "akari-generate-still-"));
  // 保存後 lint が .akari/ を書き足すため、ENOTEMPTY を再試行できる設定で削除する。
  // ENOTEMPTY は fs.rm の retry 対象になる。
  t.after(() => rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  if (edit) await writeFile(join(projectDir, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`);
  return projectDir;
}

async function settleProjectLint(projectDir) {
  const editPath = join(projectDir, "edit.json");
  let editMtimeMs;
  try {
    editMtimeMs = (await stat(editPath)).mtimeMs;
  } catch {
    return;
  }

  const reportPath = join(projectDir, ".akari", "reports", "edit-lint-report.html");
  const deadline = Date.now() + 5000;
  // 保存後 lint は 400ms のデバウンス後に走り、HTML が最後に書かれる。
  // edit.json 以上の mtime を要求すれば、2 回保存する場合も直近の lint 完了を待てる。
  while (Date.now() < deadline) {
    try {
      if ((await stat(reportPath)).mtimeMs >= editMtimeMs) return;
    } catch {
      // ENOENT などは未書き込みとして扱い、期限まで待機する。
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function writeSpec(projectDir, value) {
  const path = join(projectDir, "beats.json");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

const minimalEdit = (fps = 30) => ({
  version: 2,
  output: { width: 1920, height: 1080, fps },
  sources: [],
  tracks: [{ id: "v1", lane: "visual", items: [] }],
});

test("still: 引数エラーは exit 2、help は exit 0", async () => {
  for (const [argv, exitCode] of [
    [["--help"], 0],
    [["project", "--spec", "beats.json", "--unknown"], 2],
    [["project"], 2],
    [["project", "--spec", "beats.json", "--parallel", "0"], 2],
  ]) {
    const output = [];
    const result = await runStillCommand(argv, { log: (line) => output.push(line), logError: (line) => output.push(line) });
    assert.equal(result.exitCode, exitCode, argv.join(" "));
  }
});

test("still: dry-run は fps と既存末尾から at を計算し、何も書かない", async (t) => {
  const projectDir = await temporaryProject(t, {
    ...minimalEdit(24),
    sources: [{ id: "old", path: "old.png", proxy: null }],
    tracks: [{ id: "v1", lane: "visual", items: [{ id: "old", at: 12, duration: 24, source: { kind: "media", src: "old", in: 0, out: 1 } }] }],
  });
  const spec = await writeSpec(projectDir, [
    { id: "one", prompt: "一枚目", duration_s: 1.5 },
    { id: "two", prompt: "二枚目", duration_s: 2 },
  ]);
  const output = [];
  const before = await readFile(join(projectDir, "edit.json"), "utf8");
  const result = await runStillCommand([projectDir, "--spec", spec, "--dry-run"], { log: (line) => output.push(line), logError: (line) => output.push(line) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.planned.map(({ id, at, frames }) => ({ id, at, frames })), [
    { id: "one", at: 36, frames: 36 },
    { id: "two", at: 72, frames: 48 },
  ]);
  assert.match(output.join("\n"), /id\t尺\(秒\)\tat\(フレーム\)/);
  assert.equal(await readFile(join(projectDir, "edit.json"), "utf8"), before);
});

test("still: 文字カード 1 枚の planned meta はスキーマを通る", async (t) => {
  const projectDir = await temporaryProject(t, minimalEdit());
  const spec = await writeSpec(projectDir, [{ id: "title-card", prompt: "日本語の見出し", duration_s: 1 }]);
  const result = await runStillCommand([projectDir, "--spec", spec, "--placeholder"], { log: () => {}, logError: () => {} });
  await settleProjectLint(projectDir);
  assert.equal(result.exitCode, 0);
  const metaPath = join(projectDir, "assets", "generated", "title-card.png.meta.json");
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  assert.equal(meta.status, "planned");
  assert.equal(meta.model.id, "codex:image");
  assert.match(meta.provenance.tool, /^akari generate still --placeholder \((?:chrome|ffmpeg-drawtext|solid)\)$/u);
  assert.equal(spawnSync(process.execPath, [validator, metaPath], { encoding: "utf8" }).status, 0);
});

test("generate: still 本体の ERR_MODULE_NOT_FOUND は未同梱へ変換せず伝播する", async (t) => {
  const projectDir = await temporaryProject(t, minimalEdit());
  const spec = await writeSpec(projectDir, [{ id: "missing-dependency", prompt: "依存欠落", duration_s: 1 }]);
  const expected = Object.assign(new Error("still 内部の依存がありません"), { code: "ERR_MODULE_NOT_FOUND" });
  await assert.rejects(
    runGenerateCommand(["still", projectDir, "--spec", spec], {
      log: () => {},
      logError: () => {},
      generateImages: async () => { throw expected; },
    }),
    (error) => error === expected,
  );
});

test("still: 新規 edit と既存 edit へ fps 換算した連番で追加し、snapshot は各実行 1 回", async (t) => {
  const projectDir = await temporaryProject(t);
  let snapshots = 0;
  async function generate({ projectDir: dir, items }) {
    for (const item of items) {
      const path = join(dir, item.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, ONE_PIXEL_PNG);
    }
    return items.map((item) => ({ id: item.id, ok: true, elapsed_s: 0 }));
  }
  const spec1 = await writeSpec(projectDir, [{ id: "first", prompt: "一枚目", duration_s: 1 }]);
  let result = await runStillCommand([projectDir, "--spec", spec1], {
    generateImages: generate,
    log: () => {},
    logError: () => {},
    editDependencies: { takeSnapshot: async () => { snapshots += 1; } },
  });
  await settleProjectLint(projectDir);
  assert.equal(result.exitCode, 0);
  let edit = JSON.parse(await readFile(join(projectDir, "edit.json"), "utf8"));
  const doneMetaPath = join(projectDir, "assets", "generated", "first.png.meta.json");
  assert.equal(spawnSync(process.execPath, [validator, doneMetaPath], { encoding: "utf8" }).status, 0);
  assert.equal(edit.tracks[0].lane, "visual");
  assert.deepEqual(edit.tracks[0].items.map(({ id, at, duration }) => ({ id, at, duration })), [
    { id: "gen-first", at: 0, duration: 30 },
  ]);

  const spec2 = await writeSpec(projectDir, [{ id: "second", prompt: "二枚目", duration_s: 1.5 }]);
  result = await runStillCommand([projectDir, "--spec", spec2], {
    generateImages: generate,
    log: () => {},
    logError: () => {},
    editDependencies: { takeSnapshot: async () => { snapshots += 1; } },
  });
  await settleProjectLint(projectDir);
  assert.equal(result.exitCode, 0);
  edit = JSON.parse(await readFile(join(projectDir, "edit.json"), "utf8"));
  assert.deepEqual(edit.tracks[0].items.map(({ id, at, duration }) => ({ id, at, duration })), [
    { id: "gen-first", at: 0, duration: 30 },
    { id: "gen-second", at: 30, duration: 45 },
  ]);
  assert.equal(snapshots, 2);
});

test("still: 同じ id は上書きせず skip する", async (t) => {
  const projectDir = await temporaryProject(t, {
    ...minimalEdit(),
    sources: [{ id: "gen-same", path: "assets/generated/same.png", proxy: null }],
  });
  const spec = await writeSpec(projectDir, [{ id: "same", prompt: "重複", duration_s: 1 }]);
  let called = false;
  const result = await runStillCommand([projectDir, "--spec", spec], {
    generateImages: async () => { called = true; return []; },
    log: () => {},
    logError: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.generated, 0);
  assert.equal(called, false);
});

test("still: Codex スタブの失敗ビートは failed meta だけを残し、clip を置かない", async (t) => {
  const projectDir = await temporaryProject(t, minimalEdit());
  const spec = await writeSpec(projectDir, [{ id: "failure", prompt: "失敗する絵", duration_s: 2 }]);
  let insertCalled = false;
  const result = await runStillCommand([projectDir, "--spec", spec], {
    generateImages: async ({ items }) => items.map((item) => ({ id: item.id, ok: false, error: "テスト用の失敗" })),
    insertGeneratedStills: async () => { insertCalled = true; },
    log: () => {},
    logError: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(insertCalled, false);
  const meta = JSON.parse(await readFile(join(projectDir, "assets", "generated", "failure.png.meta.json"), "utf8"));
  assert.equal(meta.status, "failed");
  assert.equal(meta.history[0].reason, "テスト用の失敗");
  const edit = JSON.parse(await readFile(join(projectDir, "edit.json"), "utf8"));
  assert.equal(edit.tracks[0].items.length, 0);
});

test("still: 注入した writeMeta の外側で planned / done / failed を検証する", async (t) => {
  const written = [];
  const common = {
    readCodexModelAsOf: async () => "2026-09-13",
    now: () => new Date("2026-09-13T10:00:00.000Z"),
    writeMeta: async (_path, value) => { written.push(value); },
    insertGeneratedStills: async () => {},
    log: () => {},
    logError: () => {},
  };

  const plannedProject = await temporaryProject(t, minimalEdit());
  const plannedSpec = await writeSpec(plannedProject, [{ id: "planned", prompt: "計画", duration_s: 1 }]);
  assert.equal((await runStillCommand([plannedProject, "--spec", plannedSpec, "--placeholder"], {
    ...common,
    renderTextCard: async ({ outPath }) => ({ path: outPath, renderer: "solid" }),
  })).exitCode, 0);

  const doneProject = await temporaryProject(t, minimalEdit());
  const doneSpec = await writeSpec(doneProject, [{ id: "done", prompt: "完了", duration_s: 1 }]);
  assert.equal((await runStillCommand([doneProject, "--spec", doneSpec], {
    ...common,
    generateImages: async ({ items }) => items.map(({ id }) => ({ id, ok: true, elapsed_s: 0 })),
    inspectPng: async () => ({ sha256: "a".repeat(64), bytes: 68, width: 1, height: 1 }),
  })).exitCode, 0);

  const failedProject = await temporaryProject(t, minimalEdit());
  const failedSpec = await writeSpec(failedProject, [{ id: "failed", prompt: "失敗", duration_s: 1 }]);
  assert.equal((await runStillCommand([failedProject, "--spec", failedSpec], {
    ...common,
    generateImages: async ({ items }) => items.map(({ id }) => ({ id, ok: false, error: "テスト失敗" })),
  })).exitCode, 1);
  assert.deepEqual(written.map(({ status }) => status), ["planned", "done", "failed"]);
  for (const meta of written) assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });

  const invalidProject = await temporaryProject(t, minimalEdit());
  const invalidSpec = await writeSpec(invalidProject, [{ id: "invalid", prompt: "不正", duration_s: 1 }]);
  let invalidWriterCalls = 0;
  await assert.rejects(
    runStillCommand([invalidProject, "--spec", invalidSpec, "--placeholder"], {
      ...common,
      readCodexModelAsOf: async () => "invalid-date",
      writeMeta: async () => { invalidWriterCalls += 1; },
      renderTextCard: async ({ outPath }) => ({ path: outPath, renderer: "solid" }),
    }),
    /model\/as_of/u,
  );
  assert.equal(invalidWriterCalls, 0);
});
