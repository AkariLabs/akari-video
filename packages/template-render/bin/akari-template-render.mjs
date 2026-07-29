#!/usr/bin/env node
// akari-template-render — AKARI Video のテンプレート素材を、自分の文言・色・サイズで
// 動画へ書き出す CLI。素材を買った人がそのまま使えることを目的にしている。
//
//   npx @akari-video/template-render <テンプレのディレクトリ|fragment.html> [オプション]

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findChrome } from "../src/find-chrome.mjs";
import { findFfmpeg } from "../src/find-ffmpeg.mjs";
import { encode, shootFrames } from "../src/render.mjs";

const HELP = `akari-template-render — テンプレート素材を動画へ書き出す

使い方:
  npx @akari-video/template-render <テンプレのディレクトリ|fragment.html> [オプション]

出力:
  --out <file>            H.264 mp4（既定: demo.mp4）
  --alpha <file>          アルファ付き ProRes4444 .mov（他社 NLE 用）
  --png-sequence <dir>    連番 PNG（ffmpeg が無くても書き出せる）

内容:
  --var <名前=値>          ツマミを 1 つ変える（繰り返し可）
                          例: --var board-color=#1c1f1e --var title-size=9
  --vars "<css>"          まとめて指定（例: "--board-width:1200px;--dust:0.8;"）
  --text <旧=新>           見本の文言を差し替える（繰り返し可）
                          例: --text "今日のポイント=まとめ"
                          大きく作り変えるときは fragment.html を直接編集してください
  --list-knobs            そのテンプレで変えられるツマミの一覧を出して終了

見た目:
  --duration <秒>          既定 5
  --fps <n>               既定 30
  --size <幅x高さ>          既定 1920x1080
  --backdrop <色>          背景色（既定 #141414）
  --under <画像>           背景に敷く画像。透過部分の確認に使う
  --transparent           背景を透明のまま撮る（--png-sequence / --alpha 向け）

環境:
  --chrome <path>         Chrome の実行ファイル（既定は自動検出）
  --ffmpeg <path>         ffmpeg の実行ファイル（既定は PATH）

ライセンス: このツールは MIT。テンプレート素材のライセンスは各素材の meta.json を見てください。`;

