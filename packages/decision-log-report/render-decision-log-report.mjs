#!/usr/bin/env node

// decision-log.md を寛容に読み、読み取り専用 HTML へ派生描画する。
// 表の列検出は audio-library-setup/shared/decision-log.mjs の意味論を踏襲するが、
// 配布時の実行時閉包をこのパッケージ内で閉じるため import はしない。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { localizeReportTemplate, reportLanguage } from "../analysis-report/report-i18n.mjs";
import { getLanguage, t } from "../akari-tools/src/decision-log/i18n.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(here, "template.html");
const DATA_PLACEHOLDER = '{"__AKARI_DECISION_LOG_REPORT_DATA__":true}';

function usage(lang = getLanguage()) {
  return [
    t("decision-log.report.cli.usage", {}, lang),
    "  node render-decision-log-report.mjs --log <decision-log.md> --out <report.html> [--project <root>] [--lang <ja|en>]",
  ].join("\n");
}

function parseArgs(argv) {
  let logPath = null;
  let outPath = null;
  let projectPath = null;
  const languageIndex = argv.indexOf("--lang");
  let lang = languageIndex >= 0 && ["ja", "en"].includes(argv[languageIndex + 1]) ? argv[languageIndex + 1] : getLanguage();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true, lang };
    if (["--log", "--out", "--project", "--lang"].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(t("decision-log.report.cli.valueRequired", { argument: arg }, lang));
      if (arg === "--log") logPath = value;
      if (arg === "--out") outPath = value;
      if (arg === "--project") projectPath = value;
      if (arg === "--lang") lang = reportLanguage(value);
      index += 1;
      continue;
    }
    throw new Error(t("decision-log.report.cli.unknownArgument", { argument: arg }, lang));
  }
  if (!logPath) throw new Error(t("decision-log.report.cli.logRequired", {}, lang));
  if (!outPath) throw new Error(t("decision-log.report.cli.outRequired", {}, lang));
  return { help: false, logPath, outPath, projectPath, lang: reportLanguage(lang) };
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  const cells = [];
  let cell = "";
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && index + 1 < trimmed.length - 1) {
      cell += char + trimmed[++index];
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function decisionColumns(cells) {
  const category = cells.indexOf("category");
  const subject = cells.indexOf("subject");
  const decision = Math.max(cells.indexOf("決定"), cells.indexOf("Decision"));
  if (category < 0 || subject < 0 || decision < 0) return null;
  return {
    at: Math.max(cells.indexOf("日時"), cells.indexOf("Time")),
    category,
    subject,
    decision,
    reason: Math.max(cells.indexOf("理由"), cells.indexOf("Reason")),
    decider: Math.max(cells.indexOf("決定者"), cells.indexOf("Decided by")),
    checkpoint: Math.max(cells.indexOf("関連 checkpoint"), cells.indexOf("checkpoint"), cells.indexOf("Related checkpoint")),
  };
}

function cellAt(cells, index) {
  return index >= 0 ? (cells[index] ?? "") : "";
}

function toneFields(category, subject, decision) {
  if (category !== "direction" || subject !== "tone") return {};
  const code = /^`([^`]*)`(?:\s|$)/u.exec(decision.trim());
  if (!code) return {};
  try {
    const value = JSON.parse(code[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const fields = {};
    if (Array.isArray(value.tone) && value.tone.every((item) => typeof item === "string")) {
      fields.tone = value.tone;
    }
    if (typeof value.tempo === "string") fields.tempo = value.tempo;
    return fields;
  } catch {
    return {};
  }
}

function makeDecision(values, raw, index) {
  const decision = {
    index,
    at: values.at || "",
    category: values.category || "",
    subject: values.subject || "",
    decision: values.decision || "",
    reason: values.reason || "",
    decider: values.decider || "",
    checkpoint: values.checkpoint || "",
    ...toneFields(values.category || "", values.subject || "", values.decision || ""),
    raw,
    supersededBy: null,
  };
  return decision;
}

function parseTableDecision(cells, columns, raw, index) {
  return makeDecision({
    at: cellAt(cells, columns.at),
    category: cellAt(cells, columns.category),
    subject: cellAt(cells, columns.subject),
    decision: cellAt(cells, columns.decision),
    reason: cellAt(cells, columns.reason),
    decider: cellAt(cells, columns.decider),
    checkpoint: cellAt(cells, columns.checkpoint),
  }, raw, index);
}

function splitPipeLine(line) {
  const cells = [];
  let cell = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && index + 1 < line.length) {
      cell += char + line[++index];
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parsePipeDecision(line, index) {
  if (!line.includes("|")) return null;
  const cells = splitPipeLine(line.replace(/^\s*[-*+]\s+/u, ""));
  const labels = new Map();
  for (const cell of cells.slice(1)) {
    const match = /^(category|subject|決定|Decision|理由|Reason|決定者|Decided by|checkpoint|関連 checkpoint|Related checkpoint)\s*:\s*(.*)$/u.exec(cell);
    if (match) labels.set(match[1], match[2].trim());
  }
  if (!labels.has("category") || !labels.has("subject") || !(labels.has("決定") || labels.has("Decision"))) return null;
  return makeDecision({
    at: cells[0],
    category: labels.get("category"),
    subject: labels.get("subject"),
    decision: labels.get("決定") ?? labels.get("Decision"),
    reason: labels.get("理由") ?? labels.get("Reason"),
    decider: labels.get("決定者") ?? labels.get("Decided by"),
    checkpoint: labels.get("checkpoint") ?? labels.get("関連 checkpoint") ?? labels.get("Related checkpoint"),
  }, line, index);
}

function isBlockBoundary(line) {
  return (
    line.trim() === "" ||
    /^#{1,6}\s+/u.test(line) ||
    /^\s*(```|~~~)/u.test(line) ||
    /^\s*>/u.test(line) ||
    /^\s*(?:[-*+] |\d+[.)] )/u.test(line) ||
    tableCells(line) !== null ||
    parsePipeDecision(line, 0) !== null
  );
}

