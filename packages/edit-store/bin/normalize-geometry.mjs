#!/usr/bin/env node
/**
 * 幾何の統一 G1 — 既存プロジェクトを実寸基準（`output.geometry: "source"`）へ移行する CLI。
 *
 *   node packages/edit-store/bin/normalize-geometry.mjs <projectDir> [--dry-run] [--revert <backup>]
 *
 * 素材の寸法は ffprobe（media-bin）で読み、表示回転後の画素数で `fit` を求める。
 * 書き込みの直前に edit-lint ゲートを通し、原文は .akari/backup/ へ退避してから atomic に置き換える。
 * G1 ではエンジンはマーカーを読まないため、この移行だけでは描画は変わらない。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { probeMediaDimensions } from "../../media-bin/src/media-dimensions.mjs";

const require = createRequire(import.meta.url);
const migrate = require("../lib/migrate/index.js");
const writeGate = require("../lib/write-gate.js");

const USAGE = [
  "使い方: normalize-geometry <projectDir> [--dry-run] [--revert <backup>]",
  "",
  "  edit.json（version 2）の映像 item を実寸基準へ移行します。",
  "  今 fit 基準で描かれている cut の transform.scale に fit を一度だけ焼き込み、",
  "  output.geometry: \"source\" を立てます（見た目は変わりません）。",
  "",
  "  --dry-run           変更内容を表で出すだけで書き込みません",
  "  --revert <backup>   .akari/backup/ の退避ファイルから edit.json を戻します",
  "  --help, -h          このヘルプ",
].join("\n");

export function parseArguments(argv) {
  const positional = [];
  let dryRun = false;
  let revert = null;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") dryRun = true;
    else if (value === "--help" || value === "-h") help = true;
    else if (value === "--revert") {
      revert = argv[index + 1];
      index += 1;
      if (typeof revert !== "string" || revert.length === 0) {
        return { ok: false, message: "--revert には退避ファイルのパスが要ります。" };
      }
    } else if (value.startsWith("-")) {
      return { ok: false, message: `未知のオプションです: ${value}` };
    } else positional.push(value);
  }
  if (help) return { ok: true, help: true };
  if (positional.length !== 1) {
    return { ok: false, message: "プロジェクトディレクトリを 1 つ指定してください。" };
  }
  return { ok: true, help: false, projectRoot: path.resolve(positional[0]), dryRun, revert };
}

/** dry-run の表。列は itemId / source / fit / scale before → after。 */
export function formatChangeTable(changes) {
  if (changes.length === 0) return ["変更なし（すべての素材が出力と同寸か、対象がありません）"];
  const header = ["itemId", "source", "fit", "scale before", "scale after"];
  const rows = changes.map((change) => [
    change.itemId,
    change.sourceId,
    String(change.fit),
    String(change.before),
    String(change.after),
  ]);
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd();
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)];
}

async function collectDimensions(projectRoot, edit) {
  const sources = Array.isArray(edit?.sources) ? edit.sources : [];
  const entries = await Promise.all(sources.map(async (source) => {
    if (!source || typeof source.id !== "string" || typeof source.path !== "string") return null;
    const filePath = path.isAbsolute(source.path) ? source.path : path.join(projectRoot, source.path);
    try {
      const probed = await probeMediaDimensions(filePath);
      // fit は表示回転を適用した後の画素数で決まる。
      return [source.id, { width: probed.displayWidth, height: probed.displayHeight }];
    } catch {
      // 音声素材・欠損ファイルはここで落ちる。移行対象だった場合だけ blockers になる。
      return null;
    }
  }));
  return new Map(entries.filter(Boolean));
}

async function runRevert(projectRoot, backup, log, error) {
  const editPath = path.join(projectRoot, "edit.json");
  const backupPath = path.resolve(backup);
  let backupText;
  try {
    backupText = await readFile(backupPath, "utf8");
  } catch (cause) {
    error(`退避ファイルを読めません: ${backupPath} (${messageOf(cause)})`);
    return 2;
  }
  const currentText = await readFile(editPath, "utf8");
  if (currentText === backupText) {
    log("edit.json は既に退避ファイルと同一です。");
    return 0;
  }
  await migrate.revertMigration({
    filePath: editPath,
    version: 2,
    changes: [],
    warnings: [],
    nextText: currentText,
    previousText: backupText,
    backupPath,
  });
  log(`edit.json を ${backupPath} の内容へ戻しました。`);
  return 0;
}

export async function run(argv, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const error = io.error ?? ((line) => console.error(line));
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    error(parsed.message);
    error(USAGE);
    return 2;
  }
  if (parsed.help) {
    log(USAGE);
    return 0;
  }
  const projectRoot = parsed.projectRoot;
  const editPath = path.join(projectRoot, "edit.json");
  if (parsed.revert !== null) return runRevert(projectRoot, parsed.revert, log, error);

  let text;
  try {
    text = await readFile(editPath, "utf8");
  } catch (cause) {
    error(`edit.json を読めません: ${editPath} (${messageOf(cause)})`);
    return 2;
  }
  let edit;
  try {
    edit = JSON.parse(text);
  } catch (cause) {
    error(`edit.json を JSON として読めません: ${messageOf(cause)}`);
    return 2;
  }
  const dimensions = await collectDimensions(projectRoot, edit);
  const proposal = migrate.planGeometryNormalization(projectRoot, editPath, text, {
    dimensionsOf: (sourceId) => dimensions.get(sourceId),
  });
  if (proposal.ok === false) {
    error("このプロジェクトは移行できません。");
    for (const blocker of proposal.blockers) error(`- ${blocker}`);
    return 2;
  }
  if (proposal.noop === true) {
    log("既に実寸基準（output.geometry: \"source\"）です。移行の必要はありません。");
    return 0;
  }
  log(`移行対象: ${proposal.filePath}`);
  for (const line of formatChangeTable(proposal.geometry)) log(line);
  log(`output.geometry: "source" を立てます（blockers 0）。`);
  if (parsed.dryRun) {
    log("--dry-run のため、ファイルは変更しません。");
    return 0;
  }
  const gate = await writeGate.lintProjectCandidatesOnDisk(projectRoot, { "edit.json": proposal.nextText });
  if (!gate.pass) {
    error("edit-lint が移行後の edit.json を拒否しました。");
    for (const message of gate.errors) error(`- ${message}`);
    return 1;
  }
  await migrate.applyMigration(proposal);
  log(`移行しました。元ファイル: ${proposal.backupPath}`);
  log(`元に戻すには: normalize-geometry ${projectRoot} --revert ${proposal.backupPath}`);
  return 0;
}

function messageOf(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (cause) => {
    console.error(messageOf(cause));
    process.exitCode = 1;
  });
}