function parseArgs(argv) {
  const args = { var: [], text: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      if (!args._) args._ = token;
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else if (key === "var" || key === "text") {
      args[key].push(next);
      i += 1;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h || !args._) {
  console.log(HELP);
  process.exit(args._ ? 0 : 2);
}

// --- テンプレの解決 ---------------------------------------------------------

const target = resolve(args._);
if (!existsSync(target)) {
  console.error(`見つかりません: ${target}`);
  process.exit(1);
}

const isDirectory = statSync(target).isDirectory();
const fragmentPath = isDirectory ? join(target, "fragment.html") : target;
const metaPath = isDirectory ? join(target, "meta.json") : null;

if (!existsSync(fragmentPath)) {
  console.error(
    `fragment.html が見つかりません: ${fragmentPath}\n` +
      "テンプレのディレクトリ（fragment.html と meta.json が入っているもの）を渡してください。",
  );
  process.exit(1);
}

const meta = metaPath && existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;

// --- ツマミ一覧 -------------------------------------------------------------

if (args["list-knobs"]) {
  if (!meta) {
    console.error("meta.json が無いため、ツマミ一覧を出せません（fragment.html 単体を渡した場合など）。");
    process.exit(1);
  }
  console.log(`\n${meta.title ?? meta.id} — 変えられるツマミ ${meta.knobs.length} 個\n`);
  const groups = new Map();
  for (const knob of meta.knobs) {
    if (!knob.cssVar) continue;
    if (!groups.has(knob.group)) groups.set(knob.group, []);
    groups.get(knob.group).push(knob);
  }
  for (const [group, knobs] of groups) {
    console.log(`  [${group}]`);
    for (const knob of knobs) {
      const range =
        Number.isFinite(knob.min) && Number.isFinite(knob.max)
          ? `  ${knob.min}〜${knob.max}${knob.unit ?? ""}`
          : "";
      console.log(`    --var ${knob.cssVar.replace(/^--/, "").padEnd(22)} ${knob.label ?? ""}${range}`);
    }
    console.log("");
  }
  console.log("  例: --var board-color=#1c1f1e --var frame-thickness=0\n");
  if (meta.ai_usage) console.log(`  使い方の注意:\n    ${meta.ai_usage.replace(/\n/g, "\n    ")}\n`);
  process.exit(0);
}

// --- オプション -------------------------------------------------------------

const duration = Number(args.duration ?? 5);
const fps = Number(args.fps ?? 30);
const [width, height] = String(args.size ?? "1920x1080").split("x").map(Number);
if (!Number.isFinite(width) || !Number.isFinite(height)) {
  console.error(`--size は 幅x高さ の形式で指定してください（例: 1080x1920）: ${args.size}`);
  process.exit(1);
}

// --var name=value を CSS カスタムプロパティの並びへ翻訳する。
// 買った人が `--` を二重に書かなくて済むよう、先頭の `--` は省略できる。
//
// 単位は meta.json のツマミ宣言から補う。`--var board-width=940` と書けば `940px` になる。
// 宣言に unit が無いツマミ（短辺比の倍率など）は数値のまま渡す。単位を自分で書いた場合や
// 数値でない値（色・キーワード）はそのまま通す。
function withDeclaredUnit(name, value) {
  const knob = meta?.knobs?.find((k) => k.cssVar === `--${name}`);
  if (!knob?.unit) return value;
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return value;
  return `${value.trim()}${knob.unit}`;
}

const inlineVars = args.var
  .map((entry) => {
    const at = entry.indexOf("=");
    if (at === -1) {
      console.error(`--var は 名前=値 の形式で指定してください: ${entry}`);
      process.exit(1);
    }
    const name = entry.slice(0, at).replace(/^--/, "");
    if (meta && !meta.knobs.some((k) => k.cssVar === `--${name}`)) {
      console.error(
        `このテンプレに --${name} というツマミはありません。` +
          `--list-knobs で一覧を確認してください。`,
      );
      process.exit(1);
    }
    return `--${name}:${withDeclaredUnit(name, entry.slice(at + 1))};`;
  })
  .join("");
const vars = `${args.vars ?? ""}${inlineVars}`;

const wantsMp4 = !args["png-sequence"] || args.out;
const outPath = resolve(String(args.out ?? "demo.mp4"));
const alphaPath = args.alpha ? resolve(String(args.alpha)) : null;
const pngDir = args["png-sequence"] ? resolve(String(args["png-sequence"])) : null;
const frames = Math.max(1, Math.round(duration * fps));

// --- 実行 -------------------------------------------------------------------

let chromePath;
let ffmpegPath = null;
try {
  chromePath = findChrome(args.chrome);
  if (wantsMp4 || alphaPath) ffmpegPath = await findFfmpeg(args.ffmpeg);
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const workDir = pngDir ?? mkdtempSync(join(tmpdir(), "akari-template-"));
const label = meta?.id ?? "template";

function progress(done, total) {
  if (done === total || done % Math.max(1, Math.floor(total / 10)) === 0) {
    process.stdout.write(`\r  ${done}/${total} フレーム`);
  }
}

try {
  console.log(`\n${label} — ${duration}s @ ${fps}fps / ${width}x${height}`);

  if (wantsMp4 || pngDir) {
    console.log(pngDir ? "連番 PNG を書き出しています" : "動画を書き出しています");
    await shootFrames({
      fragmentPath, outDir: workDir, prefix: "frame",
      width, height, fps, frames, vars,
      backdrop: String(args.backdrop ?? "#141414"),
      under: args.under ? String(args.under) : null,
      transparent: Boolean(args.transparent),
      chromePath, textReplacements: args.text, onProgress: progress,
    });
    process.stdout.write("\n");
    if (wantsMp4) {
      await encode({ ffmpegPath, pattern: join(workDir, "frame-%05d.png"), fps, out: outPath });
      console.log(`  mp4:   ${outPath}`);
    }
    if (pngDir) console.log(`  PNG:   ${pngDir}`);
  }

  if (alphaPath) {
    console.log("アルファ付きを書き出しています");
    const alphaDir = pngDir ? join(pngDir, "alpha") : workDir;
    await shootFrames({
      fragmentPath, outDir: alphaDir, prefix: "alpha",
      width, height, fps, frames, vars,
      backdrop: "transparent", under: null, transparent: true,
      chromePath, textReplacements: args.text, onProgress: progress,
    });
    process.stdout.write("\n");
    await encode({
      ffmpegPath, pattern: join(alphaDir, "alpha-%05d.png"), fps, out: alphaPath, alpha: true,
    });
    console.log(`  alpha: ${alphaPath}`);
  }

  console.log("");
} finally {
  if (!pngDir) rmSync(workDir, { recursive: true, force: true });
}
