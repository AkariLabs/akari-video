#!/usr/bin/env node
// build.mjs — 1コマンド入口: project dir -> (合成) -> timeline -> render -> QA -> mp4
//
// タスク契約の合格条件 L0: 「build.mjs が sample-project で最後まで通る（合成はスキップ
// 可能な設計にし、narration 既存ならタイムライン以降だけ回せること）」を満たす。
//
// 使い方: node tools/build.mjs <projectDir> [--no-synthesize] [--no-qa] [--no-render]
//         [--speaker <id>] [--safezone]
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { generateTimeline } from "./generate-timeline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`[build] $ ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

function parseArgs(argv) {
  const out = { projectDir: null, synthesize: null, qa: true, render: true, speaker: null, safezone: false, project: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--no-synthesize") out.synthesize = false;
    else if (a === "--synthesize") out.synthesize = true;
    else if (a === "--no-qa") out.qa = false;
    else if (a === "--no-render") out.render = false;
    else if (a === "--speaker") out.speaker = argv[++i];
    else if (a === "--safezone") out.safezone = true;
    else if (a === "--project") out.project = argv[++i];
    else positional.push(a);
  }
  out.projectDir = positional[0];
  return out;
}

async function narrationComplete(projectDir, project, script) {
  const narrationDir = path.resolve(projectDir, project.narrationDir || "./narration");
  for (const b of script.beats) {
    const wav = path.resolve(narrationDir, b.audio || `${b.id}.wav`);
    const query = path.resolve(narrationDir, b.query || `${b.id}.query.json`);
    if (!existsSync(wav) || !existsSync(query)) return false;
  }
  return true;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.projectDir) {
    console.error("使い方: node tools/build.mjs <projectDir> [--no-synthesize] [--no-qa] [--no-render]");
    process.exit(1);
  }
  const projectDir = path.resolve(opts.projectDir);
  const projectFileName = opts.project || "project.json";
  const project = JSON.parse(await readFile(path.join(projectDir, projectFileName), "utf8"));
  const scriptPath = path.resolve(projectDir, project.script || "./script.json");
  const script = JSON.parse(await readFile(scriptPath, "utf8"));

  const haveNarration = await narrationComplete(projectDir, project, script);
  const shouldSynthesize = opts.synthesize != null ? opts.synthesize : !haveNarration;
  if (shouldSynthesize) {
    const args = [path.join(__dirname, "synthesize.mjs"), projectDir];
    if (opts.speaker) args.push("--speaker", opts.speaker);
    if (opts.project) args.push("--project", opts.project);
    await run("node", args);
  } else {
    console.log("[build] narration already present for all beats — skipping synthesize (L0 の『合成スキップ可能』要件)");
  }

  console.log("[build] generating timeline.json ...");
  const { timeline } = await generateTimeline(projectDir, opts.project || undefined);
  const outDir = path.resolve(projectDir, project.outDir || "./out");
  const timelinePath = path.join(outDir, "timeline.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2));
  console.log(`[build] timeline.json written (beats=${timeline.beats.length}, mouth=${timeline.mouth.length}, total=${timeline.total}s)`);

  const outMp4 = path.join(outDir, "final.mp4");

  if (opts.render) {
    await run("node", [path.join(__dirname, "render.mjs"), projectDir, "--timeline", timelinePath, "--out", outMp4]);
  } else {
    console.log("[build] --no-render 指定によりレンダーをスキップ");
  }

  if (opts.qa) {
    const qaArgs = [path.join(__dirname, "qa-capture.mjs"), projectDir, "--timeline", timelinePath, "--out", path.join(outDir, "qa")];
    if (opts.safezone) qaArgs.push("--safezone");
    await run("node", qaArgs);
  } else {
    console.log("[build] --no-qa 指定により QA キャプチャをスキップ");
  }

  console.log("[build] done. output:", outMp4);
}

main().catch((err) => {
  console.error("[build] FAILED:", err);
  process.exit(1);
});
