#!/usr/bin/env node
// generate-timeline.mjs — script.json + narration/*.wav+*.query.json -> timeline.json
//
// 使い方: node tools/generate-timeline.mjs <projectDir> [--out <path>]
//
// projectDir 直下（または project.json が指す先）に script.json / channel.json /
// narration/ を期待する。詳しい入力スキーマは README.md 参照。
//
// 生成規則の出典: 原型実制作の検収記録（内部リポ）。規則自体は tools/lib/*.mjs に自己完結
// （口パク・文分割・表情キャップ・ビート間隔の全リバースエンジニアリング根拠）

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { flattenMoras, mouthKeyframesForBeat, round3 } from "./lib/mora.mjs";
import { resolveSentences } from "./lib/sentences.mjs";
import { resolveExpressions, resolveAnchor } from "./lib/anchors.mjs";
import { resolveDiagram } from "./lib/diagram.mjs";
import { LAYOUT_PROFILES } from "./lib/layout-profiles.mjs";

const DEFAULT_TIMING = { leadIn: 0.8, beatGap: 1.4, tailHold: 4.5 };

function ffprobeDuration(wavPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath,
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      if (code === 0) resolve(parseFloat(out.trim()));
      else reject(new Error(`ffprobe failed for ${wavPath}: ${err}`));
    });
  });
}

async function loadJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

function toFileUrl(absPath) {
  return pathToFileURL(absPath).href;
}

// 設計指示4: composition 内の相対パス直書きを廃し、project dir 基準の絶対 file:// URL に
// ハーネス側で解決してデータ注入する（preload リストもここから構築）。
function resolveDiagramImagePaths(diagram, scriptDir, preloadSet) {
  if (!diagram) return diagram;
  const resolveBlock = (block) => {
    if (block.type === "shot-card") {
      block.frames = block.frames.map((f) => {
        const url = toFileUrl(path.resolve(scriptDir, f.src));
        preloadSet.add(url);
        return { ...f, src: url };
      });
    }
    return block;
  };
  if (diagram.groups) {
    diagram.groups.forEach((g) => g.blocks.forEach(resolveBlock));
  } else if (diagram.blocks) {
    diagram.blocks.forEach(resolveBlock);
  }
  return diagram;
}

async function resolveProject(projectDir, projectFile) {
  const projectPath = path.join(projectDir, projectFile || "project.json");
  const project = await loadJson(projectPath);
  const base = projectDir;
  const scriptPath = path.resolve(base, project.script || "./script.json");
  const channelPath = path.resolve(base, project.channel || "./channel.json");
  const narrationDir = path.resolve(base, project.narrationDir || "./narration");
  const outDir = path.resolve(base, project.outDir || "./out");
  const timing = { ...DEFAULT_TIMING, ...(project.timing || {}) };
  const aspect = project.aspect || "portrait";
  const fps = project.fps || 30;
  return { project, projectDir: base, scriptPath, channelPath, narrationDir, outDir, timing, aspect, fps };
}

async function buildBeat(beatSpec, { narrationDir, timing, prevEndExact, scriptDir, preloadSet }) {
  const audioPathWav = path.resolve(narrationDir, beatSpec.audio || `${beatSpec.id}.wav`);
  const audioPathQuery = path.resolve(narrationDir, beatSpec.query || `${beatSpec.id}.query.json`);
  if (!existsSync(audioPathWav)) throw new Error(`narration wav not found: ${audioPathWav}`);
  if (!existsSync(audioPathQuery)) throw new Error(`narration query.json not found: ${audioPathQuery}`);

  const query = await loadJson(audioPathQuery);
  const { moras } = flattenMoras(query);
  const wavDuration = await ffprobeDuration(audioPathWav);

  // 累積計算は丸めずフル精度で行う（毎ビート round3 してから足し込むと誤差が蓄積し、
  // 後半のビートで golden と 1ms 単位でズレる）。JSON へ書き出す値だけ round3 する。
  const startExact = prevEndExact == null ? timing.leadIn : prevEndExact + timing.beatGap;
  const endExact = startExact + wavDuration;
  const start = round3(startExact);
  const end = round3(endExact);

  let sentences;
  if (beatSpec.sentenceOverride) {
    sentences = beatSpec.sentenceOverride.map((s) => ({ text: s.text || null, t0: s.t0, t1: s.t1 }));
  } else {
    sentences = resolveSentences(moras, beatSpec.text, start, end, query.postPhonemeLength || 0).map((s) => ({
      text: s.text,
      t0: s.t0,
      t1: s.t1,
    }));
  }

  const expressions = resolveExpressions(beatSpec.expression_plan, sentences, start, end);

  const neutralWindowsRel = expressions
    .filter((e) => e.expr === "neutral")
    .map((e) => ({ t0: round3(e.t0 - start), t1: round3(e.t1 - start) }));
  const mouth = mouthKeyframesForBeat(moras, neutralWindowsRel, start);
  // golden データで確認済みの補則: 各ビートの末尾（beat.end）に必ず closed 状態の
  // キーフレームを 1 個追加する（表情に関わらず・音声が終わるので口は閉じる。
  // ビート間ギャップ中に口が開いたまま止まって見えるのを防ぐ仕上げ）。
  mouth.push({ t: end, state: "closed" });

  const beat = {
    id: beatSpec.id,
    scene: beatSpec.scene,
    audio: audioPathWav, // 絶対パス（ffmpeg -i にそのまま渡せる形）
    start,
    end,
    sentences: sentences.map((s) => ({ text: s.text, t0: s.t0, t1: s.t1 })),
    expressions,
    visual: beatSpec.visual || null,
  };

  if (beatSpec.scene === "diagram" && beatSpec.diagram) {
    beat.diagram = resolveDiagramImagePaths(resolveDiagram(beatSpec.diagram, sentences), scriptDir, preloadSet);
  }
  if (beatSpec.scene === "ending" && beatSpec.endingReveal) {
    beat.endingReveal = { t: resolveAnchor(beatSpec.endingReveal.at, sentences), dur: beatSpec.endingReveal.dur || 0.5 };
  }
  if (beatSpec.scene === "title" && beatSpec.titlePunch) {
    beat.titlePunch = beatSpec.titlePunch;
  }

  return { beat, mouth, endExact };
}

