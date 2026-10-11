#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isMainModule } from "../src/common/main-module.mjs";
import { resolveTarget } from "../src/media/common.mjs";

const usage = "使い方: akari speakers set <target> <A> [--person <channel>/<id>] [--name <名前>] [--clear] [--people <people.json>]\n       akari speakers list <target> [--json]";

export async function runSpeakersCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv[0] === "--help" || argv[0] === "-h") { stdout(usage); return 0; }
  const [command, targetArg, ...rest] = argv;
  if (!["set", "list"].includes(command)) { stderr(command ? `不明な speakers サブコマンドです: ${command}` : usage); return 1; }
  if (!targetArg || targetArg.startsWith("-")) { stderr("target が必要です"); return 1; }
  try {
    const voice = await import("../../akari-voice/src/index.mjs");
    const target = resolveTarget(targetArg, options);
    if (!target.projectRoot || !target.projectRelative) throw new Error("プロジェクト内の素材を指定してください");
    const voicesPath = voice.voicesPathFor(target.projectRoot, target.projectRelative);
    if (command === "list") {
      if (rest.some(arg => arg !== "--json")) throw new Error("list: 不明なオプションです");
      const voices = voice.readVoicesFile(voicesPath);
      const dictionary = voice.readSpeakerDictionary(target.projectRoot);
      const ids = new Set([...Object.keys(voices?.speakers ?? {}), ...Object.keys(dictionary), ...Object.keys(voices?.decided ?? {})]);
      const rows = [...ids].sort().map(id => ({
        id, seconds: voices?.speakers?.[id]?.seconds ?? 0,
        suggestion: voices?.speakers?.[id]?.suggestion ?? null,
        decided: dictionary[id] ?? (voices?.decided?.[id] ? { person: voices.decided[id] } : null),
      }));
      if (rest.includes("--json")) stdout(JSON.stringify({ speakers: rows }));
      else {
        stdout("話者\t秒数\t提案\t決定");
        for (const row of rows) stdout(`${row.id}\t${row.seconds}\t${row.suggestion ? `${row.suggestion.name ?? ""} ${row.suggestion.score} ${row.suggestion.level}` : ""}\t${row.decided ? `${row.decided.name ?? ""} ${row.decided.person ?? ""}` : ""}`);
      }
      return 0;
    }
    const [speakerId, ...flags] = rest;
    if (!/^[A-Z]+$/.test(speakerId ?? "")) throw new Error("話者 ID は A などの大文字で指定してください");
    const parsed = {};
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === "--clear") { parsed.clear = true; continue; }
      if (!["--person", "--name", "--people"].includes(flag)) throw new Error(`set: 不明なオプションです: ${flag}`);
      const value = flags[++i];
      if (!value || value.startsWith("--")) throw new Error(`${flag} の値が必要です`);
      parsed[flag.slice(2)] = value;
    }
    if (parsed.clear && (parsed.person || parsed.name || parsed.people)) throw new Error("--clear は単独で指定してください");
    if (!parsed.clear && !parsed.person && !parsed.name) throw new Error("--person、--name、--clear のいずれかを指定してください");
    const previous = voice.readVoicesFile(voicesPath);
    if (parsed.clear) {
      voice.writeSpeakerEntry(target.projectRoot, speakerId, undefined);
      if (previous) {
        delete previous.decided?.[speakerId];
        voice.writeVoicesFile(voicesPath, previous);
      }
      stdout(`${speakerId} の決定を消しました`);
      return 0;
    }
    let personName;
    if (parsed.person) {
      const located = parsed.people
        ? { peoplePath: path.resolve(options.cwd ?? process.cwd(), parsed.people), channel: path.basename(path.dirname(path.resolve(options.cwd ?? process.cwd(), parsed.people))) }
        : voice.channelPeopleForProject(target.projectRoot);
      if (!located || !existsSync(located.peoplePath)) throw new Error("人物の一覧（people.json）が見つかりません");
      const [channel, id, extra] = parsed.person.split("/");
      if (!channel || !id || extra || channel !== located.channel) throw new Error("人物の参照が people.json と一致しません");
      const people = JSON.parse(readFileSync(located.peoplePath, "utf8"));
      const person = people.entries?.find(item => item.id === id && ["person", "avatar"].includes(item.kind));
      if (!person?.name) throw new Error("指定した人物が people.json に見つかりません");
      personName = person.name;
    }
    const existing = voice.readSpeakerDictionary(target.projectRoot)[speakerId];
    voice.writeSpeakerEntry(target.projectRoot, speakerId, {
      name: parsed.name ?? personName,
      ...(parsed.person ? { person: parsed.person } : existing?.person ? { person: existing.person } : {}),
    });
    if (parsed.person && previous) {
      previous.decided = { ...previous.decided, [speakerId]: parsed.person };
      voice.writeVoicesFile(voicesPath, previous);
    }
    stdout(`${speakerId} の名前を保存しました`);
    return 0;
  } catch (error) { stderr(error instanceof Error ? error.message : String(error)); return 1; }
}

if (isMainModule(import.meta.url)) process.exitCode = await runSpeakersCli(process.argv.slice(2));
