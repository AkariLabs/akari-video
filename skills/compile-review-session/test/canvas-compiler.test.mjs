import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  buildMemoOnlyCanvasAnnotation,
  isValidCanvasId,
  simplifyCanvasStrokePoints,
  validateCanvasManifest,
  validateCanvasStroke,
} from "../bin/core/canvas-compiler.mjs";

const execFileAsync = promisify(execFile);
const compileCli = fileURLToPath(new URL("../bin/compile-review-session.mjs", import.meta.url));

function baseManifest(overrides = {}) {
  return {
    version: 0,
    id: "c-0001",
    createdAt: "2026-07-26T10:00:00+09:00",
    aspect: { w: 1920, h: 1080 },
    aspectSource: "edit.json",
    background: null,
    audio: null,
    memo: null,
    status: "recorded",
    compiledAnnotations: null,
    ...overrides,
  };
}

test("isValidCanvasId は c- + 4 桁以上の数字だけを受理する", () => {
  assert.equal(isValidCanvasId("c-0001"), true);
  assert.equal(isValidCanvasId("c-1"), false);
  assert.equal(isValidCanvasId("s-0001"), false);
  assert.equal(isValidCanvasId(null), false);
});

test("validateCanvasManifest は契約 §2 の必須フィールドを検証する", () => {
  assert.deepEqual(validateCanvasManifest(baseManifest()), baseManifest());
  assert.equal(validateCanvasManifest(null), null);
  assert.equal(validateCanvasManifest(baseManifest({ id: "not-an-id" })), null);
  assert.equal(validateCanvasManifest(baseManifest({ aspect: { w: 0, h: 1080 } })), null);
  assert.equal(validateCanvasManifest(baseManifest({ status: "unknown" })), null);
  assert.equal(
    validateCanvasManifest(baseManifest({ background: { ref: "x.png", hash: "not-sha256" } })),
    null,
  );
  assert.notEqual(
    validateCanvasManifest(baseManifest({
      background: { ref: "assets/x.png", hash: `sha256:${"a".repeat(64)}` },
    })),
    null,
  );
});

test("validateCanvasStroke は canvas-rect の pen ストロークだけを受理する", () => {
  assert.equal(validateCanvasStroke({
    id: "st-0001", tool: "pen", space: "canvas-rect", points: [[0.1, 0.2], [0.3, 0.4]],
  }), true);
  assert.equal(validateCanvasStroke({
    id: "st-0001", tool: "pen", space: "content-rect", points: [[0.1, 0.2], [0.3, 0.4]],
  }), false, "space が canvas-rect 以外は不正");
  assert.equal(validateCanvasStroke({
    id: "bad-id", tool: "pen", space: "canvas-rect", points: [[0.1, 0.2], [0.3, 0.4]],
  }), false, "id の形式が不正");
  assert.equal(validateCanvasStroke({
    id: "st-0001", tool: "pen", space: "canvas-rect", points: [[0.1, 0.2]],
  }), false, "点が1個だけは不正（2点以上必要）");
});

test("simplifyCanvasStrokePoints は端点を保ったまま100点まで間引く", () => {
  const points = Array.from({ length: 151 }, (_, index) => [index / 150, index / 300]);
  const simplified = simplifyCanvasStrokePoints(points);
  assert.equal(simplified.length, 100);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified.at(-1), points.at(-1));
});

test("buildMemoOnlyCanvasAnnotation は全ストロークを canvasRef 付きで埋め込み、target を canvas:<id> に固定する", () => {
  const annotation = buildMemoOnlyCanvasAnnotation({
    canvasId: "c-0003",
    strokes: [
      { id: "st-0001", points: [[0.1, 0.1], [0.2, 0.2]] },
      { id: "st-0002", points: [[0.3, 0.3], [0.4, 0.4]] },
    ],
    memo: "ここに見出しを置く",
    createdAt: "2026-07-26T10:10:00.000Z",
  });
  assert.equal(annotation.target, "canvas:c-0003");
  assert.equal(annotation.sourceT, null);
  assert.equal(annotation.timelineT, null);
  assert.equal(annotation.input, "typed");
  assert.equal(annotation.text, "ここに見出しを置く");
  assert.equal(annotation.strokes.length, 2);
  assert.equal(annotation.strokes[0].space, "canvas-rect");
  assert.equal(annotation.strokes[0].canvasRef, "c-0003/st-0001");
  assert.equal(annotation.strokes[1].canvasRef, "c-0003/st-0002");
});

