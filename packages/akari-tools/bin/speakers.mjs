#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { t as toolsText } from "../../i18n/index.mjs";
import { isMainModule } from "../src/common/main-module.mjs";
import { resolveTarget } from "../src/media/common.mjs";

const usage = () => toolsText('tools.speakers.cli.usage');

export async function runSpeakersCli(argv, options = {}) {
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (argv[0] === "--help" || argv[0] === "-h") { stdout(usage()); return 0; }
  const [command, targetArg, ...rest] = argv;
  if (!["set", "list"].includes(command)) { stderr(command ? toolsText('tools.speakers.cli.unknownCommand', { command }) : usage()); return 1; }
  if (!targetArg || targetArg.startsWith("-")) { stderr(toolsText('tools.speakers.cli.targetRequired')); return 1; }
  try {
    const voice = await import("../../akari-voice/src/index.mjs");
    const target = resolveTarget(targetArg, options);
    if (!target.projectRoot || !target.projectRelative) throw new Error(toolsText('tools.speakers.cli.projectTargetRequired'));
    const voicesPath = voice.voicesPathFor(target.projectRoot, target.projectRelative);
    if (command === "list") {
      if (rest.some(arg => arg !== "--json")) throw new Error(toolsText('tools.speakers.cli.listUnknownOption'));
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
        stdout(toolsText('tools.speakers.cli.header'));
        for (const row of rows) stdout(`${row.id}\t${row.seconds}\t${row.suggestion ? `${row.suggestion.name ?? ""} ${row.suggestion.score} ${row.suggestion.level}` : ""}\t${row.decided ? `${row.decided.name ?? ""} ${row.decided.person ?? ""}` : ""}`);
      }
      return 0;
    }
    const [speakerId, ...flags] = rest;
    if (!/^[A-Z]+$/.test(speakerId ?? "")) throw new Error(toolsText('tools.speakers.cli.invalidId'));
    const parsed = {};
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      if (flag === "--clear") { parsed.clear = true; continue; }
      if (!["--person", "--name", "--people"].includes(flag)) throw new Error(toolsText('tools.speakers.cli.setUnknownOption', { flag }));
      const value = flags[++i];
      if (!value || value.startsWith("--")) throw new Error(toolsText('tools.speakers.cli.valueRequired', { flag }));
      parsed[flag.slice(2)] = value;
    }
    if (parsed.clear && (parsed.person || parsed.name || parsed.people)) throw new Error(toolsText('tools.speakers.cli.clearAlone'));
    if (!parsed.clear && !parsed.person && !parsed.name) throw new Error(toolsText('tools.speakers.cli.setChoiceRequired'));
    const previous = voice.readVoicesFile(voicesPath);
    if (parsed.clear) {
      voice.writeSpeakerEntry(target.projectRoot, speakerId, undefined);
      if (previous) {
        delete previous.decided?.[speakerId];
        voice.writeVoicesFile(voicesPath, previous);
      }
      stdout(toolsText('tools.speakers.cli.cleared', { id: speakerId }));
      return 0;
    }
    let personName;
    if (parsed.person) {
      const located = parsed.people
        ? { peoplePath: path.resolve(options.cwd ?? process.cwd(), parsed.people), channel: path.basename(path.dirname(path.resolve(options.cwd ?? process.cwd(), parsed.people))) }
        : voice.channelPeopleForProject(target.projectRoot);
      if (!located || !existsSync(located.peoplePath)) throw new Error(toolsText('tools.speakers.cli.peopleMissing'));
      const [channel, id, extra] = parsed.person.split("/");
      if (!channel || !id || extra || channel !== located.channel) throw new Error(toolsText('tools.speakers.cli.personMismatch'));
      const people = JSON.parse(readFileSync(located.peoplePath, "utf8"));
      const person = people.entries?.find(item => item.id === id && ["person", "avatar"].includes(item.kind));
      if (!person?.name) throw new Error(toolsText('tools.speakers.cli.personMissing'));
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
    stdout(toolsText('tools.speakers.cli.saved', { id: speakerId }));
    return 0;
  } catch (error) { stderr(error instanceof Error ? error.message : String(error)); return 1; }
}

if (isMainModule(import.meta.url)) process.exitCode = await runSpeakersCli(process.argv.slice(2));
