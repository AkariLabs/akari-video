// 実機バグ 2026-10-20 §1（task/2026-10-20-cuts-keep-declared-at）— lint 側。
//
// cuts の連結キーが衝突し、宣言 at が直前の終端へ前詰めされる編集は PASS させない。
// 同じ物理トラック内の宣言順の逆転は従来どおり timeline.items.order（warning）の担当なので、
// ここでは「別々の物理 visual トラックの cuts が 1 本の連結キーへ混ざった」場合だけを
// cuts.declared-at（error）として検査する。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { validateCutDeclaredPlacement } from "../src/lint/cuts-tracks.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "bin", "edit-lint.mjs");

test("別トラックの cuts が同じ連結キーへ混ざって at がずれると error", () => {
  // 修正前の projectLegacyEdit が出力していた形（別種別トラックの media が同じ ref に衝突）。
  const cuts = [
    { src: "bg", in: 0, out: 10.4, at: 166.8, track: 0 },
    { src: "photo-1", in: 0, out: 10, at: 33.333333333333336, track: 0 },
    { src: "photo-2", in: 0, out: 10, at: 46.666666666666664, track: 0 },
    { src: "card", in: 0, out: 5, at: 13, track: 1 },
  ];
  const findings = [];
  validateCutDeclaredPlacement(cuts, findings,
    ["bg-track", "photo-track", "photo-track", "card-track"]);
  const errors = findings.filter(finding => finding.check === "cuts.declared-at");
  assert.ok(errors.length >= 1, JSON.stringify(findings));
  assert.equal(errors[0].severity, "error");
  assert.equal(errors[0].path, "edit.json#cuts[1]");
  assert.match(errors[0].message, /33\.333/);
  assert.match(errors[0].message, /177\.2/);
});

test("物理トラックごとに連結キーが分かれていれば error なし", () => {
  const cuts = [
    { src: "bg", in: 0, out: 10.4, at: 166.8, track: 0 },
    { src: "photo-1", in: 0, out: 10, at: 33.333333333333336, track: 1 },
    { src: "photo-2", in: 0, out: 10, at: 46.666666666666664, track: 1 },
    { src: "card", in: 0, out: 5, at: 13, track: 2 },
  ];
  const findings = [];
  validateCutDeclaredPlacement(cuts, findings,
    ["bg-track", "photo-track", "photo-track", "card-track"]);
  assert.deepEqual(findings, []);
});

test("同一トラック内の宣言順の逆転は error にしない（timeline.items.order の担当）", () => {
  const cuts = [
    { src: "clip", in: 0, out: 4.933, at: 148 / 30, track: 0 },
    { src: "clip", in: 0, out: 4.933, at: 0, track: 0 },
  ];
  const findings = [];
  validateCutDeclaredPlacement(cuts, findings, ["v1", "v1"]);
  assert.deepEqual(findings, []);
});

test("報告 §1 の正常な v2 編集は CLI で PASS（cuts.declared-at を出さない）", async () => {
  const edit = {
    version: 2,
    output: { width: 540, height: 960, fps: 30 },
    sources: [
      { id: "bg", path: "assets/bg.png" },
      { id: "photo-1", path: "assets/photo-1.jpg" },
      { id: "photo-2", path: "assets/photo-2.jpg" },
      { id: "card", path: "assets/card.png" },
    ],
    tracks: [
      {
        id: "bg-track", lane: "visual", items: [
          { id: "terrain", at: 0, duration: 5004, source: { kind: "html", path: "overlays/terrain.html" } },
          { id: "bg-1", at: 5004, duration: 312, source: { kind: "media", src: "bg", in: 0, out: 312 } },
        ],
      },
      {
        id: "photo-track", lane: "visual", items: [
          { id: "photo-1", at: 1000, duration: 300, source: { kind: "media", src: "photo-1", in: 0, out: 300 } },
          { id: "photo-2", at: 1400, duration: 300, source: { kind: "media", src: "photo-2", in: 0, out: 300 } },
        ],
      },
      {
        id: "card-track", lane: "visual", items: [
          { id: "card-1", at: 390, duration: 150, source: { kind: "media", src: "card", in: 0, out: 150 } },
        ],
      },
    ],
  };
  const root = await mkdtemp(join(tmpdir(), "edit-lint-cut-declared-at-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, "overlays"), { recursive: true });
    await mkdir(join(root, ".akari"), { recursive: true });
    for (const name of ["bg.png", "photo-1.jpg", "photo-2.jpg", "card.png"]) {
      await writeFile(join(root, "assets", name), "fixture", "utf8");
    }
    await writeFile(join(root, "overlays", "terrain.html"), "<div>terrain</div>", "utf8");
    await writeFile(join(root, "edit.json"), `${JSON.stringify(edit, null, 2)}\n`, "utf8");
    const executed = spawnSync(process.execPath, [cliPath, root, "--json"], {
      encoding: "utf8", env: { ...process.env, AKARI_LANG: "ja" },
    });
    assert.equal(executed.signal, null, executed.stderr);
    const result = JSON.parse(executed.stdout);
    assert.equal(result.verdict, "pass", JSON.stringify(result.findings));
    assert.equal(result.findings.some(finding => finding.check === "cuts.declared-at"), false,
      JSON.stringify(result.findings));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