test("buildMemoOnlyCanvasAnnotation はメモが無い場合、strokes だけでも黙って捨てずに定型文を残す", () => {
  const annotation = buildMemoOnlyCanvasAnnotation({
    canvasId: "c-0004",
    strokes: [{ id: "st-0001", points: [[0.1, 0.1], [0.2, 0.2]] }],
    memo: null,
    createdAt: "2026-07-26T10:10:00.000Z",
  });
  assert.match(annotation.text, /メモなし/);
  assert.equal(annotation.strokes.length, 1);
});

test("buildMemoOnlyCanvasAnnotation はストロークが無い場合 strokes: null にする（メモのみキャンバス）", () => {
  const annotation = buildMemoOnlyCanvasAnnotation({
    canvasId: "c-0005",
    strokes: [],
    memo: "縦動画用の構図メモだけ",
    createdAt: "2026-07-26T10:10:00.000Z",
  });
  assert.equal(annotation.strokes, null);
  assert.equal(annotation.text, "縦動画用の構図メモだけ");
});

async function makeProject() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "compile-review-canvas-"));
  await fs.writeFile(
    path.join(temporary, "review.json"),
    '{\n  "version": 0,\n  "annotations": [\n  ]\n}\n',
  );
  return temporary;
}

/**
 * compile-review-session.mjs は「1 回の実行で成功が 0 件・拒否/失敗が 1 件以上」のとき
 * exit code 1 を返す（session 専用と共通の既存挙動）。拒否だけを検証するテストは
 * execFileAsync の reject を吸収し、stdout はそのまま使う。
 */
async function runCli(args) {
  return execFileAsync(process.execPath, args).catch(error => {
    if (typeof error.stdout !== "string") throw error;
    return { stdout: error.stdout, stderr: error.stderr };
  });
}

async function writeCanvas(projectRoot, canvasId, { manifest, strokes }) {
  const canvasDirectory = path.join(projectRoot, "review", "canvas", canvasId);
  await fs.mkdir(canvasDirectory, { recursive: true });
  await fs.writeFile(path.join(canvasDirectory, "canvas.json"), JSON.stringify(manifest));
  if (strokes !== undefined) {
    await fs.writeFile(path.join(canvasDirectory, "strokes.json"), strokes);
  }
  return canvasDirectory;
}

test("CLI: strokes + memo のあるキャンバスを1 annotation へ着地し canvas.json の status を進める", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0001", {
    manifest: baseManifest({ memo: "ここに大きな見出しを置く" }),
    strokes: JSON.stringify({
      version: 1,
      strokes: [{ id: "st-0001", tool: "pen", space: "canvas-rect", points: [[0.4, 0.4], [0.5, 0.5], [0.6, 0.4]] }],
    }),
  });

  const executed = await execFileAsync(process.execPath, [compileCli, projectRoot, "--json"]);
  const summary = JSON.parse(executed.stdout);
  assert.equal(summary.totals.canvases, 1);
  assert.equal(summary.totals.compiled, 1);

  const review = JSON.parse(await fs.readFile(path.join(projectRoot, "review.json"), "utf8"));
  assert.equal(review.annotations.length, 1);
  const [annotation] = review.annotations;
  assert.equal(annotation.target, "canvas:c-0001");
  assert.equal(annotation.sourceT, null);
  assert.equal(annotation.strokes[0].space, "canvas-rect");
  assert.equal(annotation.strokes[0].canvasRef, "c-0001/st-0001");

  const manifest = JSON.parse(
    await fs.readFile(path.join(projectRoot, "review", "canvas", "c-0001", "canvas.json"), "utf8"),
  );
  assert.equal(manifest.status, "compiled");
  assert.deepEqual(manifest.compiledAnnotations, [annotation.id]);
});

