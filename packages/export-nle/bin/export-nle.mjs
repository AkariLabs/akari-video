#!/usr/bin/env node
// export-nle — edit.json を他社 NLE の交換形式へ書き出す決定的 CLI（BETA・実 NLE 取り込み未確認）。
//
//   node packages/export-nle/bin/export-nle.mjs <project-root|edit.json> [options]
//
//   --format <list>   all | fcpxml,xmeml,srt（カンマ区切り。既定 all）
//   --out <dir>       出力先（既定 <project>/exports/nle/）
//   --no-probe        ffprobe による実尺取得をしない（音声はプレースホルダ尺）
//   --json            機械向けレポートを stdout へ
//
// exit code: 0 = 書き出し完了（warnings 有無に関わらず）/ 2 = 入力・実行環境エラー。
// 移せないフィールドは黙って落とさず report の dropped[] に列挙する。

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEditFile, normalizeEdit, baseTimelineDuration } from "../src/edit-model.mjs";
import { frameDuration } from "../src/time.mjs";
import { probeDurations, timelineDurationWithMedia } from "../src/media.mjs";
import { buildFcpxml } from "../src/fcpxml.mjs";
import { buildXmeml } from "../src/xmeml.mjs";
import { buildSrt, loadCaptions } from "../src/srt.mjs";

const BETA_NOTICE =
  "BETA: 生成物の実 NLE（Final Cut Pro / DaVinci Resolve / Premiere Pro）取り込みは未確認。取り込み結果の報告を歓迎します";

const FORMATS = new Set(["fcpxml", "xmeml", "srt"]);

function parseArgs(argv) {
  const args = { input: null, formats: [...FORMATS], out: null, probe: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      const value = argv[index += 1] ?? "";
      args.formats = value === "all" ? [...FORMATS] : value.split(",").map((item) => item.trim());
      for (const format of args.formats) {
        if (!FORMATS.has(format)) throw new Error(`未知の --format: ${format}（fcpxml / xmeml / srt / all）`);
      }
    } else if (arg === "--out") {
      args.out = argv[index += 1] ?? null;
    } else if (arg === "--no-probe") {
      args.probe = false;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`未知のオプション: ${arg}`);
    } else if (args.input === null) {
      args.input = arg;
    } else {
      throw new Error(`入力は 1 つだけ: ${arg}`);
    }
  }
  if (!args.input) throw new Error("入力（project-root または edit.json）を指定してください");
  return args;
}

async function resolveFfprobeOrNull(enabled, warnings) {
  if (!enabled) return null;
  // workspace インストール済みなら指定子で、未インストールでもモノレポ内なら相対で解決する
  const candidates = [
    "@akari-video/media-bin",
    new URL("../../media-bin/src/index.mjs", import.meta.url).href,
  ];
  for (const specifier of candidates) {
    try {
      const { resolveFfprobe } = await import(specifier);
      return resolveFfprobe();
    } catch {
      // 次の解決手段へ
    }
  }
  warnings.push("ffprobe を解決できない（media-bin 不在）— 実尺取得なしで続行");
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { edit, editPath, projectRoot } = loadEditFile(args.input);
  const model = normalizeEdit(edit, projectRoot);
  const globalWarnings = [];
  const ffprobePath = await resolveFfprobeOrNull(args.probe, globalWarnings);
  const durations = probeDurations(model, {
    ffprobePath,
    onWarning: (message) => globalWarnings.push(message),
  });
  const fd = frameDuration(model.output.fps);
  const totalDuration = timelineDurationWithMedia(model, baseTimelineDuration(model), durations);
  if (totalDuration <= 0) throw new Error("タイムラインの尺が 0 — cuts / layers が空のプロジェクトは書き出せない");

  const outDir = resolve(args.out ?? resolve(projectRoot, "exports", "nle"));
  mkdirSync(outDir, { recursive: true });
  const context = { durations, frameDur: fd, totalDuration };
  const written = [];
  const dropped = [];
  const warnings = [...globalWarnings];

  if (args.formats.includes("fcpxml")) {
    const result = buildFcpxml(model, context);
    const path = resolve(outDir, `${model.projectName}.fcpxml`);
    writeFileSync(path, result.xml);
    written.push({ format: "fcpxml", path, target: "Final Cut Pro / DaVinci Resolve" });
    dropped.push(...result.dropped.map((entry) => ({ format: "fcpxml", ...entry })));
    warnings.push(...result.warnings.filter((warning) => !warnings.includes(warning)));
  }
  if (args.formats.includes("xmeml")) {
    const result = buildXmeml(model, context);
    const path = resolve(outDir, `${model.projectName}.premiere.xml`);
    writeFileSync(path, result.xml);
    written.push({ format: "xmeml", path, target: "Premiere Pro（FCP7 XML 経由）" });
    dropped.push(...result.dropped.map((entry) => ({ format: "xmeml", ...entry })));
    warnings.push(...result.warnings.filter((warning) => !warnings.includes(warning)));
  }
  if (args.formats.includes("srt")) {
    const captions = loadCaptions(projectRoot);
    if (captions === null) {
      warnings.push("captions.json が無いため SRT はスキップ");
    } else {
      const result = buildSrt(model, captions);
      const path = resolve(outDir, `${model.projectName}.srt`);
      writeFileSync(path, result.srt);
      written.push({ format: "srt", path, cues: result.cueCount, target: "全 NLE 共通の字幕サイドカー" });
      dropped.push(...result.dropped.map((entry) => ({ format: "srt", ...entry })));
      warnings.push(...result.warnings.filter((warning) => !warnings.includes(warning)));
    }
  }

  const report = {
    tool: "export-nle",
    status: "beta-unverified",
    notice: BETA_NOTICE,
    edit: editPath,
    output: { width: model.output.width, height: model.output.height, fps: model.output.fps },
    timeline_seconds: totalDuration,
    probed: ffprobePath !== null,
    written,
    dropped,
    warnings,
  };
  writeFileSync(resolve(outDir, "export-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`⚠ ${BETA_NOTICE}\n`);
    for (const file of written) {
      process.stdout.write(`書き出し: ${file.path}（${file.target}）\n`);
    }
    if (dropped.length > 0) {
      process.stdout.write(`移らないフィールド ${dropped.length} 件（詳細: export-report.json の dropped[]）:\n`);
      for (const entry of dropped) {
        process.stdout.write(`  - [${entry.format}] ${entry.field}: ${entry.reason}\n`);
      }
    }
    for (const warning of warnings) {
      process.stdout.write(`warning: ${warning}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`export-nle: ${error.message}\n`);
  process.exit(2);
});