export async function generateTimeline(projectDir, projectFile) {
  const { project, scriptPath, channelPath, narrationDir, timing, aspect, fps } = await resolveProject(projectDir, projectFile);
  const script = await loadJson(scriptPath);
  const channel = await loadJson(channelPath);
  const profile = LAYOUT_PROFILES[aspect];
  if (!profile) throw new Error(`未知の aspect プロファイル: ${aspect}`);

  const scriptDir = path.dirname(scriptPath);
  const channelDir = path.dirname(channelPath);
  const preloadSet = new Set();

  const beats = [];
  const mouthAll = [];
  let prevEndExact = null;
  for (const beatSpec of script.beats) {
    const { beat, mouth, endExact } = await buildBeat(beatSpec, { narrationDir, timing, prevEndExact, scriptDir, preloadSet });
    beats.push(beat);
    mouthAll.push(...mouth);
    prevEndExact = endExact;
  }
  mouthAll.sort((a, b) => a.t - b.t);

  const total = Math.round((prevEndExact + timing.tailHold) * 100) / 100;

  // channel 資産（キャラ8態・背景）を project 基準の絶対 file:// URL へ解決
  const charAssetsDir = path.resolve(channelDir, (channel.character && channel.character.assetsDir) || ".");
  const poses = {};
  for (const [key, filename] of Object.entries((channel.character && channel.character.files) || {})) {
    const url = toFileUrl(path.resolve(charAssetsDir, filename));
    poses[key] = url;
    preloadSet.add(url);
  }
  let backgroundUrl = null;
  if (channel.background && channel.background.src) {
    backgroundUrl = toFileUrl(path.resolve(channelDir, channel.background.src));
    preloadSet.add(backgroundUrl);
  }

  const timeline = {
    fps,
    width: profile.width,
    height: profile.height,
    aspect,
    layout: profile,
    beats,
    mouth: mouthAll,
    total,
    preload: Array.from(preloadSet),
    titleCard: script.titleCard || null,
    channel: {
      sns: channel.sns || [],
      brand: channel.brand || {},
      character: {
        personBBox: (channel.character && channel.character.personBBox) || null,
        sourceSize: (channel.character && channel.character.sourceSize) || null,
        poses,
      },
      background: backgroundUrl,
    },
  };
  return { timeline, project, script, channel };
}

async function main() {
  const args = process.argv.slice(2);
  const projectDir = args[0];
  if (!projectDir) {
    console.error("使い方: node tools/generate-timeline.mjs <projectDir> [--out <path>] [--project <project.jsonのファイル名>]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.resolve(projectDir, "timeline.json");
  const projectIdx = args.indexOf("--project");
  const projectFile = projectIdx >= 0 ? args[projectIdx + 1] : undefined;

  const { timeline } = await generateTimeline(path.resolve(projectDir), projectFile);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(timeline, null, 2));
  console.log(`[generate-timeline] wrote ${outPath} (beats=${timeline.beats.length}, mouth=${timeline.mouth.length}, total=${timeline.total}s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[generate-timeline] FAILED:", err);
    process.exit(1);
  });
}
