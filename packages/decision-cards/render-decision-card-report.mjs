#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeReportTemplate, reportLanguage } from "../analysis-report/report-i18n.mjs";

const templatePath = fileURLToPath(new URL("./report-template.html", import.meta.url));

export function renderDecisionCardReport({ lang = reportLanguage() } = {}) {
  return localizeReportTemplate(readFileSync(templatePath, "utf8"), "report-cards", reportLanguage(lang));
}

function main(argv) {
  let lang;
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--lang") {
      const value = argv[++index];
      if (value === undefined) throw new Error("--lang requires ja or en");
      lang = reportLanguage(value);
    }
    else if (arg === "--out") out = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!out) throw new Error("--out is required");
  writeFileSync(resolve(out), renderDecisionCardReport({ lang }), "utf8");
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