function parseMarkdown(markdown) {
  const decisions = [];
  const blocks = [];
  const lines = markdown.split(/\r?\n/u);
  let cursor = 0;

  const addBlock = (block) => {
    blocks.push({ index: blocks.length, ...block });
  };

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.trim() === "") {
      cursor += 1;
      continue;
    }

    const cells = tableCells(line);
    if (cells) {
      const columns = decisionColumns(cells);
      if (columns) {
        cursor += 1;
        if (cursor < lines.length) {
          const separator = tableCells(lines[cursor]);
          if (separator && isSeparatorRow(separator)) cursor += 1;
        }
        while (cursor < lines.length) {
          const row = tableCells(lines[cursor]);
          if (!row) break;
          if (!isSeparatorRow(row)) {
            decisions.push(parseTableDecision(row, columns, lines[cursor], decisions.length));
          }
          cursor += 1;
        }
        continue;
      }

      const tableLines = [];
      const rows = [];
      while (cursor < lines.length) {
        const row = tableCells(lines[cursor]);
        if (!row) break;
        tableLines.push(lines[cursor]);
        rows.push(row);
        cursor += 1;
      }
      addBlock({ type: "table", rows, raw: tableLines.join("\n") });
      continue;
    }

    const pipeDecision = parsePipeDecision(line, decisions.length);
    if (pipeDecision) {
      decisions.push(pipeDecision);
      cursor += 1;
      continue;
    }

    const fence = /^\s*(```|~~~)(.*)$/u.exec(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim();
      const raw = [line];
      const body = [];
      cursor += 1;
      while (cursor < lines.length && !lines[cursor].trimStart().startsWith(marker)) {
        raw.push(lines[cursor]);
        body.push(lines[cursor]);
        cursor += 1;
      }
      if (cursor < lines.length) raw.push(lines[cursor++]);
      addBlock({ type: "code", language, text: body.join("\n"), raw: raw.join("\n") });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading) {
      addBlock({ type: "heading", level: heading[1].length, text: heading[2].trim(), raw: line });
      cursor += 1;
      continue;
    }

    const quote = /^\s*>[ \t]?(.*)$/u.exec(line);
    if (quote) {
      const raw = [];
      const body = [];
      while (cursor < lines.length) {
        const quotedLine = /^\s*>[ \t]?(.*)$/u.exec(lines[cursor]);
        if (!quotedLine) break;
        raw.push(lines[cursor]);
        body.push(quotedLine[1]);
        cursor += 1;
      }
      addBlock({ type: "blockquote", text: body.join("\n"), raw: raw.join("\n") });
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    if (list) {
      const indentation = list[1].replace(/\t/gu, "  ").length;
      addBlock({
        type: "list",
        depth: Math.floor(indentation / 2),
        ordered: /^\d/u.test(list[2]),
        text: list[3],
        raw: line,
      });
      cursor += 1;
      continue;
    }

    const paragraphLines = [line];
    cursor += 1;
    while (cursor < lines.length && !isBlockBoundary(lines[cursor])) {
      paragraphLines.push(lines[cursor]);
      cursor += 1;
    }
    addBlock({
      type: "paragraph",
      text: paragraphLines.join("\n").trim(),
      raw: paragraphLines.join("\n"),
    });
  }

  const latestByKey = new Map();
  for (const decision of decisions) {
    const key = JSON.stringify([decision.category, decision.subject]);
    const previous = latestByKey.get(key);
    if (previous !== undefined) decisions[previous].supersededBy = decision.index;
    latestByKey.set(key, decision.index);
  }

  return { decisions, blocks };
}

function isUnresolvablePathToken(path) {
  return /[*?–—〜～~]/u.test(path);
}

function imagePathsIn(text) {
  const paths = new Set();
  const explicitRanges = [];
  const add = (rawPath) => {
    const path = rawPath.trim();
    if (!isUnresolvablePathToken(path)) paths.add(path);
  };
  const markdownImage = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/giu;
  for (const match of text.matchAll(markdownImage)) {
    add(match[1] ?? match[2]);
    explicitRanges.push([match.index, match.index + match[0].length]);
  }

  const inlineCode = /`([^`\r\n]+\.(?:png|jpe?g|webp|gif))`/giu;
  for (const match of text.matchAll(inlineCode)) {
    add(match[1]);
    explicitRanges.push([match.index, match.index + match[0].length]);
  }

  const pathToken = /(?<![A-Za-z0-9_./\\*?-])(?:[A-Za-z]:)?(?=[A-Za-z0-9_./\\-]*[\\/])[A-Za-z0-9_./\\-]+\.(?:[Pp][Nn][Gg]|[Jj][Pp](?:[Ee])?[Gg]|[Ww][Ee][Bb][Pp]|[Gg][Ii][Ff])(?![A-Za-z0-9_./\\*?-])/gu;
  for (const match of text.matchAll(pathToken)) {
    const isExplicit = explicitRanges.some(([start, end]) => match.index >= start && match.index < end);
    if (!isExplicit) add(match[0]);
  }
  return [...paths];
}

function isInside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function toPosixRelative(fromDir, target) {
  return relative(fromDir, target).split(sep).join("/");
}

function resolveImages(decisions, blocks, projectRoot, outDir) {
  const images = [];
  const add = (path, decisionIndex, blockIndex) => {
    let exists = false;
    let src = null;
    if (!isAbsolute(path) && !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(path) && !path.startsWith("//")) {
      const absolute = resolve(projectRoot, path);
      if (isInside(projectRoot, absolute)) {
        try {
          exists = existsSync(absolute) && statSync(absolute).isFile();
          if (exists) src = toPosixRelative(outDir, absolute);
        } catch {
          exists = false;
          src = null;
        }
      }
    }
    images.push({ path, exists, src, decisionIndex, blockIndex });
  };
  for (const decision of decisions) {
    for (const path of imagePathsIn(decision.raw)) add(path, decision.index, null);
  }
  for (const block of blocks) {
    for (const path of imagePathsIn(block.raw)) add(path, null, block.index);
  }
  return images;
}

function readLog(path, lang) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(t("decision-log.report.error.logRead", { path, error: error.message }, lang));
  }
}