test("CLI: strokes.json が無い（メモのみ）キャンバスも着地する", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0002", {
    manifest: baseManifest({ id: "c-0002", memo: "縦動画用の構図メモだけ" }),
  });

  await execFileAsync(process.execPath, [compileCli, projectRoot, "--json"]);
  const review = JSON.parse(await fs.readFile(path.join(projectRoot, "review.json"), "utf8"));
  assert.equal(review.annotations[0].strokes, null);
  assert.equal(review.annotations[0].text, "縦動画用の構図メモだけ");
});

test("CLI: strokes.json が壊れている場合はコンパイル拒否する（契約 §6・推測着地しない）", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0003", {
    manifest: baseManifest({ id: "c-0003", memo: "メモ" }),
    strokes: "{broken",
  });

  const executed = await runCli([compileCli, projectRoot, "--json"]);
  const summary = JSON.parse(executed.stdout);
  assert.equal(summary.totals.rejected, 1);
  assert.equal(summary.results[0].status, "rejected");

  const review = JSON.parse(await fs.readFile(path.join(projectRoot, "review.json"), "utf8"));
  assert.equal(review.annotations.length, 0, "拒否時は annotation を着地しない");

  const report = await fs.readFile(
    path.join(projectRoot, "review", "canvas", "c-0003", "compile-report.md"), "utf8",
  );
  assert.match(report, /コンパイル拒否/);
});

test("CLI: strokes も memo も無いキャンバスは着地する内容が無いため拒否する", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0004", {
    manifest: baseManifest({ id: "c-0004", memo: null }),
    strokes: JSON.stringify({ version: 1, strokes: [] }),
  });

  const executed = await runCli([compileCli, projectRoot, "--json"]);
  const summary = JSON.parse(executed.stdout);
  assert.equal(summary.totals.rejected, 1);
});

test("CLI: compiled 済みキャンバスは既定でスキップし、--force で再コンパイルして新しい annotation を足す", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0005", {
    manifest: baseManifest({ id: "c-0005", memo: "メモ" }),
    strokes: JSON.stringify({
      version: 1,
      strokes: [{ id: "st-0001", tool: "pen", space: "canvas-rect", points: [[0.1, 0.1], [0.2, 0.2]] }],
    }),
  });

  await execFileAsync(process.execPath, [compileCli, projectRoot, "--json"]);
  const skipped = await execFileAsync(process.execPath, [compileCli, projectRoot, "--json"]);
  assert.equal(JSON.parse(skipped.stdout).totals.skipped, 1);

  await execFileAsync(process.execPath, [compileCli, projectRoot, "--force", "--json"]);
  const review = JSON.parse(await fs.readFile(path.join(projectRoot, "review.json"), "utf8"));
  assert.equal(review.annotations.length, 2, "--force で 2 件目の annotation が足される");
});

test("CLI: --canvas <id> は指定したキャンバスだけを対象にする（session には触れない）", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0006", { manifest: baseManifest({ id: "c-0006", memo: "対象" }) });
  await writeCanvas(projectRoot, "c-0007", { manifest: baseManifest({ id: "c-0007", memo: "対象外" }) });

  const executed = await execFileAsync(
    process.execPath, [compileCli, projectRoot, "--canvas", "c-0006", "--json"],
  );
  const summary = JSON.parse(executed.stdout);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].canvasId, "c-0006");
});

test("CLI: audio 付きキャンバスは v0 未実装として拒否する（黙って処理しない）", async (context) => {
  const projectRoot = await makeProject();
  context.after(() => fs.rm(projectRoot, { recursive: true, force: true }));
  await writeCanvas(projectRoot, "c-0008", {
    manifest: baseManifest({ id: "c-0008", audio: "audio.wav" }),
  });

  const executed = await runCli([compileCli, projectRoot, "--json"]);
  const summary = JSON.parse(executed.stdout);
  assert.equal(summary.totals.rejected, 1);
  assert.match(summary.results[0].reason, /未実装/);
});
