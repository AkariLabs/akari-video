#!/usr/bin/env node
// synthesize.mjs — script.json のビート台詞を VOICEVOX で合成し、narration/ に
// <beat.id>.wav + <beat.id>.query.json を書き出す。
//
// 前提: VOICEVOX エンジンがヘッドレス起動済み（外部ネットワーク接続は localhost の
// みという境界規則のとおり）。
//   /Applications/VOICEVOX.app/Contents/Resources/vv-engine/run --host 127.0.0.1 --port 50021
//
// 使い方: node tools/synthesize.mjs <projectDir> [--only <beatId>] [--speaker <id>]
//         [--host 127.0.0.1] [--port 50021]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = { projectDir: null, only: null, speaker: null, host: "127.0.0.1", port: 50021, project: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--only") out.only = argv[++i];
    else if (a === "--project") out.project = argv[++i];
    else if (a === "--speaker") out.speaker = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else positional.push(a);
  }
  out.projectDir = positional[0];
  return out;
}

async function synthesizeBeat({ base, speaker, text, id, narrationDir }) {
  const queryUrl = `${base}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`;
  const queryRes = await fetch(queryUrl, { method: "POST" });
  if (!queryRes.ok) throw new Error(`audio_query failed for ${id}: ${queryRes.status} ${await queryRes.text()}`);
  const query = await queryRes.json();

  const synthUrl = `${base}/synthesis?speaker=${speaker}`;
  const synthRes = await fetch(synthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthRes.ok) throw new Error(`synthesis failed for ${id}: ${synthRes.status} ${await synthRes.text()}`);
  const wavBuf = Buffer.from(await synthRes.arrayBuffer());

  await mkdir(narrationDir, { recursive: true });
  const wavPath = path.join(narrationDir, `${id}.wav`);
  const queryPath = path.join(narrationDir, `${id}.query.json`);
  await writeFile(wavPath, wavBuf);
  await writeFile(queryPath, JSON.stringify(query, null, 2));
  console.log(`[synthesize] ${id} -> ${wavPath} (${wavBuf.length} bytes) + ${queryPath}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.projectDir) {
    console.error("使い方: node tools/synthesize.mjs <projectDir> [--only <beatId>] [--speaker <id>]");
    process.exit(1);
  }
  const projectDir = path.resolve(opts.projectDir);
  const project = JSON.parse(await readFile(path.join(projectDir, opts.project || "project.json"), "utf8"));
  const scriptPath = path.resolve(projectDir, project.script || "./script.json");
  const script = JSON.parse(await readFile(scriptPath, "utf8"));
  const narrationDir = path.resolve(projectDir, project.narrationDir || "./narration");
  const speaker = opts.speaker != null ? opts.speaker : (script.speaker && script.speaker.styleId) || 11;
  const base = `http://${opts.host}:${opts.port}`;

  const beats = opts.only ? script.beats.filter((b) => b.id === opts.only) : script.beats;
  if (!beats.length) throw new Error(`ビートが見つからない（--only=${opts.only}）`);

  // VOICEVOX 起動確認
  const versionRes = await fetch(`${base}/version`).catch(() => null);
  if (!versionRes || !versionRes.ok) {
    throw new Error(`VOICEVOX エンジンに接続できない（${base}）。ヘッドレス起動してから再実行すること。`);
  }
  console.log(`[synthesize] VOICEVOX engine OK at ${base}, speaker=${speaker}, beats=${beats.length}`);

  for (const b of beats) {
    await synthesizeBeat({ base, speaker, text: b.text, id: b.id, narrationDir });
  }
  console.log("[synthesize] done.");
}

main().catch((err) => {
  console.error("[synthesize] FAILED:", err);
  process.exit(1);
});