function readTemplate(lang) {
  try {
    return readFileSync(templatePath, "utf8");
  } catch (error) {
    throw new Error(t("decision-log.report.error.templateRead", { path: templatePath, error: error.message }, lang));
  }
}

function writeAtomically(outPath, content, lang) {
  const outDir = dirname(outPath);
  mkdirSync(outDir, { recursive: true });
  const temporary = resolve(outDir, `.${basename(outPath)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, outPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new Error(t("decision-log.report.error.write", { path: outPath, error: error.message }, lang));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage(args.lang));
    return;
  }

  const logAbsolutePath = resolve(args.logPath);
  const outAbsolutePath = resolve(args.outPath);
  const logParent = dirname(logAbsolutePath);
  const projectRoot = resolve(
    args.projectPath ?? (basename(logParent) === "planning" ? dirname(logParent) : logParent),
  );
  const markdown = readLog(logAbsolutePath, args.lang);
  const { decisions, blocks } = parseMarkdown(markdown);
  const images = resolveImages(decisions, blocks, projectRoot, dirname(outAbsolutePath));
  const bundle = {
    source: {
      path: toPosixRelative(projectRoot, logAbsolutePath),
      projectName: basename(projectRoot),
    },
    decisions,
    blocks,
    images,
    stats: {
      decisionRows: decisions.length,
      blockCount: blocks.length,
      imageCount: images.length,
      missingImageCount: images.filter((image) => !image.exists).length,
    },
  };

  const template = readTemplate(args.lang);
  if (!template.includes(DATA_PLACEHOLDER)) {
    throw new Error(t("decision-log.report.error.placeholder", { path: templatePath }, args.lang));
  }
  const serialized = JSON.stringify(bundle).replace(/</gu, "\\u003c");
  const rendered = localizeReportTemplate(template, "report-decision", args.lang).replace(DATA_PLACEHOLDER, serialized);
  writeAtomically(outAbsolutePath, rendered, args.lang);
  console.log(`OK: ${outAbsolutePath} (${Buffer.byteLength(rendered, "utf8").toLocaleString("en-US")} bytes)`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (process.argv.length <= 2) console.error(`\n${usage()}`);
  process.exitCode = 1;
}
