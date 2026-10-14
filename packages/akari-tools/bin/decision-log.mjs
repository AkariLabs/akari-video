#!/usr/bin/env node
import path from "node:path";
import { isMainModule } from "../src/common/main-module.mjs";
import { settleDecisionLog } from "../src/decision-log/settle.mjs";
import { getLanguage, t } from "../src/decision-log/i18n.mjs";

const usage = (lang) => [
  t("decision-log.cli.help.usage", {}, lang), "",
  t("decision-log.cli.help.settle", {}, lang),
  t("decision-log.cli.help.actor", {}, lang),
  t("decision-log.cli.help.dryRun", {}, lang),
  "  --lang <ja|en>",
  "  --json", "  --help",
].join("\n");

export async function runDecisionLogCli(argv, options = {}) {
  const languageIndex = argv.indexOf("--lang");
  const requestedLanguage = languageIndex >= 0 ? argv[languageIndex + 1] : undefined;
  const language = options.lang ?? (["ja", "en"].includes(requestedLanguage) ? requestedLanguage : getLanguage());
  const stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const stderr = options.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    stdout(usage(language));
    return 0;
  }
  try {
    const [command, directory, ...rest] = argv;
    if (command !== "settle") throw new Error(t("decision-log.cli.error.unknownCommand", { command }, language));
    if (!directory || directory.startsWith("-")) throw new Error(t("decision-log.cli.error.directoryRequired", {}, language));
    const parsed = {};
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === "--dry-run") parsed.dryRun = true;
      else if (arg === "--json") continue;
      else if (arg === "--lang") {
        const value = rest[++index];
        if (value !== "ja" && value !== "en") throw new Error("--lang must be ja or en");
        parsed.lang = value;
      }
      else if (arg === "--actor") {
        const value = rest[++index];
        if (!value?.trim() || value.startsWith("--")) throw new Error(t("decision-log.cli.error.actorRequired", {}, language));
        parsed.actor = value;
      } else throw new Error(t("decision-log.cli.error.unknownOption", { option: arg }, language));
    }
    const projectRoot = path.resolve(options.cwd ?? process.cwd(), directory);
    const result = await settleDecisionLog({ projectRoot, lang: language, ...parsed });
    stdout(JSON.stringify({ ...result, results: result.results ?? [], path: path.join(projectRoot, "decision-log.md") }));
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await runDecisionLogCli(process.argv.slice(2));
